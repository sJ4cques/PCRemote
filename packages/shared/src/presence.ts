import {
  getDoc,
  setDoc,
  doc,
  type Firestore,
} from "firebase/firestore";
import {
  PC_COMMANDS_COLLECTION,
  PC_COMMANDS_DOC_ID,
  PRESENCE_COLLECTION,
  PRESENCE_MACHINE_ID,
  PRESENCE_STALE_AFTER_MS,
} from "./config";

/**
 * Estados que el host publica en `presence/{machineId}` (mirror del tipo
 * `HostState` del host-app). `""` = el doc no trajo `state` (doc recién creado
 * o formato inesperado).
 *
 * La semántica de "encendido" NO es solo `state`:
 *   - `state=online/locked/degraded` y heartbeat fresco -> encendida y viva.
 *   - heartbeat vencido (más viejo que PRESENCE_STALE_AFTER_MS) -> "sin señal":
 *     pudo apagarse, dormirse o caerse la red entre el host y Firestore.
 *   - sin doc / nunca publicó -> apagada o nunca encendida.
 */
export type HostState = "online" | "locked" | "degraded" | "suspended" | "offline" | "";

/** Snapshot normalizado de `presence/{hostId}` para las apps de escritorio. */
export interface HostPresenceSnapshot {
  state: HostState;
  deviceName: string;
  hostId: string;
  bootId: string;
  bootedAt: number;
  lastEventAt: number;
  /** Epoch ms del último latido; 0 si el doc no trae el campo. */
  lastHeartbeatAt: number;
  /** IPv4 LAN que el host publicó en su último heartbeat (vacía si no pudo). */
  lastLocalIp: string;
  captureOk: boolean;
  idle: string;
  appVersion: string;
}

/** `true` si el heartbeat sigue describiendo el presente (dentro del umbral de
 *  staleness). Es la señal principal de "el host está vivo AHORA". */
export function isPresenceFresh(snap: HostPresenceSnapshot, nowMs: number = Date.now()): boolean {
  return snap.lastHeartbeatAt > 0 && nowMs - snap.lastHeartbeatAt <= PRESENCE_STALE_AFTER_MS;
}

/** `true` si el último estado publicado corresponde a una PC encendida
 *  (independiente de la frescura: combinar con `isPresenceFresh`). */
export function isHostPoweredOn(snap: HostPresenceSnapshot): boolean {
  return snap.state === "online" || snap.state === "locked" || snap.state === "degraded";
}

/** Etiqueta legible del estado publicada por el host. */
export function hostStateLabel(snap: HostPresenceSnapshot): string {
  switch (snap.state) {
    case "online":
      return "Encendida";
    case "locked":
      return "Encendida (bloqueada)";
    case "degraded":
      return "Encendida (sin escritorio)";
    case "suspended":
      return "Suspendida";
    case "offline":
      return "Apagada";
    default:
      return "Estado desconocido";
  }
}

const lastHeartbeatAge = (snap: HostPresenceSnapshot, nowMs: number): string => {
  if (snap.lastHeartbeatAt <= 0) {
    return "sin sello de hora";
  }
  const s = Math.max(0, (nowMs - snap.lastHeartbeatAt) / 1000);
  if (s < 60) return `hace ${Math.max(1, Math.round(s))} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
};

/**
 * Lee `presence/{hostId}` y devuelve un snapshot normalizado, o `null` si el
 * doc no existe (host apagado/nunca publicó). Nunca lanza: cualquier error se
 * devuelve como `null` para que la UI muestre "sin datos" en vez de crashear.
 */
export async function readHostPresence(
  db: Firestore,
  hostId: string,
): Promise<HostPresenceSnapshot | null> {
  const id = hostId || PRESENCE_MACHINE_ID;
  try {
    const snap = await getDoc(doc(db, PRESENCE_COLLECTION, id));
    if (!snap.exists()) {
      return null;
    }
    const d = snap.data() as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "0")) || 0);
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    return {
      state: (str(d.state) as HostState) || "",
      deviceName: str(d.deviceName),
      hostId: str(d.hostId),
      bootId: str(d.bootId),
      bootedAt: num(d.bootedAt),
      lastEventAt: num(d.lastEventAt),
      lastHeartbeatAt: num(d.lastHeartbeatAt),
      lastLocalIp: str(d.lastLocalIp),
      captureOk: Boolean(d.captureOk),
      idle: str(d.idle),
      appVersion: str(d.appVersion),
    };
  } catch (err) {
    console.error(`[presence] readHostPresence(${id}) falló:`, err);
    return null;
  }
}

/** Descripción corta para mostrar en la UI del cliente (mirror de lo que hace
 *  el Android con su `HostPresenceCard`). */
export function presenceSummary(snap: HostPresenceSnapshot, nowMs: number = Date.now()): string {
  const name = snap.deviceName || "PC";
  if (!isPresenceFresh(snap, nowMs)) {
    return `${name} · sin señal (${lastHeartbeatAge(snap, nowMs)})`;
  }
  return `${name} · ${hostStateLabel(snap)}`;
}

/**
 * Escribe la orden de encendido WoL que la tableta escucha en
 * `pc_commands/{docId}` (`powerOn=true` + timestamp fresco + senderDevice).
 *
 * La app Android en modo tablet relee ese doc y, cuando el timestamp avanza
 * con `powerOn=true`, dispara el magic packet a la MAC/broadcast configurados.
 * Mismo mecanismo que usa el teléfono (`enviar_comando_pc`).
 *
 * Se usa `merge: true` para NO pisar `pcOnline/pcCheckedAt/pcMethod` que la
 * propia tableta escribe ahí con el resultado de su chequeo LAN.
 */
export async function sendWakeCommand(db: Firestore, senderDevice = "client"): Promise<void> {
  await setDoc(
    doc(db, PC_COMMANDS_COLLECTION, PC_COMMANDS_DOC_ID),
    {
      powerOn: true,
      timestamp: Date.now(),
      senderDevice,
    },
    { merge: true },
  );
}

/**
 * Escribe la orden de APAGADO que el HOST ejecuta en la PC remota
 * (`powerOn=false` + timestamp fresco + senderDevice).
 *
 * A diferencia del WoL (que va a `pc_commands/desktop` porque la tableta lo
 * relee para disparar el magic packet), la orden de apagado va al doc del HOST
 * destino: `pc_commands/{hostId}`. El host escucha ESE doc (y el alias legacy
 * "desktop", por el teléfono Android) y ejecuta el shutdown del SO solo si el
 * `timestamp` es reciente (`POWER_OFF_ACCEPT_WINDOW_MS`). Así, si algún día hay
 * dos PCs, cada host apaga SOLO su máquina.
 *
 * La tableta ignora `powerOn=false` (solo reacciona al `true` para WoL), así
 * que no hay conflicto por compartir colección.
 */
export async function sendPowerOffCommand(
  db: Firestore,
  hostId: string,
  senderDevice = "client",
): Promise<void> {
  const id = hostId || PC_COMMANDS_DOC_ID;
  await setDoc(
    doc(db, PC_COMMANDS_COLLECTION, id),
    {
      powerOn: false,
      timestamp: Date.now(),
      senderDevice,
    },
    { merge: true },
  );
}