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
import { mouse } from '@nut-tree-fork/nut-js';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { handleInputMessage } from './input';

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
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      // Rechaza la petición (electron documenta que llamar sin argumentos la deniega).
      const reject = callback as (streams?: Electron.Streams) => void;
      try {
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

const applyAutostart = (on: boolean): void => {
  const cfg = loadConfig();
  cfg.autostart = on;
  saveConfig(cfg);
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: on, path: process.execPath });
    } catch (err) {
      console.error('[host] no se pudo configurar el autostart:', err);
    }
  } else {
    console.log(`[host] autostart ${on ? 'ON' : 'OFF'} (dev: solo se persiste la config)`);
  }
};

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

function pushInput(msg: Parameters<typeof handleInputMessage>[0]): void {
  if (msg.kind === 'mouse' && msg.payload.type === 'move') {
    const existing = inputQueue.findIndex(
      (m) => m.kind === 'mouse' && m.payload.type === 'move',
    );
    if (existing !== -1) {
      inputQueue[existing] = msg;
      return;
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
      const next = inputQueue.shift() as Parameters<typeof handleInputMessage>[0];
      await handleInputMessage(next, appendLog);
    }
  } finally {
    inputDraining = false;
    if (inputQueue.length > 0) {
      void drainInput();
    }
  }
}

ipcMain.on('isis:input', (_event, msg: unknown) => {
  pushInput(msg as Parameters<typeof handleInputMessage>[0]);
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
  void mouse
    .getPosition()
    .then((p) => {
      if (!mainWindow) {
        return;
      }
      mainWindow.webContents.send('isis:cursor-event', {
        x: Math.round(p.x),
        y: Math.round(p.y),
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
  saveConfig(cfg);
  return cfg;
});

ipcMain.handle('isis:autostart-get', () => {
  const cfg = loadConfig();
  return cfg.autostart;
});

ipcMain.handle('isis:autostart-set', (_event, on: unknown) => {
  applyAutostart(Boolean(on));
  return Boolean(on);
});

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

app.on('ready', () => {
  createWindow();
  createTray();
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