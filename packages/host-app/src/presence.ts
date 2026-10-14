import { desktopCapturer, powerMonitor } from 'electron';
import os from 'node:os';
import { exec } from 'node:child_process';
import { doc, onSnapshot, setDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import {
  APP_VERSION,
  PC_COMMANDS_COLLECTION,
  POWER_OFF_ACCEPT_WINDOW_MS,
  PRESENCE_COLLECTION,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_MACHINE_ID,
  PRESENCE_PROBE_SUBCOLLECTION,
  PROBE_MAX_AGE_MS,
} from '@isisanubis/shared';

/**
 * Presencia del host (liveness pasiva + probe bajo demanda).
 *
 * El host publica `presence/{machineId}` de dos formas:
 *
 * 1. **Heartbeat periódico**: cada `PRESENCE_HEARTBEAT_MS` se vuelve a escribir
 *    el doc entero, refrescando `lastHeartbeatAt`. Es lo que escucha la app
 *    Android en modo pasivo: solo lee, no gasta cuota y se entera si el host
 *    está vivo aunque nadie haya tocado un botón.
 *
 * 2. **Por evento** (`powerMonitor`): boot, suspend, resume, lock, unlock,
 *    shutdown. Mantiene el doc al día cuando la PC cambia de estado real,
 *    sin esperar al próximo latido.
 *
 * 3. **Por probe atendido**: el teléfono escribe un probe en
 *    `presence/{machineId}/probe/pending`, la Cloud Function lo sella como
 *    `dispatched` (rate limit) y este módulo lo contesta en `probe/answer`
 *    usando un health-check en vivo.
 *
 * Decisiones:
 *
 * - Corre en el PROCESO MAIN porque usa `powerMonitor` + `desktopCapturer` y
 *   porque el renderer puede estar oculto.
 * - El campo `lastHeartbeatAt` es lo que el Android mira para saber si el
 *   dato está "fresco". Si pasa `PRESENCE_STALE_AFTER_MS`, se considera sin
 *   señal aunque el último `state` diga "online" (puede haber caído la red).
 * - `bootId` cambia en cada arranque: si el teléfono lo ve distinto, sabe que
 *   la PC reinició de verdad, sin depender de heurísticas.
 * - Deduplicación de probes por `requestId`: el host guarda el último atendido
 *   y nunca contesta dos veces el mismo pedido.
 * - `presence` es estado de UI, NUNCA una frontera de seguridad: cualquiera con
 *   la API key puede escribir estos docs (ver `firestore.rules`).
 */

const PENDING_DOC = 'pending';
const ANSWER_DOC = 'answer';

/** Estados que el host publica en `presence/{machineId}`. */
export type HostState = 'online' | 'locked' | 'degraded' | 'suspended' | 'offline';

export interface HostPresenceInfo {
  machineId: string;
  hostId: string;
  deviceName: string;
  /** Callback de logging del host (`appendLog` en main.ts). */
  log: (line: string) => void;
}

export interface HostHealth {
  ok: boolean;
  captureOk: boolean;
  idle: string;
  uptime: number;
}

type PendingProbe = {
  requestId?: unknown;
  requestedAt?: unknown;
  requestedBy?: unknown;
  state?: unknown;
  dispatchedAt?: unknown;
};

type Running = {
  unsubPending: Unsubscribe | null;
  /** Listeners de las órdenes de apagado (`pc_commands/...`). */
  unsubPowerCommands: Unsubscribe[];
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  bootId: string;
  bootedAt: number;
  lastHeartbeatAt: number;
  handledRequestId: string;
  info: HostPresenceInfo;
  db: Firestore;
  stopped: boolean;
};

let running: Running | null = null;

// ---------------------------------------------------------------------------
// Chequeo de salud
// ---------------------------------------------------------------------------

/**
 * "¿Está prendida y la puedo controlar?" — Heartbeat no puede contestar esto;
 * solo un chequeo en vivo.
 *
 * - `captureOk`: hay al menos una fuente de pantalla. Es el discriminador entre
 *   "prendida" y "prendida y operable": sin sesión interactiva no hay escritorio
 *   que capturar ni input que inyectar.
 * - `idle`: `locked` significa sesión bloqueada (Win+L, cambio de usuario). Se
 *   puede ver pero no se puede controlar.
 */
async function runHealthCheck(): Promise<HostHealth> {
  let captureOk = false;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    captureOk = sources.length > 0;
  } catch (err) {
    console.warn('[presence] getSources falló:', err);
    captureOk = false;
  }

  let idle = 'unknown';
  try {
    // El intervalo es obligatorio en los tipos de Electron 44; 5 s es el default
    // documentado. Solo se usa para el cálculo del estado idle.
    idle = powerMonitor.getSystemIdleState(5);
  } catch {
    // getSystemIdleState no existe en todas las plataformas; 'unknown' es válido.
  }

  return { ok: true, captureOk, idle, uptime: Math.round(process.uptime()) };
}

function stateFor(health: HostHealth): HostState {
  if (!health.captureOk) {
    return 'degraded';
  }
  if (health.idle === 'locked') {
    return 'locked';
  }
  return 'online';
}

// ---------------------------------------------------------------------------
// IP LAN
// ---------------------------------------------------------------------------

/**
 * Detecta la IPv4 LAN "real" (la que el router asigna por DHCP, no
 * loopback, ni las de adaptadores virtuales que siempre están en una
 * desktop con Docker / WSL / Hyper-V / VPN).
 *
 * Cuesta un syscall barato (`os.networkInterfaces()`) y se llama en cada
 * `publishState`. Como sólo se publica cada 5 min (o por evento de
 * `powerMonitor`), el costo es despreciable, y la IP se mantiene fresca
 * aunque el router la renueve: el siguiente latido publica la nueva.
 *
 * Criterios:
 *   - IPv4 (descarta IPv6; no nos sirve para TCP/ping desde la tablet).
 *   - `internal:false` (descarta loopback 127.x).
 *   - Si el nombre del adaptador sugiere VM/virtual/Docker/WSL/etc., se
 *     descarta (heurístico, no perfecto en Windows 11 con nombres tipo
 *     "Ethernet 3"; devolvería la IP virtual antes que nada).
 *
 * Devuelve cadena vacía si no encuentra nada; en ese caso el Android cae
 * al fallback (IP configurada a mano / descubrimiento por MAC).
 *
 * `pickNonVirtualIpv4` separa las IPs "buenas" de las típicas de VMs que
 * también son IPv4/no-internal: prioriza los adaptadores reales y solo
 * como último recurso devuelve una IP "virtual". De ese modo el
 * emparejado del Android apunta a la NIC que de verdad tiene al router.
 */
function pickNonVirtualIpv4(): string {
  const VIRTUAL = /^(vmware|virtual|hyper-v|docker|wsl|vethernet|vmnet|loopback|teredo|isatap|6to4|npcap|tap|tun)/i;
  const interfaces = os.networkInterfaces();
  let fallback = '';
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (VIRTUAL.test(name)) {
        if (!fallback) fallback = addr.address;
        continue;
      }
      return addr.address;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Publicación
// ---------------------------------------------------------------------------

function rootRef(db: Firestore, machineId: string) {
  return doc(db, PRESENCE_COLLECTION, machineId);
}

function probeRef(db: Firestore, machineId: string, name: string) {
  return doc(db, PRESENCE_COLLECTION, machineId, PRESENCE_PROBE_SUBCOLLECTION, name);
}

/**
 * Escribe el estado del host. Un write por evento o por probe atendido; nunca en
 * bucle, salvo el heartbeat (`PRESENCE_HEARTBEAT_MS`) que es la ÚNICA razón por
 * la que este doc se actualiza periódicamente. Ante un error solo se registra:
 * la presencia es informativa y no debe tumbar ni ensuciar el Signaling.
 */
async function publishState(state: HostState, health?: HostHealth): Promise<void> {
  const ctx = running;
  if (!ctx || ctx.stopped) {
    return;
  }
  const now = Date.now();
  // Si el publicador es el latido periódico, marcamos `lastHeartbeatAt` además
  // de `lastEventAt`. Si es un evento de powerMonitor o la respuesta a un
  // probe, ambos campos se actualizan igual: el evento siempre refresca la
  // señal de vida, y el último latido es como mucho `PRESENCE_HEARTBEAT_MS`
  // más viejo (lo cual es acceptable porque el siguiente latido lo traerá al
  // día). Marcar ambos SIEMPRE mantiene simple la lógica y elimina ramas.
  ctx.lastHeartbeatAt = now;
  // `lastLocalIp` se calcula en cada publish para reflejar el DHCP renoveado
  // sin necesidad de un evento de cambio de red (que no expone Electron
  // cross-platform). Cadena vacía = "no pude determinarla"; el Android la
  // ignora y cae al fallback de IP configurada.
  const lastLocalIp = pickNonVirtualIpv4();
  try {
    await setDoc(
      rootRef(ctx.db, ctx.info.machineId),
      {
        machineId: ctx.info.machineId,
        hostId: ctx.info.hostId,
        deviceName: ctx.info.deviceName,
        appVersion: APP_VERSION,
        state,
        bootId: ctx.bootId,
        bootedAt: ctx.bootedAt,
        lastEventAt: now,
        lastHeartbeatAt: now,
        lastLocalIp,
        ...(health ? { captureOk: health.captureOk, idle: health.idle } : {}),
      },
      { merge: true },
    );
  } catch (err) {
    ctx.info.log(`[presence] no se pudo publicar estado=${state} ip=${lastLocalIp}: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

async function answerProbe(requestId: string, req: PendingProbe): Promise<void> {
  const ctx = running;
  if (!ctx || ctx.stopped) {
    return;
  }
  const startedAt = Date.now();
  const health = await runHealthCheck();
  const state = stateFor(health);
  try {
    await setDoc(
      probeRef(ctx.db, ctx.info.machineId, ANSWER_DOC),
      {
        requestId,
        requestedBy: String(req.requestedBy ?? ''),
        ok: health.ok,
        captureOk: health.captureOk,
        idle: health.idle,
        uptime: health.uptime,
        state,
        bootId: ctx.bootId,
        respondedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
      },
      { merge: true },
    );
    ctx.info.log(
      `[presence] probe ${requestId} -> capture=${health.captureOk ? 'ok' : 'NO'} idle=${health.idle} state=${state}`,
    );
  } catch (err) {
    ctx.info.log(`[presence] no se pudo responder probe ${requestId}: ${String(err)}`);
  }
  await publishState(state, health);
}

function handlePendingSnapshot(snap: { exists: () => boolean; data: () => unknown }): void {
  const ctx = running;
  if (!ctx || ctx.stopped || !snap.exists()) {
    return;
  }
  const data = snap.data() as PendingProbe | undefined;
  if (!data || data.state !== 'dispatched') {
    return;
  }
  const requestId = String(data.requestId ?? '');
  if (!requestId || requestId === ctx.handledRequestId) {
    return;
  }
  const dispatchedAt = Number(data.dispatchedAt ?? 0);
  if (!dispatchedAt || Date.now() - dispatchedAt > PROBE_MAX_AGE_MS) {
    ctx.info.log(`[presence] probe ${requestId} descartado por antigüedad`);
    return;
  }
  ctx.handledRequestId = requestId;
  void answerProbe(requestId, data);
}

// ---------------------------------------------------------------------------
// Apagado remoto (orden `powerOn=false` en pc_commands/{machineId})
// ---------------------------------------------------------------------------

type PowerCommand = {
  powerOn?: unknown;
  timestamp?: unknown;
  senderDevice?: unknown;
};

/** Último `timestamp` de una orden de apagado ya ejecutada, por doc escuchado. */
const lastPowerOffTs = new Map<string, number>();

/**
 * Orden de apagado confirmada: publicamos `offline` (mejor esfuerzo) y luego
 * ejecutamos el shutdown del SO. La energía la corta el sistema, no este
 * proceso; acá solo se da la orden. En Windows `shutdown /t 10` deja margen
 * para que `powerMonitor` emita su evento `shutdown` y la presencia diga
 * offline; en macOS `osascript` es el cierre gráfico sin requerir root.
 */
async function onRemotePowerOff(): Promise<void> {
  const ctx = running;
  if (!ctx) {
    return;
  }
  ctx.info.log('[presence] orden de apagado remoto OK: ejecutando shutdown del SO');
  await publishState('offline');
  const cmd =
    process.platform === 'win32'
      ? 'shutdown.exe /s /t 10 /c "IsisAnubis: apagado remoto solicitado"'
      : process.platform === 'darwin'
        ? 'osascript -e \'tell application "System Events" to shut down\''
        : 'shutdown -h now';
  ctx.info.log(`[presence] ejecutando: ${cmd}`);
  exec(cmd, { windowsHide: true, timeout: 15_000 }, (err, _stdout, stderr) => {
    if (!err) {
      ctx.info.log('[presence] shutdown del SO enviado correctamente');
      return;
    }
    ctx.info.log(
      `[presence] el shutdown del SO falló: ${err.message}${stderr ? ` ${stderr.trim()}` : ''}`,
    );
  });
}

/**
 * Filtra y deduplica el doc de comandos:
 *   - solo reacciona a `powerOn === false` (el `true` es WoL y lo maneja la
 *     tableta desde `pc_commands/desktop`);
 *   - exige `timestamp` fresco (nunca apagar por una orden vieja que quedó en
 *     el doc al arrancar el host);
 *   - nunca re-ejecuta un timestamp ya visto (los snapshots se re-emiten).
 */
function handlePowerCommandSnapshot(
  pathKey: string,
  snap: { exists: () => boolean; data: () => unknown },
): void {
  const ctx = running;
  if (!ctx || ctx.stopped || !snap.exists()) {
    return;
  }
  const data = snap.data() as PowerCommand | undefined;
  if (!data || data.powerOn !== false) {
    return;
  }
  const ts = Number(data.timestamp ?? 0);
  if (!ts) {
    return;
  }
  const now = Date.now();
  if (ts > now + 60_000 || now - ts > POWER_OFF_ACCEPT_WINDOW_MS) {
    ctx.info.log(`[presence] comando de apagado ignorado (timestamp fuera de ventana ts=${ts})`);
    return;
  }
  const previous = lastPowerOffTs.get(pathKey) ?? 0;
  if (ts <= previous) {
    return;
  }
  lastPowerOffTs.set(pathKey, ts);
  ctx.info.log(`[presence] apagado solicitado por "${String(data.senderDevice ?? '?')}" (ts=${ts})`);
  void onRemotePowerOff();
}

/**
 * Escucha las órdenes de apagado en `pc_commands/{machineId}` (el doc propio
 * del host). El cliente de escritorio escribe ahí por equipo emparejado
 * (`pc_commands/{pair.hostId}`), así que con varios hosts cada uno apaga SOLO
 * su máquina — a diferencia del WoL, que es single-host por diseño y pasa por
 * el doc legacy "desktop" (ver `PC_COMMANDS_DOC_ID`).
 */
function subscribePowerCommands(): void {
  const ctx = running;
  if (!ctx) {
    return;
  }
  const { db, info } = ctx;
  info.log(`[presence] escuchando órdenes de apagado en pc_commands/${info.machineId}`);
  ctx.unsubPowerCommands.push(
    onSnapshot(
      doc(db, PC_COMMANDS_COLLECTION, info.machineId),
      (snap) => handlePowerCommandSnapshot(info.machineId, snap),
      (err) =>
        info.log(`[presence] error del listener de comandos pc_commands/${info.machineId}: ${String(err)}`),
    ),
  );
}

// ---------------------------------------------------------------------------
// Arranque / parada
// ---------------------------------------------------------------------------

function newBootId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Traduce un evento de `powerMonitor` a una publicación de estado.
 *
 * En `resume` y `unlock-screen` conviene re-chequear la salud en vez de asumir
 * "online": al volver de suspender o de desbloquear, la captura puede seguir
 * fallando y la UI merecería saberlo en lugar de mostrar una mentira.
 */
async function onPowerEvent(event: string, state: HostState): Promise<void> {
  const ctx = running;
  if (!ctx) {
    return;
  }
  ctx.info.log(`[presence] powerMonitor ${event} -> ${state}`);
  if (event === 'resume' || event === 'unlock-screen') {
    const health = await runHealthCheck();
    await publishState(stateFor(health), health);
    return;
  }
  await publishState(state);
}

/**
 * Levanta presencia en el host. `db` debe venir del SDK web (`getFirebaseDb()`):
 * el host no usa Admin SDK, así que sus escrituras están sujetas a las reglas de
 * Firestore (hoy abiertas para `presence`, ver `firestore.rules`).
 */
export function startPresence(db: Firestore, info: HostPresenceInfo): void {
  if (running) {
    return;
  }
  const machineId = info.machineId || PRESENCE_MACHINE_ID;
  const now = Date.now();
  running = {
    unsubPending: null,
    unsubPowerCommands: [],
    heartbeatTimer: null,
    bootId: newBootId(),
    bootedAt: now,
    lastHeartbeatAt: now,
    handledRequestId: '',
    info: { ...info, machineId },
    db,
    stopped: false,
  };
  const ctx = running;
  info.log(
    `[presence] arranca bootId=${ctx.bootId} machine=${machineId} heartbeat=${PRESENCE_HEARTBEAT_MS}ms`,
  );

  // Publicación por eventos de powerMonitor. `shutdown` es el que tiene mejor
  // chance de llegar antes de que Windows corte la energía.
  powerMonitor.on('suspend', () => void onPowerEvent('suspend', 'suspended'));
  powerMonitor.on('resume', () => void onPowerEvent('resume', 'online'));
  powerMonitor.on('lock-screen', () => void onPowerEvent('lock-screen', 'locked'));
  powerMonitor.on('unlock-screen', () => void onPowerEvent('unlock-screen', 'online'));
  powerMonitor.on('shutdown', () => void onPowerEvent('shutdown', 'offline'));

  ctx.unsubPending = onSnapshot(
    probeRef(db, machineId, PENDING_DOC),
    (snap) => handlePendingSnapshot(snap),
    (err) => {
      info.log(`[presence] error del listener de probe: ${String(err)}`);
    },
  );

  subscribePowerCommands();

  // Heartbeat: publica el doc cada PRESENCE_HEARTBEAT_MS. Aunque no haya
  // ocurrido nada, le dice a la app Android "estoy vivo". El health check
  // adentro es el mismo que dispara un evento de powerMonitor, así que si la
  // PC se bloqueó/suspendió el doc va a reflejarlo y no una mentira.
  ctx.heartbeatTimer = setInterval(() => {
    void runHealthCheck().then((health) => publishState(stateFor(health), health));
  }, PRESENCE_HEARTBEAT_MS);

  // Primer latido inmediato: no esperamos 5 minutos para que el teléfono vea
  // algo fresco al primer arranque. Equivale al publish que ya hacíamos en
  // arranque, ahora además deja `lastHeartbeatAt` poblado.
  void runHealthCheck().then((health) => publishState(stateFor(health), health));
}

/**
 * Detiene presencia. El write de `shutdown` es mejor-esfuerzo: `before-quit` no
 * garantiza que la escritura llegue a Firestore antes de que Windows corte la
 * energía. Para el apagado limpio el evento `shutdown` de `powerMonitor` es
 * quien tiene la mejor chance.
 */
export function stopPresence(): void {
  const ctx = running;
  if (!ctx) {
    return;
  }
  ctx.stopped = true;
  if (ctx.heartbeatTimer !== null) {
    clearInterval(ctx.heartbeatTimer);
    ctx.heartbeatTimer = null;
  }
  ctx.unsubPending?.();
  ctx.unsubPending = null;
  for (const unsub of ctx.unsubPowerCommands) {
    unsub();
  }
  ctx.unsubPowerCommands = [];
  running = null;
  ctx.info.log('[presence] detenido');
}