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
  utilityProcess,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { exec, spawn } from 'node:child_process';
import net from 'node:net';
import started from 'electron-squirrel-startup';
import { APP_VERSION, type DataChannelMessage } from '@isisanubis/shared';

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
// Proceso separado que solo inyecta mouse/teclado y se ejecuta elevado mediante
// Task Scheduler. El host principal permanece normal para que la captura de
// pantalla/WebRTC siga funcionando en el escritorio del usuario.
const isInputHelper = process.argv.includes('--isis-input-helper');

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

const gotLock = isInputHelper || app.requestSingleInstanceLock();
if (!isInputHelper && !gotLock) {
  app.quit();
} else if (!isInputHelper) {
  app.on('second-instance', () => showPanel());
}

// Respuesta automática a navigator.mediaDevices.getDisplayMedia: sin picker,
// se elige la primera pantalla. Es el camino recomendado en Electron actual y
// funciona con la ventana oculta (modo servicio).
app.whenReady().then(async () => {
  if (isInputHelper) {
    spawnInputWorker('elevated_helper_startup', false);
    startInputHelperServer();
    void isProcessElevated().then((elevated) => {
      appendLog(`[host-helper] IsisAnubis v${APP_VERSION} elevado=${elevated ? 'SI' : 'NO'}`);
    });
  } else if (process.platform === 'win32' && app.isPackaged && await isProcessElevated()) {
    // La captura de pantalla de Electron/WebRTC debe vivir en el escritorio
    // normal. Si el usuario abre el exe como administrador, no intentamos
    // capturar desde ese token: relanzamos el host y dejamos la elevación al
    // proceso --isis-input-helper.
    relaunchHostNormal();
    return;
  } else if (process.platform === 'win32' && app.isPackaged) {
    // Primero repara tareas antiguas (si el autostart ya estaba habilitado) y
    // después pide el helper. Esto evita ejecutar una acción /TR incompatible
    // de una versión anterior durante el arranque.
    void refreshAutostartTaskDefinitions().finally(() => connectInputHelper());
  } else {
    spawnInputWorker('startup', false);
  }
  startInputReconcile();
  startHostHealth();
  if (isInputHelper) {
    return;
  }
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
        const primaryId = String(screen.getPrimaryDisplay().id);
        const source =
          sources.find((s) => s.display_id === primaryId) ??
          sources.find((s) => s.id.startsWith('screen:')) ??
          sources[0];
        if (!source) {
          appendLog('[host] getDisplayMedia: sin fuentes de pantalla');
          reject();
          return;
        }
        appendLog(`[host] getDisplayMedia: fuente=${source.id} display_id=${source.display_id} name=${source.name}`);
        callback({ video: source });
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
const INPUT_AUTOSTART_TASK_NAME = 'IsisAnubis Input';
const HOST_LEGACY_LAUNCHER_NAME = 'isisanubis-host.cmd';
const INPUT_HELPER_LEGACY_LAUNCHER_NAME = 'isisanubis-input-helper.cmd';
const HOST_HIDDEN_LAUNCHER_NAME = 'isisanubis-host.vbs';
const INPUT_HELPER_HIDDEN_LAUNCHER_NAME = 'isisanubis-input-helper.vbs';
const HOST_TASK_XML_NAME = 'isisanubis-host-task.xml';
const INPUT_HELPER_TASK_XML_NAME = 'isisanubis-input-task.xml';
// El helper puede arrancar antes que el host y bajo otro token de Windows.
// TCP loopback evita las ACL/UIPI del named pipe; el secreto sigue autenticando
// la conexión y el puerto fijo permite que ambos procesos se encuentren.
const INPUT_HELPER_HOST = '127.0.0.1';
const INPUT_HELPER_PORT = 47831;
let inputHelperTaskRequested = false;
let lastInputHelperTaskRunAt = 0;

/** Ejecuta el binario directamente mediante Windows Script Host sin crear una
 *  consola visible ni interponer cmd.exe. */
function ensureHiddenTaskLauncher(name: string, executable: string, args: string[]): string {
  const launcherPath = path.join(app.getPath('userData'), name);
  const commandLine = [
    `"${executable.replaceAll('"', '""')}"`,
    ...args.map((arg) => `"${arg.replaceAll('"', '""')}"`),
  ].join(' ');
  const escapedCommandLine = commandLine.replaceAll('"', '""');
  const contents = [
    'Option Explicit',
    'Dim shell',
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run "${escapedCommandLine}", 0, True`,
    'Set shell = Nothing',
    '',
  ].join('\r\n');
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  fs.writeFileSync(launcherPath, contents, 'utf8');
  return launcherPath;
}

/** Compatibilidad con tareas viejas: el .cmd solo dispara WScript oculto y
 *  termina de inmediato, por lo que nunca queda una consola abierta. */
function ensureLegacyLauncher(name: string, hiddenLauncherPath: string): void {
  const launcherPath = path.join(app.getPath('userData'), name);
  const wscriptExecutable = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'wscript.exe',
  );
  const contents = [
    '@echo off',
    `start "" /b "${wscriptExecutable}" //nologo "${hiddenLauncherPath}"`,
    'exit /b 0',
    '',
  ].join('\r\n');
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  fs.writeFileSync(launcherPath, contents, 'utf8');
}

function ensureHiddenInputHelperLauncher(executable: string): string {
  const hiddenLauncher = ensureHiddenTaskLauncher(
    INPUT_HELPER_HIDDEN_LAUNCHER_NAME,
    executable,
    ['--isis-input-helper'],
  );
  ensureLegacyLauncher(INPUT_HELPER_LEGACY_LAUNCHER_NAME, hiddenLauncher);
  return hiddenLauncher;
}

function ensureHiddenHostLauncher(executable: string, args: string[]): string {
  const hiddenLauncher = ensureHiddenTaskLauncher(HOST_HIDDEN_LAUNCHER_NAME, executable, args);
  ensureLegacyLauncher(HOST_LEGACY_LAUNCHER_NAME, hiddenLauncher);
  return hiddenLauncher;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Registra la tarea usando XML para que SCHTASKS no vuelva a interpretar los
 * argumentos de Electron como opciones de su propio comando. La tarea del
 * host y la del helper usan wscript.exe para ejecutar directamente el binario
 * sin consola visible; así una actualización de Squirrel solo requiere
 * actualizar el lanzador, no la tarea de Windows.
 */
function ensureTaskDefinition(
  name: string,
  launcherPath: string,
  runLevel: 'LeastPrivilege' | 'HighestAvailable',
  action: { command: string; argumentsText: string },
  userId?: string,
  multipleInstancesPolicy: 'IgnoreNew' | 'StopExisting' = 'IgnoreNew',
): string {
  const definitionPath = path.join(app.getPath('userData'), name);
  const { command, argumentsText } = action;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>IsisAnubis remote desktop</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      ${userId ? `<UserId>${xmlEscape(userId)}</UserId>` : ''}
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      ${userId ? `<UserId>${xmlEscape(userId)}</UserId>` : ''}
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>${runLevel}</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <MultipleInstancesPolicy>${multipleInstancesPolicy}</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(command)}</Command>
      <Arguments>${xmlEscape(argumentsText)}</Arguments>
      <WorkingDirectory>${xmlEscape(path.dirname(launcherPath))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
  fs.mkdirSync(path.dirname(definitionPath), { recursive: true });
  // SCHTASKS importa las definiciones XML como UTF-16 LE con BOM. Si se guarda
  // como UTF-8, Windows devuelve "no se pudo cambiar la codificación" antes de
  // validar siquiera el contenido del esquema.
  const utf16Xml = Buffer.from(xml, 'utf16le');
  fs.writeFileSync(
    definitionPath,
    Buffer.concat([Buffer.from([0xff, 0xfe]), utf16Xml]),
  );
  return definitionPath;
}

function isMissingTask(result: { ok: boolean; output: string }): boolean {
  return /cannot find|no se puede encontrar|no existe|does not exist|not found/i.test(result.output);
}

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

/** Después de registrar las tareas desde una instancia elevada, vuelve a
 *  abrir el host con el token normal. La captura de pantalla debe vivir en la
 *  sesión gráfica normal; el único proceso elevado es --isis-input-helper. */
function relaunchHostNormal(): void {
  if (isInputHelper || process.platform !== 'win32') {
    return;
  }
  try {
    const explorer = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'explorer.exe',
    );
    const child = spawn(explorer, [process.execPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    appendLog('[host] host elevado: relanzando instancia normal para conservar video');
    setTimeout(() => app.quit(), 500);
  } catch (err) {
    appendLog(`[host] no se pudo relanzar host normal: ${String(err)}`);
  }
}

/** Migra tareas creadas por versiones anteriores sin pedir al usuario que
 *  vuelva a configurar el autostart después de cada actualización. */
async function refreshAutostartTaskDefinitions(): Promise<void> {
  if (process.platform !== 'win32' || !app.isPackaged || !loadConfig().autostart) {
    return;
  }
  try {
    const currentExecutable = process.execPath;
    const updateExecutable = path.resolve(path.dirname(currentExecutable), '..', 'Update.exe');
    const identity = await runCmd('whoami');
    const userId = identity.output.trim() || undefined;
    const hostLauncher = fs.existsSync(updateExecutable)
      ? ensureHiddenHostLauncher(updateExecutable, [
          '--processStart',
          path.basename(currentExecutable),
        ])
      : ensureHiddenHostLauncher(currentExecutable, []);
    const helperLauncher = ensureHiddenInputHelperLauncher(currentExecutable);
    const wscriptExecutable = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'wscript.exe',
    );
    const hostXml = ensureTaskDefinition(
      HOST_TASK_XML_NAME,
      hostLauncher,
      'LeastPrivilege',
      { command: wscriptExecutable, argumentsText: `"${hostLauncher}"` },
      userId,
      'IgnoreNew',
    );
    const helperXml = ensureTaskDefinition(
      INPUT_HELPER_TASK_XML_NAME,
      helperLauncher,
      'HighestAvailable',
      { command: wscriptExecutable, argumentsText: `"${helperLauncher}"` },
      userId,
      'StopExisting',
    );
    // La instancia actual puede haber sido lanzada por esta misma tarea. La
    // eliminación no termina el proceso activo, pero permite reemplazar la
    // acción antigua que apuntaba directamente a cmd.exe.
    await runCmd(`schtasks /Delete /F /TN "${AUTOSTART_TASK_NAME}"`);
    const hostResult = await runCmd(
      `schtasks /Create /F /TN "${AUTOSTART_TASK_NAME}" /XML "${hostXml}"`,
    );
    // Una tarea activa puede rechazar /Create /F. Detener solo el helper
    // permite reemplazar el lanzador anterior por el wrapper oculto.
    await runCmd(`schtasks /End /TN "${INPUT_AUTOSTART_TASK_NAME}"`);
    await runCmd(`schtasks /Delete /F /TN "${INPUT_AUTOSTART_TASK_NAME}"`);
    const helperResult = await runCmd(
      `schtasks /Create /F /TN "${INPUT_AUTOSTART_TASK_NAME}" /XML "${helperXml}"`,
    );
    appendLog(
      `[host] autostart migration host=${hostResult.ok ? 'OK' : 'FAIL'} helper=${helperResult.ok ? 'OK' : 'FAIL'}${helperResult.ok ? '' : ` detalle=${helperResult.output}`}`,
    );
  } catch (err) {
    appendLog(`[host] autostart migration error: ${String(err)}`);
  }
}

/** Crea dos procesos al iniciar Windows: el host normal conserva la captura de
 *  pantalla y un helper separado corre elevado para cruzar UIPI al inyectar
 *  mouse/teclado en Task Manager, bandeja y taskbar. */
async function applyAutostart(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const cfg = loadConfig();
  if (process.platform !== 'win32') {
    return { ok: false, error: 'El inicio automático solo está disponible en Windows.' };
  }
  if (!app.isPackaged) {
    cfg.autostart = on;
    saveConfig(cfg);
    console.log(`[host] autostart ${on ? 'ON' : 'OFF'} (dev: solo se persiste la config)`);
    return { ok: true };
  }
  if (on) {
    // Se usa ONLOGON + /IT para que el proceso nazca en el escritorio
    // interactivo del usuario. SYSTEM/ONSTART no puede capturar ni controlar
    // la sesión gráfica del usuario. /RL HIGHEST eleva la tarea sin pedir UAC
    // en cada inicio, una vez que el usuario autorizó esta configuración.
    // Squirrel mantiene Update.exe en la raíz de la instalación y puede
    // redirigir al app-<versión> vigente. Apuntar al exe versionado dejaría el
    // autostart roto después de una actualización.
    const currentExecutable = process.execPath;
    const updateExecutable = path.resolve(path.dirname(currentExecutable), '..', 'Update.exe');
    const identity = await runCmd('whoami');
    const userId = identity.output.trim() || undefined;
    const hostLauncher = fs.existsSync(updateExecutable)
      ? ensureHiddenHostLauncher(updateExecutable, [
          '--processStart',
          path.basename(currentExecutable),
        ])
      : ensureHiddenHostLauncher(currentExecutable, []);
    const wscriptExecutable = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'wscript.exe',
    );
    const hostTaskXml = ensureTaskDefinition(
      HOST_TASK_XML_NAME,
      hostLauncher,
      'LeastPrivilege',
      { command: wscriptExecutable, argumentsText: `"${hostLauncher}"` },
      userId,
      'IgnoreNew',
    );
    await runCmd(`schtasks /Delete /F /TN "${AUTOSTART_TASK_NAME}"`);
    const hostTask = await runCmd(
      `schtasks /Create /F /TN "${AUTOSTART_TASK_NAME}" /XML "${hostTaskXml}"`,
    );
    let helperTask = hostTask;
    if (hostTask.ok) {
      try {
        await runCmd(`schtasks /End /TN "${INPUT_AUTOSTART_TASK_NAME}"`);
        await runCmd(`schtasks /Delete /F /TN "${INPUT_AUTOSTART_TASK_NAME}"`);
        const helperLauncher = ensureHiddenInputHelperLauncher(currentExecutable);
        const helperTaskXml = ensureTaskDefinition(
          INPUT_HELPER_TASK_XML_NAME,
          helperLauncher,
          'HighestAvailable',
          { command: wscriptExecutable, argumentsText: `"${helperLauncher}"` },
          userId,
          'StopExisting',
        );
        helperTask = await runCmd(
          `schtasks /Create /F /TN "${INPUT_AUTOSTART_TASK_NAME}" /XML "${helperTaskXml}"`,
        );
      } catch (err) {
        helperTask = { ok: false, output: `no se pudo preparar el lanzador elevado: ${String(err)}` };
      }
    }
    if (hostTask.ok && helperTask.ok) {
      cfg.autostart = true;
      // El arranque desatendido no debe abrir una ventana sobre el escritorio.
      cfg.service = true;
      saveConfig(cfg);
      // Si el host ya estaba abierto y antes no encontró la tarea, permite
      // volver a solicitarla ahora que acaba de quedar registrada.
      inputHelperTaskRequested = false;
      connectInputHelper();
      appendLog('[host] autostart ON: host normal + input helper elevado');
      void isProcessElevated().then((elevated) => {
        if (elevated) {
          setTimeout(relaunchHostNormal, 700);
        }
      });
      return { ok: true };
    }
    const error = hostTask.ok ? helperTask.output : hostTask.output;
    appendLog(`[host] autostart ON falló al crear tareas: ${error}`);
    return { ok: false, error };
  }
  await runCmd(`schtasks /End /TN "${INPUT_AUTOSTART_TASK_NAME}"`);
  const hostTask = await runCmd(`schtasks /Delete /F /TN "${AUTOSTART_TASK_NAME}"`);
  const helperTask = await runCmd(`schtasks /Delete /F /TN "${INPUT_AUTOSTART_TASK_NAME}"`);
  const ok = (hostTask.ok || isMissingTask(hostTask)) && (helperTask.ok || isMissingTask(helperTask));
  if (ok) {
    cfg.autostart = false;
    saveConfig(cfg);
  }
  const error = hostTask.ok ? helperTask.output : hostTask.output;
  appendLog(`[host] autostart OFF: ${ok ? 'tareas eliminadas' : error}`);
  return { ok, error: ok ? undefined : error };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input del cliente: worker aislado + coalescing de moves.
// La inyección nativa vive fuera del proceso principal; si Windows/libnut queda
// bloqueado por un menú del sistema, Electron todavía puede mantener video/WebRTC
// y reiniciar el worker sin cerrar la sesión.
// ---------------------------------------------------------------------------

const pendingInput: DataChannelMessage[] = [];
let inputWorker: Electron.UtilityProcess | null = null;
let inputWorkerReady = false;
let inputWorkerBusySince = 0;
let inputWorkerRestartChain = Promise.resolve();
let inputHelperServer: net.Server | null = null;
let inputHelperSocket: net.Socket | null = null;
let inputHelperReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let inputHelperFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const inputHelperClients = new Set<net.Socket>();

type InputHelperCommand =
  | { type: 'auth'; secret: string }
  | { type: 'input'; message: DataChannelMessage }
  | { type: 'reset'; escape: boolean }
  | { type: 'shutdown' };

type InputHelperEvent =
  | { type: 'ready' }
  | { type: 'operation-start'; at: number }
  | { type: 'operation-done' }
  | { type: 'log'; line: string };

function sendInputHelperLine(socket: net.Socket, value: object): void {
  if (!socket.destroyed) {
    socket.write(`${JSON.stringify(value)}\n`);
  }
}

function broadcastInputHelperEvent(event: InputHelperEvent): void {
  for (const socket of inputHelperClients) {
    sendInputHelperLine(socket, event);
  }
}
/** Cuándo recibió el main el último mensaje `isis:input` del renderer. Si pasa
 *  mucho tiempo sin llegar mensajes, el fallo está ANTES de la cola (renderer
 *  o DataChannel muertos), no en la inyección. Crucial para diagnosticar: la
 *  cola puede estar sana y vacía mientras "nada funciona" porque ya no llega
 *  nada del cliente. */
let lastInputReceivedAt = Date.now();
let lastHealthLogAt = 0;
let lastHealthRecoveryAt = 0;
// ---------------------------------------------------------------------------
// Input aislado: una llamada nativa bloqueada no debe congelar Electron.
// ---------------------------------------------------------------------------

function startInputHelperServer(): void {
  if (!isInputHelper || process.platform !== 'win32') {
    return;
  }
  const server = net.createServer((socket) => {
    inputHelperClients.add(socket);
    let authenticated = false;
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        try {
          const command = JSON.parse(raw) as InputHelperCommand;
          if (!authenticated) {
            if (command.type !== 'auth' || command.secret !== loadConfig().secret) {
              appendLog('[host-helper] autenticación IPC rechazada');
              socket.destroy();
              return;
            }
            authenticated = true;
            sendInputHelperLine(socket, { type: 'ready' });
            continue;
          }
          if (command.type === 'input') {
            pushInput(command.message);
          } else if (command.type === 'reset') {
            requestInputWorkerRestart('ipc_reset', command.escape);
          } else if (command.type === 'shutdown') {
            appendLog('[host-helper] cierre solicitado por host principal');
            app.quit();
          }
        } catch (err) {
          appendLog(`[host-helper] comando IPC inválido: ${String(err)}`);
        }
      }
    });
    socket.on('close', () => inputHelperClients.delete(socket));
    socket.on('error', () => inputHelperClients.delete(socket));
  });
  inputHelperServer = server;
  server.on('error', (err) => {
    appendLog(`[host-helper] canal TCP error: ${String(err)}`);
  });
  server.listen(INPUT_HELPER_PORT, INPUT_HELPER_HOST, () => {
    appendLog(
      `[host-helper] canal listo tcp=${INPUT_HELPER_HOST}:${INPUT_HELPER_PORT} userData=${app.getPath('userData')}`,
    );
  });
}

function handleInputHelperEvent(event: InputHelperEvent): void {
  if (event.type === 'ready') {
    if (inputHelperFallbackTimer !== null) {
      clearTimeout(inputHelperFallbackTimer);
      inputHelperFallbackTimer = null;
    }
    // Si el helper tardó más que el margen de diagnóstico, puede existir un
    // worker local de respaldo. El helper ya es la ruta única en Windows.
    if (!isInputHelper && inputWorker) {
      inputWorker.kill();
      inputWorker = null;
      inputWorkerReady = false;
    }
    inputWorkerReady = true;
    appendLog('[host] input helper elevado listo');
    flushWorkerInput();
  } else if (event.type === 'operation-start') {
    inputWorkerBusySince = event.at;
  } else if (event.type === 'operation-done') {
    inputWorkerBusySince = 0;
  } else if (event.type === 'log') {
    appendLog(event.line);
  }
}

function scheduleLocalInputFallback(reason: string): void {
  if (inputHelperFallbackTimer !== null) {
    return;
  }
  inputHelperFallbackTimer = setTimeout(() => {
    inputHelperFallbackTimer = null;
    if (!inputHelperSocket && !inputWorker) {
      appendLog(`[host] usando input local de respaldo reason=${reason} (helper elevado no conectó)`);
      spawnInputWorker('local_fallback', false);
    }
  }, 5000);
}

function connectInputHelper(): void {
  if (isInputHelper || process.platform !== 'win32' || inputHelperSocket) {
    return;
  }
  const taskRetryDue = Date.now() - lastInputHelperTaskRunAt >= 10000;
  if (app.isPackaged && (!inputHelperTaskRequested || taskRetryDue)) {
    inputHelperTaskRequested = true;
    lastInputHelperTaskRunAt = Date.now();
    try {
      // Actualiza el wrapper VBS con el ejecutable de la versión instalada
      // antes de ejecutar la tarea persistente.
      ensureHiddenInputHelperLauncher(process.execPath);
    } catch (err) {
      appendLog(`[host] no se pudo actualizar lanzador del input helper: ${String(err)}`);
    }
    const taskName = `"${INPUT_AUTOSTART_TASK_NAME}"`;
    // /Run no reemplaza una instancia antigua si la tarea anterior quedó
    // ejecutándose. Terminarla primero permite que Windows cargue el helper
    // actual desde el wrapper VBS recién actualizado.
    void runCmd(`schtasks /End /TN ${taskName}`).then((endResult) => {
      if (!endResult.ok && !/no se está ejecutando|not running|cannot find/i.test(endResult.output)) {
        appendLog(`[host] no se pudo detener helper anterior: ${endResult.output}`);
      }
      return runCmd(`schtasks /Run /TN ${taskName}`);
    }).then((result) => {
      appendLog(
        `[host] input helper task run ok=${result.ok ? 'SI' : 'NO'}${result.output ? ` detalle=${result.output}` : ''}`,
      );
      if (!result.ok) {
        appendLog(`[host] no se pudo iniciar input helper por tarea: ${result.output}`);
      }
      scheduleLocalInputFallback(result.ok ? 'tarea_ejecutada_sin_canal' : 'tarea_no_disponible');
    });
  }
  const socket = net.createConnection({
    host: INPUT_HELPER_HOST,
    port: INPUT_HELPER_PORT,
  });
  inputHelperSocket = socket;
  inputWorkerReady = false;
  let buffer = '';
  let disconnectedHandled = false;
  socket.on('connect', () => {
    appendLog('[host] conectando con input helper elevado');
    sendInputHelperLine(socket, { type: 'auth', secret: loadConfig().secret });
  });
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      try {
        handleInputHelperEvent(JSON.parse(raw) as InputHelperEvent);
      } catch (err) {
        appendLog(`[host] evento del input helper inválido: ${String(err)}`);
      }
    }
  });
  const disconnected = (): void => {
    if (disconnectedHandled) {
      return;
    }
    disconnectedHandled = true;
    if (inputHelperSocket !== socket) {
      return;
    }
    inputHelperSocket = null;
    inputWorkerReady = false;
    inputWorkerBusySince = 0;
    appendLog('[host] input helper elevado desconectado; reintentando');
    if (inputHelperReconnectTimer === null) {
      inputHelperReconnectTimer = setTimeout(() => {
        inputHelperReconnectTimer = null;
        connectInputHelper();
      }, 1500);
    }
  };
  socket.on('close', disconnected);
  socket.on('error', (err) => {
    const error = err as NodeJS.ErrnoException;
    appendLog(
      `[host] input helper socket error code=${error.code ?? 'unknown'} message=${error.message}`,
    );
    disconnected();
  });
}

function queueWorkerInput(message: DataChannelMessage): void {
  if (message.kind === 'mouse' && message.payload.type === 'move') {
    const existing = pendingInput.findIndex(
      (item) => item.kind === 'mouse' && item.payload.type === 'move',
    );
    if (existing !== -1) {
      pendingInput[existing] = message;
      return;
    }
  }
  pendingInput.push(message);
  if (pendingInput.length > 40) {
    pendingInput.splice(0, pendingInput.length - 40);
  }
}

function flushWorkerInput(): void {
  if (process.platform === 'win32' && !isInputHelper) {
    if (inputHelperSocket) {
      if (!inputWorkerReady) {
        return;
      }
      const messages = pendingInput.splice(0);
      for (const message of messages) {
        sendInputHelperLine(inputHelperSocket, { type: 'input', message });
      }
      return;
    }
  }
  if (!inputWorker || !inputWorkerReady) {
    return;
  }
  const messages = pendingInput.splice(0);
  for (const message of messages) {
    inputWorker.postMessage({ type: 'input', message });
  }
}

function spawnInputWorker(reason: string, escape: boolean): void {
  const worker = utilityProcess.fork(path.join(__dirname, 'input-worker.js'), [], {
    stdio: 'ignore',
  });
  inputWorker = worker;
  inputWorkerReady = false;
  inputWorkerBusySince = 0;
  appendLog(`[host${isInputHelper ? '-helper' : ''}] input worker iniciado reason=${reason}`);

  worker.on('message', (event: { type: string; line?: string; at?: number }) => {
    if (inputWorker !== worker) {
      return;
    }
    if (isInputHelper && (event.type === 'ready' || event.type === 'operation-start' || event.type === 'operation-done' || (event.type === 'log' && event.line))) {
      broadcastInputHelperEvent(event as InputHelperEvent);
    }
    if (event.type === 'log' && event.line) {
      appendLog(event.line);
    } else if (event.type === 'ready') {
      inputWorkerReady = true;
      appendLog('[host] input worker listo');
      flushWorkerInput();
    } else if (event.type === 'operation-start') {
      inputWorkerBusySince = event.at ?? Date.now();
    } else if (event.type === 'operation-done') {
      inputWorkerBusySince = 0;
    }
  });
  worker.on('error', (type, location, report) => {
    if (inputWorker === worker) {
      appendLog(`[host] input process error type=${type} location=${location} report=${report}`);
      inputWorker = null;
      inputWorkerReady = false;
      inputWorkerBusySince = 0;
      requestInputWorkerRestart('worker_error', false);
    }
  });
  worker.on('exit', (code) => {
    if (inputWorker === worker) {
      inputWorker = null;
      inputWorkerReady = false;
      inputWorkerBusySince = 0;
      if (code !== 0) {
        appendLog(`[host] input worker terminó code=${code}`);
        requestInputWorkerRestart('worker_exit', false);
      }
    }
  });
  worker.postMessage({ type: 'initialize', escape });
}

function requestInputWorkerRestart(reason: string, escape: boolean): void {
  if (process.platform === 'win32' && !isInputHelper && inputHelperSocket) {
    pendingInput.length = 0;
    if (inputHelperSocket) {
      sendInputHelperLine(inputHelperSocket, { type: 'reset', escape });
    } else {
      appendLog(`[host] input helper no disponible para reset reason=${reason}`);
    }
    return;
  }
  inputWorkerRestartChain = inputWorkerRestartChain
    .catch(() => undefined)
    .then(async () => {
      const oldWorker = inputWorker;
      inputWorker = null;
      inputWorkerReady = false;
      inputWorkerBusySince = 0;
      pendingInput.length = 0;
      if (oldWorker) {
        oldWorker.kill();
      }
      spawnInputWorker(reason, escape);
    });
}

function pushInput(msg: DataChannelMessage): void {
  lastInputReceivedAt = Date.now();
  if (msg.kind !== 'mouse' && msg.kind !== 'key') {
    return;
  }
  if (process.platform === 'win32' && !isInputHelper && inputHelperSocket) {
    if (!inputWorkerReady) {
      queueWorkerInput(msg);
      return;
    }
    sendInputHelperLine(inputHelperSocket, { type: 'input', message: msg });
    return;
  }
  if (!inputWorker || !inputWorkerReady) {
    queueWorkerInput(msg);
    return;
  }
  inputWorker.postMessage({ type: 'input', message: msg });
}

function reconcileInputWorker(): void {
  if (inputWorkerBusySince > 0) {
    const age = Date.now() - inputWorkerBusySince;
    if (age > 3500) {
      appendLog(`[host] input worker bloqueado ${age}ms; reiniciando aislamiento`);
      requestInputWorkerRestart('native_watchdog', true);
    }
  }
}

function startInputReconcile(): void {
  setInterval(reconcileInputWorker, 1000);
}

function startHostHealth(): void {
  setInterval(() => {
    const now = Date.now();
    const inputAge = now - lastInputReceivedAt;
    const workerAge = inputWorkerBusySince > 0 ? now - inputWorkerBusySince : 0;
    if (inputAge > 15000 && workerAge > 3500 && now - lastHealthRecoveryAt > 5000) {
      lastHealthRecoveryAt = now;
      appendLog(
        `[host] health input_received_ago=${Math.round(inputAge / 1000)}s worker_busy=${Math.round(workerAge / 1000)}s -> recuperación`,
      );
      requestInputWorkerRestart('health_watchdog', true);
    } else if (now - lastHealthLogAt > 10000) {
      lastHealthLogAt = now;
      appendLog(
        `[host] health input_received_ago=${Math.round(inputAge / 1000)}s worker_ready=${inputWorkerReady} worker_busy=${workerAge > 0 ? `${Math.round(workerAge / 1000)}s` : 'no'}`,
      );
    }
  }, 3000);
}

ipcMain.on('isis:input', (_event, msg: unknown) => {
  pushInput(msg as DataChannelMessage);
});

/** Al cerrar/cambiar de sesión: libera cualquier botón que el cliente dejó
 *  pulsado (se perdió el `up` porque el canal murió en medio del arrastre). */
ipcMain.on('isis:input-release', () => {
  requestInputWorkerRestart('session_release', false);
});

/** Pánico solicitado por el cliente (`inputReset`): además de liberar botones y
 *  despejar la cola, intenta CERRAR un menú/flyout del sistema que haya quedado
 *  abierto. En Windows 11 los menús de la bandeja/taskbar corren en un proceso
 *  ELEVADO y se "tragan" el input inyectado (UIPI): al abrirse, todo lo que
 *  enviamos deja de tener efecto y el cursor se queda clavado en el menú mientras
 *  el canal cliente sigue "viendo" al host sano. Escape cierra el menú (best
 *  effort: si el menú es elevado y este proceso NO lo es, Windows lo descarta). */
ipcMain.on('isis:input-panic', () => {
  requestInputWorkerRestart('client_reset', true);
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
  // Electron entrega la posición del cursor y los bounds en DIPs. Convertir
  // mediante la API de Electron evita asumir que todos los monitores tienen el
  // mismo DPI; esa suposición desplaza el clic en pantallas con 125/150%.
  const physicalBounds = process.platform === 'win32'
    ? screen.dipToScreenRect(null, display.bounds)
    : display.bounds;
  const width = Math.round(physicalBounds.width);
  const height = Math.round(physicalBounds.height);
  Promise.resolve()
    .then(() => {
      if (!mainWindow) {
        return;
      }
      // getCursorScreenPoint no toca nut-js y así el watch no compite con la
      // inyección. En Windows lo pasamos de DIP a píxel físico con la misma
      // transformación que usa el escritorio.
      const dipCursor = screen.getCursorScreenPoint();
      const c = process.platform === 'win32'
        ? screen.dipToScreenPoint(dipCursor)
        : dipCursor;
      mainWindow.webContents.send('isis:cursor-event', {
        x: Math.round(c.x - physicalBounds.x),
        y: Math.round(c.y - physicalBounds.y),
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
  const physicalBounds = process.platform === 'win32'
    ? screen.dipToScreenRect(null, display.bounds)
    : display.bounds;
  appendLog(
    `[host] display dip=${display.bounds.width}x${display.bounds.height} scaleOS=${display.scaleFactor} física=${Math.round(physicalBounds.width)}x${Math.round(physicalBounds.height)} origen=${Math.round(physicalBounds.x)},${Math.round(physicalBounds.y)}`,
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
  const primaryId = String(screen.getPrimaryDisplay().id);
  const source =
    sources.find((s) => s.display_id === primaryId) ??
    sources.find((s) => s.id.startsWith('screen:')) ??
    sources[0];
  if (!source) {
    appendLog(`[host] legacy screen source: sin fuentes (count=${sources.length})`);
    throw new Error('no se encontró ninguna pantalla');
  }
  appendLog(`[host] legacy screen source: count=${sources.length} selected=${source.id} display_id=${source.display_id} name=${source.name}`);
  return source.id;
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
  const [hostTask, helperTask] = await Promise.all([
    runCmd(`schtasks /Query /TN "${AUTOSTART_TASK_NAME}"`),
    runCmd(`schtasks /Query /TN "${INPUT_AUTOSTART_TASK_NAME}"`),
  ]);
  return hostTask.ok && helperTask.ok;
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

/** Detección de elevación del proceso (UIPI). En Windows solo el helper de
 *  input debe correr ELEVADO para poder inyectar en los menús/flyouts elevados
 *  de la bandeja y taskbar (Win11 22H2+). El host conserva el token normal para
 *  que Electron/WebRTC pueda capturar la pantalla del escritorio. */
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
  if (isInputHelper) {
    return;
  }
  const startUi = (): void => {
    createWindow();
    createTray();
    appendLog(
      `[host] IsisAnubis Host v${APP_VERSION} modo=video-normal desktopAudio=${desktopAudioEnabled() ? 'ON' : 'OFF'} platform=${process.platform} elevado=no input_helper=separado`,
    );
  };
  if (process.platform === 'win32' && app.isPackaged) {
    void isProcessElevated().then((elevated) => {
      if (!elevated) {
        startUi();
      }
    });
    return;
  }
  startUi();
});

app.on('before-quit', () => {
  allowClose = true;
  stopCursorWatch();
  if (inputHelperFallbackTimer !== null) {
    clearTimeout(inputHelperFallbackTimer);
    inputHelperFallbackTimer = null;
  }
  if (!isInputHelper && inputHelperSocket) {
    sendInputHelperLine(inputHelperSocket, { type: 'shutdown' });
  }
  inputHelperServer?.close();
  inputHelperServer = null;
  inputHelperSocket?.destroy();
  inputHelperSocket = null;
  if (inputWorker) {
    inputWorker.kill();
    inputWorker = null;
    inputWorkerReady = false;
  }
});

app.on('window-all-closed', () => {
  if (isInputHelper) {
    return;
  }
  if (!serviceMode() && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (isInputHelper) {
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
