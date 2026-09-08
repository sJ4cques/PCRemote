import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { handleInputMessage } from './input';

if (started) {
  app.quit();
}

// El renderer captura/controla sin gesto del usuario (sesión remota desatendida).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

ipcMain.on('isis:input', (_event, msg: unknown) => {
  void handleInputMessage(msg as Parameters<typeof handleInputMessage>[0]);
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

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        ...(isisCode ? [`--isis-code=${isisCode}`] : []),
        ...(isisPin ? [`--isis-pin=${isisPin}`] : []),
        ...(isisSessionTtl ? [`--isis-session-ttl=${isisSessionTtl}`] : []),
        ...(isisSimulateVideo ? ['--isis-simulate-video'] : []),
        ...(isisSimulateAudio ? ['--isis-simulate-audio'] : []),
        ...(isisFakeInput ? ['--isis-fake-input'] : []),
      ],
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});