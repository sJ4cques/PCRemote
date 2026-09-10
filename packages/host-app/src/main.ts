import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  Menu,
  screen,
  session,
  Tray,
} from 'electron';
import { mouse, keyboard, Key } from '@nut-tree-fork/nut-js';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import started from 'electron-squirrel-startup';
import {
  handleInputMessage,
  pressedButtonState,
  resetMouseButtons,
} from './input';

if (started) {
  app.quit();
}

// El renderer captura/controla sin gesto del usuario (sesión remota desatendida).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------------------------------------------------------------------------
// Configuración persistente del host (userData/isis-host.json)
// ---------------------------------------------------------------------------

interface HostConfigFile {
  hostId: string;
  secret: string;
  deviceName: string;
  service: boolean;
  autostart: boolean;
  desktopAudio: boolean;
}

const PAIR_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomKey(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  }
  return out;
}

const configPath = (): string => path.join(app.getPath('userData'), 'isis-host.json');

function loadConfig(): HostConfigFile {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8') as string;
    const cfg = JSON.parse(raw) as Partial<HostConfigFile>;
    if (typeof cfg.hostId === 'string' && cfg.hostId && typeof cfg.secret === 'string' && cfg.secret) {
      return {
        hostId: cfg.hostId,
        secret: cfg.secret,
        deviceName: typeof cfg.deviceName === 'string' ? cfg.deviceName : 'Mi equipo',
        service: Boolean(cfg.service),
        autostart: Boolean(cfg.autostart),
        desktopAudio: Boolean(cfg.desktopAudio),
      };
    }
  } catch {
    // primer arranque o archivo corrupto
  }
  const fresh: HostConfigFile = {
    hostId: randomKey(8),
    secret: randomKey(8),
    deviceName: 'Mi equipo',
    service: false,
    autostart: false,
    desktopAudio: false,
  };
  saveConfig(fresh);
  return fresh;
}

function saveConfig(cfg: HostConfigFile): void {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[host] no se pudo guardar la config:', err);
  }
}

// ---------------------------------------------------------------------------
// Argumentos de línea de comandos (pruebas/automatización)
// ---------------------------------------------------------------------------

const argValue = (key: string): string | undefined => {
  const prefix = `${key}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};

const isisCode = argValue('--isis-code');
const isisPin = argValue('--isis-pin');
const isisSessionTtl = argValue('--isis-session-ttl');
const isisSimulateVideo = process.argv.includes('--isis-simulate-video');
const isisSimulateAudio = process.argv.includes('--isis-simulate-audio');
const isisFakeInput = process.argv.includes('--isis-fake-input');
// Sobrescriben la config para pruebas (no se persisten).
const isisHostId = argValue('--isis-host-id');
const isisPairSecret = argValue('--isis-pair-secret');
// Lanza en modo servicio (ventana oculta) aunque la config no lo pida.
const isisService = process.argv.includes('--isis-service');
// Fuerza el modo manual (sesión temporal por código) aunque haya emparejamiento.
const isisManual = process.argv.includes('--isis-manual');
// Diagnóstico de captura al arrancar (sin necesidad de cliente).
const isisCaptureTest = process.argv.includes('--isis-capture-test');
// Salta la captura legacy por getUserMedia y usa getDisplayMedia directamente.
const isisForceGdm = process.argv.includes('--isis-force-getdisplaymedia');
// Habilita el audio de escritorio (loopback) DEL HOST. Está desactivado por
// defecto: en algunos Windows, abrir una segunda captura (solo audio) junto a
// la de video degrada el renderer y rompe el pipeline de input (mouse/clics).
const isisDesktopAudio = process.argv.includes('--isis-desktop-audio');

// ---------------------------------------------------------------------------
// Log rotativo a userData/isis-host.log (diagnóstico en equipos sin consola)
// ---------------------------------------------------------------------------

function appendLog(line: string): void {
  try {
    const p = path.join(app.getPath('userData'), 'isis-host.log');
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (st && st.size > 2 * 1024 * 1024) {
      fs.rmSync(p, { force: true });
    }
    fs.appendFileSync(p, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // el log no debe tumbar nunca la app
  }
}

// ---------------------------------------------------------------------------
// Ventana, bandeja y ciclo de vida
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let allowClose = false;

const serviceMode = (): boolean => {
  const cfg = loadConfig();
  return isisService || cfg.service;
};

const effectiveHostInfo = (): { hostId: string; secret: string } => {
  const cfg = loadConfig();
  return {
    hostId: isisHostId ?? cfg.hostId,
    secret: isisPairSecret ?? cfg.secret,
  };
};

const desktopAudioEnabled = (): boolean => isisDesktopAudio || loadConfig().desktopAudio;

const createTray = (): void => {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray.png')
    : path.join(__dirname, '../../assets/tray.png');
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('IsisAnubis Host');
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir panel', click: () => showPanel() },
      { label: 'Ocultar ventana', click: () => mainWindow?.hide() },
      { type: 'separator' },
      {
        label: 'Desconectar sesión',
        click: () => mainWindow?.webContents.send('isis:ctrl-disconnect'),
      },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => showPanel());
  } catch (err) {
    console.error('[host] no se pudo crear el tray:', err);
  }
};

const showPanel = (): void => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
};

const createWindow = (): void => {
  const cfg = loadConfig();
  const hidden = serviceMode();

  const win = new BrowserWindow({
    width: 480,
    height: 760,
    show: !hidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // La ventana puede estar oculta y aun así el renderer debe seguir
      // ejecutando timers (polling de clipboard, stats, re-escucha).
      backgroundThrottling: false,
      additionalArguments: [
        ...(isisCode ? [`--isis-code=${isisCode}`] : []),
        ...(isisPin ? [`--isis-pin=${isisPin}`] : []),
        ...(isisSessionTtl ? [`--isis-session-ttl=${isisSessionTtl}`] : []),
        ...(isisSimulateVideo ? ['--isis-simulate-video'] : []),
        ...(isisSimulateAudio ? ['--isis-simulate-audio'] : []),
        ...(isisFakeInput ? ['--isis-fake-input'] : []),
        ...(effectiveHostInfo().hostId ? [`--isis-host-id=${effectiveHostInfo().hostId}`] : []),
        ...(effectiveHostInfo().secret ? [`--isis-pair-secret=${effectiveHostInfo().secret}`] : []),
        ...(hidden ? ['--isis-service'] : []),
        ...(isisManual ? ['--isis-manual'] : []),
        ...(isisCaptureTest ? ['--isis-capture-test'] : []),
        ...(isisForceGdm ? ['--isis-force-getdisplaymedia'] : []),
        ...(desktopAudioEnabled() ? ['--isis-desktop-audio'] : []),
      ],
    },
  });
  mainWindow = win;

  // Vuelca el console del renderer al log de la app (crítico en Windows, donde
  // no hay consola). Tolerante a ambas firmas del evento de Electron.
  win.webContents.on('console-message', (_event: unknown, ...args: unknown[]) => {
    let message = '';
    const first = args[0];
    if (
      typeof first === 'object' &&
      first !== null &&
      'message' in (first as Record<string, unknown>)
    ) {
      message = String((first as Record<string, unknown>).message ?? '');
    } else if (typeof args[1] === 'string') {
      message = args[1];
    } else if (typeof first === 'string') {
      message = first;
    }
    if (message) {
      appendLog(`[renderer] ${message}`);
    }
  });

  win.on('close', (event) => {
    // Modo servicio: cerrar la ventana la oculta, no cierra la escucha.
    if (serviceMode() && !allowClose) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());
}

// Respuesta automática a navigator.mediaDevices.getDisplayMedia: sin picker,
// se elige la primera pantalla. Es el camino recomendado en Electron actual y
// funciona con la ventana oculta (modo servicio).
app.whenReady().then(() => {
  startInputReconcile();
  startHostHealth();
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      // Rechaza la petición (electron documenta que llamar sin argumentos la deniega).
      const reject = callback as (streams?: Electron.Streams) => void;
      try {
        // Pedido solo de AUDIO (loopback de sistema): lo resolvemos sin pantalla.
        // El loopback de sistema solo existe en Windows.
        if (request.audioRequested && !request.videoRequested) {
          if (process.platform !== 'win32') {
            appendLog('[host] getDisplayMedia audio: loopback no soportado en esta plataforma');
            reject();
            return;
          }
          appendLog('[host] getDisplayMedia audio: loopback activado');
          // 'loopback' captura el audio que reproduce el host sin silenciarlo.
          callback({ audio: 'loopback' });
          return;
        }
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
        const screen = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
        if (!screen) {
          appendLog('[host] getDisplayMedia: sin fuentes de pantalla');
          reject();
          return;
        }
        appendLog(`[host] getDisplayMedia: fuente=${screen.id} name=${screen.name}`);
        callback({ video: screen });
      } catch (err) {
        appendLog(`[host] getDisplayMedia handler error: ${String(err)}`);
        reject();
      }
    },
    { useSystemPicker: false },
  );
});

/** Nombre de la tarea programada de autostart. */
const AUTOSTART_TASK_NAME = 'IsisAnubis Host';

function runCmd(cmd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, output: (stderr || stdout || String(err)).trim() });
      } else {
        resolve({ ok: true, output: (stdout || stderr).trim() });
      }
    });
  });
}

/** Autostart con ELEVACIÓN real: crea una tarea programada que corre el host en
 *  el inicio de sesión con privilegios máximos (`/RL HIGHEST`). A diferencia del
 *  `setLoginItemSettings` (que arranca como usuario normal), así el host corre
 *  ELEVADO siempre, condición necesaria para inyectar input en los menús/
 *  flyouts elevados de bandeja y taskbar de Windows 11 (UIPI). */
async function applyAutostart(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const cfg = loadConfig();
  cfg.autostart = on;
  saveConfig(cfg);
  if (!app.isPackaged) {
    console.log(`[host] autostart ${on ? 'ON' : 'OFF'} (dev: solo se persiste la config)`);
    return { ok: true };
  }
  if (on) {
    // /TR con la ruta entre comillas escapadas: el patrón estándar para que
    // schtasks acepte una ruta con espacios como comando único.
    const res = await runCmd(
      `schtasks /Create /F /TN "${AUTOSTART_TASK_NAME}" /TR \\"${process.execPath}\\" /SC ONLOGON /RL HIGHEST`,
    );
    if (res.ok) {
      appendLog('[host] autostart ON: tarea programada con privilegios máximos');
      return { ok: true };
    }
    appendLog(`[host] autostart ON falló al crear la tarea: ${res.output}`);
    return { ok: false, error: res.output };
  }
  const res = await runCmd(`schtasks /Delete /F /TN "${AUTOSTART_TASK_NAME}"`);
  appendLog(`[host] autostart OFF: ${res.ok ? 'tarea eliminada' : res.output}`);
  return { ok: res.ok, error: res.ok ? undefined : res.output };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input del cliente: cola SERIALIZADA + coalescing de moves.
// nut-js no tolera llamadas solapadas (un move entre press/release rompe el
// clic) y una ráfaga de moves sin coalescing genera backlog que "traba" el mouse.
// ---------------------------------------------------------------------------

const inputQueue: Parameters<typeof handleInputMessage>[0][] = [];
let inputDraining = false;
/** Cuándo terminó la última operación inyectada (para la reconciliación segura). */
let lastInputOpAt = Date.now();
/** Cuándo EMPEZÓ la operación que la cola está inyectando ahora. Si esto queda
 *  viejo con `inputDraining === true`, la llamada nativa de nut-js se colgó
 *  (p. ej. al abrir el Task Manager o una ventana elevada que bloquea el input)
 *  y el pipeline quedó congelado: hay que recuperarlo aunque la cola esté en
 *  mitad de drenaje. */
let lastInputStartAt = Date.now();
/** Cuándo fue la última operación de BOTÓN (down/up/click) recibida. Los moves
 *  NO cuentan: un `up` perdido deja el botón pulsado y los moves posteriores
 *  "arrastran" en vez de mover, por eso el reconcile no puede basarse solo en
 *  el reposo total del input. */
let lastButtonOpAt = Date.now();
/** Cuándo fue el último move recibido (para distinguir arrastre activo de un
 *  botón muerto de verdad). */
let lastMoveAt = Date.now();
/** Evita loguear el reconcile sin parar cuando el fallo persiste. */
let lastReconcileLogAt = 0;
/** Cuándo recibió el main el último mensaje `isis:input` del renderer. Si pasa
 *  mucho tiempo sin llegar mensajes, el fallo está ANTES de la cola (renderer
 *  o DataChannel muertos), no en la inyección. Crucial para diagnosticar: la
 *  cola puede estar sana y vacía mientras "nada funciona" porque ya no llega
 *  nada del cliente. */
let lastInputReceivedAt = Date.now();
let lastHealthLogAt = 0;
let lastHealthRecoveryAt = 0;

/**
 * Aplica un mensaje serializado.
 *
 * Un timeout NO puede cancelar una llamada de nut-js que se cuelga, y abortar
 * con Promise.race dejaría el botón a mitad de vuelo; por eso la recuperación
 * real la hace `reconcileStuck` cuando se detecta la operación colgada. Aquí
 * registramos el inicio de la operación y, si sigue en vuelo pasados 8 s,
 * forzamos la liberación de botones en el SO como recuperación activa.
 */
async function applyWithWatchdog(
  msg: Parameters<typeof handleInputMessage>[0],
): Promise<void> {
  const label = JSON.stringify(msg.payload).slice(0, 80);
  const startedAt = Date.now();
  lastInputStartAt = startedAt;
  let slow = false;
  const slowTimer = setTimeout(() => {
    slow = true;
    appendLog(`[host] input_watchdog ${label} LENTO (>3s, sigue en vuelo)`);
  }, 3000);
  const stuckTimer = setTimeout(() => {
    appendLog(`[host] input_watchdog ${label} COLGADO (>8s); forzando liberación de botones`);
    void resetMouseButtons(appendLog).catch(() => undefined);
  }, 8000);
  try {
    await handleInputMessage(msg, appendLog);
    if (slow) {
      appendLog(`[host] input_watchdog ${label} terminó tras el aviso`);
    }
  } catch (err) {
    appendLog(`[host] input_watchdog ${label} error: ${String(err)}`);
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(stuckTimer);
    lastInputOpAt = Date.now();
    // Si una operación tardó muchísimo, el SO pudo quedar con un botón a medio
    // presionar aunque libnut haya "resuelto": reconciliar igual.
    if (Date.now() - startedAt > 8000 && pressedButtonState()) {
      appendLog('[host] operación muy lenta, reset de botones tras terminar');
      void resetMouseButtons(appendLog).catch(() => undefined);
    }
  }
}

function pushInput(msg: Parameters<typeof handleInputMessage>[0]): void {
  lastInputReceivedAt = Date.now();
  if (msg.kind === 'mouse') {
    if (msg.payload.type === 'move') {
      lastMoveAt = Date.now();
      const existing = inputQueue.findIndex(
        (m) => m.kind === 'mouse' && m.payload.type === 'move',
      );
      if (existing !== -1) {
        inputQueue[existing] = msg;
        return;
      }
    } else if (msg.payload.type === 'scroll') {
      // Coalescer el scroll igual que los moves: los deltas son RELATIVOS, así
      // que fusionarlos con el scroll ya encolado es semánticamente idéntico y
      // evita que una ráfaga de rueda/trackpad (cientos de eventos con deltas
      // diminutos, cada uno ~200 ms en nut-js) sature la cola serializada y la
      // deje consumiendo durante 30+s — el "freeze total" observado en el log.
      // El ejecutor ya acota cada op a 10 pasos, así que acumular no desborda.
      const existing = inputQueue.findIndex(
        (m) => m.kind === 'mouse' && m.payload.type === 'scroll',
      );
      if (existing !== -1) {
        const cur = inputQueue[existing].payload as {
          type: 'scroll';
          deltaX: number;
          deltaY: number;
        };
        cur.deltaX += msg.payload.deltaX;
        cur.deltaY += msg.payload.deltaY;
        return;
      }
    } else {
      lastButtonOpAt = Date.now();
    }
  }
  inputQueue.push(msg);
  void drainInput();
}

async function drainInput(): Promise<void> {
  if (inputDraining) {
    return;
  }
  inputDraining = true;
  try {
    while (inputQueue.length > 0) {
      if (inputQueue.length >= 25) {
        appendLog(`[host] input backlog=${inputQueue.length}`);
      }
      const next = inputQueue.shift() as Parameters<typeof handleInputMessage>[0];
      await applyWithWatchdog(next);
    }
  } finally {
    inputDraining = false;
    if (inputQueue.length > 0) {
      void drainInput();
    }
  }
}

/**
 * Reconciliación de botones / recuperación de la cola. A diferencia de las
 * versiones anteriores (que exigían `!inputDraining` y por eso NO funcionaban
 * cuando una llamada nativa se colgaba — exactamente el freeze del Task
 * Manager), aquí la recuperación es INDEPENDIENTE de si la cola sigue drenando:
 *
 *  1. Botón pulsado sin operaciones de botón nuevas + mouse quieto  >3 s
 *     (o >10 s aunque siga moviéndose: arrastre real muy largo) → el `up` se
 *     perdió, liberamos.
 *  2. Una operación lleva >6 s en vuelo con `inputDraining` activo → llamada
 *     nativa colgada; liberamos botones igualmente.
 *  3. Operación colgada >15 s (vuelo muerto): reiniciamos el pipeline descartando
 *     lo pendiente y permitiendo que la cola vuelva a drenar. El colgado original
 *     terminará solo; sus efectos residuales se neutralizan con el reset.
 */
function reconcileStuck(): void {
  const now = Date.now();
  let why: string | null = null;

  if (pressedButtonState()) {
    const buttonIdleMs = now - lastButtonOpAt;
    const moveIdleMs = now - lastMoveAt;
    const stuckButton = moveIdleMs > 2000 ? buttonIdleMs > 3000 : buttonIdleMs > 10000;
    if (stuckButton) {
      why = `botón colgado button_idle=${buttonIdleMs}ms move_idle=${moveIdleMs}ms`;
    }
  }
  if (inputDraining && now - lastInputStartAt > 6000 && pressedButtonState()) {
    why = `operación colgada op_idle=${now - lastInputStartAt}ms`;
  }
  if (why) {
    if (now - lastReconcileLogAt > 3000) {
      lastReconcileLogAt = now;
      appendLog(`[host] reconcile recuperando: ${why}`);
    }
    void resetMouseButtons(appendLog).catch(() => undefined);
  }

  // Cola congelada de verdad: la llamada nativa no va a volver. Reiniciamos el
  // pipeline para que el usuario recupere el control sin esperar a que termine.
  if (inputDraining && now - lastInputStartAt > 10000) {
    appendLog(
      `[host] input cola CONGELADA ${now - lastInputStartAt}ms; descartando pendientes y reiniciando`,
    );
    inputQueue.length = 0;
    inputDraining = false;
    lastInputStartAt = now;
    void resetMouseButtons(appendLog).catch(() => undefined);
  }
}

/** Si la cola de input está congelada (operación nativa colgada >10 s), la
 *  reinicia para que los inputs nuevos vuelvan a procesarse. Se usa además del
 *  reconcile por el `inputReset`/cierre de sesión, para recuperar sin esperar. */
function kickInputPipelineIfStuck(): void {
  const idle = Date.now() - lastInputStartAt;
  if (inputDraining && idle > 10000) {
    appendLog(`[host] input cola CONGELADA ${idle}ms; reiniciada`);
    inputQueue.length = 0;
    inputDraining = false;
    lastInputStartAt = Date.now();
  }
}

function startInputReconcile(): void {
  setInterval(reconcileStuck, 1000);
}

/**
 * Heartbeat de salud del pipeline de input, cada 3 s. Escribe un resumen en el
 * log (una vez cada 10 s) para que ANY fallo quede documentado, y auto-recupera
 * si el input del cliente dejó de llegar (>15 s) estando el pipeline con trabajo
 * pendiente o botones pulsados: eso indica un host atascado (p. ej. después de
 * interactuar con un menu/flyout del sistema) aunque los mensajes siguieran
 * llegando antes.
 */
function startHostHealth(): void {
  setInterval(() => {
    const now = Date.now();
    const inputAge = now - lastInputReceivedAt;
    const buttonsPressed = pressedButtonState();
    const stuckDraining = inputDraining && now - lastInputStartAt > 6000;
    const recovering = inputAge > 15000 && (buttonsPressed || stuckDraining);
    if (recovering && now - lastHealthRecoveryAt > 5000) {
      lastHealthRecoveryAt = now;
      appendLog(
        `[host] health input_received_ago=${Math.round(inputAge / 1000)}s pressed=${buttonsPressed} draining=${inputDraining} op_idle=${Math.round((now - lastInputStartAt) / 1000)}s -> fuerzo recuperación`,
      );
      kickInputPipelineIfStuck();
      void resetMouseButtons(appendLog).catch(() => undefined);
    } else if (now - lastHealthLogAt > 10000) {
      lastHealthLogAt = now;
      appendLog(
        `[host] health input_received_ago=${Math.round(inputAge / 1000)}s queue=${inputQueue.length} pressing=${inputDraining} pressed=${buttonsPressed} op_idle=${Math.round((now - lastInputStartAt) / 1000)}s btn_idle=${Math.round((now - lastButtonOpAt) / 1000)}s`,
      );
    }
  }, 3000);
}

ipcMain.on('isis:input', (_event, msg: unknown) => {
  pushInput(msg as Parameters<typeof handleInputMessage>[0]);
});

/** Al cerrar/cambiar de sesión: libera cualquier botón que el cliente dejó
 *  pulsado (se perdió el `up` porque el canal murió en medio del arrastre). */
ipcMain.on('isis:input-release', () => {
  if (pressedButtonState()) {
    appendLog('[host] liberando botones al cerrar la sesión');
  }
  kickInputPipelineIfStuck();
  resetMouseButtons(appendLog).catch(() => undefined);
});

/** Pánico solicitado por el cliente (`inputReset`): además de liberar botones y
 *  despejar la cola, intenta CERRAR un menú/flyout del sistema que haya quedado
 *  abierto. En Windows 11 los menús de la bandeja/taskbar corren en un proceso
 *  ELEVADO y se "tragan" el input inyectado (UIPI): al abrirse, todo lo que
 *  enviamos deja de tener efecto y el cursor se queda clavado en el menú mientras
 *  el canal cliente sigue "viendo" al host sano. Escape cierra el menú (best
 *  effort: si el menú es elevado y este proceso NO lo es, Windows lo descarta). */
ipcMain.on('isis:input-panic', () => {
  kickInputPipelineIfStuck();
  void (async () => {
    await resetMouseButtons(appendLog);
    try {
      await keyboard.pressKey(Key.Escape);
      await keyboard.releaseKey(Key.Escape);
    } catch {
      // best effort: si está bloqueado, no hay nada más que hacer aquí
    }
  })().catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Cursor del host: el renderer activa el watch y main le empuja la posición
// (nut-js) + la resolución del escritorio primario, para que el overlay del
// cliente muestre el cursor "como Chrome Remote Desktop".
// ---------------------------------------------------------------------------

let cursorWatchTimer: ReturnType<typeof setInterval> | null = null;
let cursorBusy = false;

function stopCursorWatch(): void {
  if (cursorWatchTimer !== null) {
    clearInterval(cursorWatchTimer);
    cursorWatchTimer = null;
  }
}

function pushCursorState(): void {
  if (!mainWindow || cursorBusy) {
    return;
  }
  cursorBusy = true;
  const display = screen.getPrimaryDisplay();
  const dip = display.size;
  // nut-js (y el cursor del SO) trabajan en PÍXELES FÍSICOS. Electron devuelve
  // DIPs (escalados por Windows), así que en Windows multiplicamos por
  // scaleFactor; en macOS nut-js usa puntos (lógicos), equivalentes a los DIPs.
  const scale = process.platform === 'darwin' ? 1 : display.scaleFactor;
  const width = Math.round(dip.width * scale);
  const height = Math.round(dip.height * scale);
  Promise.resolve()
    .then(() => {
      if (!mainWindow) {
        return;
      }
      // getCursorScreenPoint usa la API del SO vía Chromium: NO toca nut-js, y
      // así el watch del cursor no compite con la inyección de input.
      const c = screen.getCursorScreenPoint();
      mainWindow.webContents.send('isis:cursor-event', {
        x: Math.round(c.x * scale),
        y: Math.round(c.y * scale),
        width,
        height,
      });
    })
    .catch((err) => console.error('[host] cursor pos error:', err))
    .finally(() => {
      cursorBusy = false;
    });
}

ipcMain.on('isis:cursor-watch', () => {
  stopCursorWatch();
  const display = screen.getPrimaryDisplay();
  const scale = process.platform === 'darwin' ? 1 : display.scaleFactor;
  appendLog(
    `[host] display dip=${display.size.width}x${display.size.height} scaleOS=${display.scaleFactor} física=${Math.round(display.size.width * scale)}x${Math.round(display.size.height * scale)}`,
  );
  pushCursorState();
  cursorWatchTimer = setInterval(pushCursorState, 50);
});

ipcMain.on('isis:cursor-unwatch', () => {
  stopCursorWatch();
});

ipcMain.handle('isis:clipboard-read', () => clipboard.readText());

ipcMain.handle('isis:clipboard-write', (_event, text: unknown) => {
  clipboard.writeText(String(text ?? ''));
});

ipcMain.handle('isis:get-screen-source', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  });
  const screen = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
  if (!screen) {
    throw new Error('no se encontró ninguna pantalla');
  }
  return screen.id;
});

/** Devuelve la configuración actual (el secret en claro es para mostrarlo una vez). */
ipcMain.handle('isis:config-get', () => {
  const cfg = loadConfig();
  const info = effectiveHostInfo();
  return {
    hostId: info.hostId,
    secret: info.secret,
    deviceName: cfg.deviceName,
    service: serviceMode(),
    autostart: cfg.autostart,
    desktopAudio: desktopAudioEnabled(),
    simulateVideo: isisSimulateVideo,
    simulateAudio: isisSimulateAudio,
    fakeInput: isisFakeInput,
  };
});

ipcMain.handle('isis:config-set', (_event, patch: unknown) => {
  const cfg = loadConfig();
  const p = (patch ?? {}) as Partial<HostConfigFile>;
  if (typeof p.deviceName === 'string') {
    cfg.deviceName = p.deviceName.trim() || cfg.deviceName;
  }
  if (typeof p.service === 'boolean') {
    cfg.service = p.service;
  }
  if (typeof p.desktopAudio === 'boolean') {
    cfg.desktopAudio = p.desktopAudio;
  }
  saveConfig(cfg);
  return cfg;
});

ipcMain.handle('isis:autostart-get', async () => {
  if (!app.isPackaged) {
    return loadConfig().autostart;
  }
  const res = await runCmd(`schtasks /Query /TN "${AUTOSTART_TASK_NAME}"`);
  return res.ok;
});

ipcMain.handle('isis:autostart-set', (_event, on: unknown) => applyAutostart(Boolean(on)));

/** Regenera hostId + secreto (emparejamiento nuevo). Devuelve el par a mostrar. */
ipcMain.handle('isis:regenerate-pairing', () => {
  const cfg = loadConfig();
  cfg.hostId = randomKey(8);
  cfg.secret = randomKey(8);
  saveConfig(cfg);
  return { hostId: cfg.hostId, secret: cfg.secret };
});

ipcMain.on('isis:hide-window', () => {
  mainWindow?.hide();
});

ipcMain.on('isis:tray-status', (_event, text: unknown) => {
  if (tray) {
    tray.setToolTip(`IsisAnubis Host — ${String(text ?? '')}`);
  }
});

// ---------------------------------------------------------------------------

/** Detección de elevación del proceso (UIPI). En Windows el host debe correr
 *  ELEVADO para poder inyectar input en los menús/fllyouts elevados de la bandeja
 *  y taskbar (Win11 22H2+): si no, esos menús se abren pero ignoran el input
 *  remoto. El autostart por login item corre como usuario normal (NO elevado). */
function isProcessElevated(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    exec('whoami /groups', { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      // SID de integridad: High (S-1-16-12288) / System (S-1-16-16384) => elevado.
      resolve(/S-1-16-(12288|16384)/.test(stdout));
    });
  });
}

app.on('ready', () => {
  createWindow();
  createTray();
  void isProcessElevated().then((elevated) => {
    appendLog(
      `[host] IsisAnubis Host v0.2.0 build=input-watchdog+audio-optin desktopAudio=${desktopAudioEnabled() ? 'ON' : 'OFF'} platform=${process.platform} elevado=${elevated ? 'SI' : 'no'}`,
    );
    if (process.platform === 'win32' && !elevated) {
      appendLog(
        '[host] AVISO: proceso NO elevado — los menús elevados de bandeja/taskbar (Win11) ignorarán el input remoto',
      );
    }
  });
});

app.on('before-quit', () => {
  allowClose = true;
  stopCursorWatch();
});

app.on('window-all-closed', () => {
  if (!serviceMode() && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});