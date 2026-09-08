import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import path from 'node:path';

// Permitir reproducir srcObject sin gesto del usuario (audífonos del control remoto).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

ipcMain.handle('isis:clipboard-read', () => clipboard.readText());

ipcMain.handle('isis:clipboard-write', (_event, text: unknown) => {
  clipboard.writeText(String(text ?? ''));
});

ipcMain.on('isis:set-fullscreen', (_event, full: unknown) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.setFullScreen(Boolean(full));
  }
});

const argValue = (key: string): string | undefined => {
  const prefix = `${key}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};

const isisCode = argValue('--isis-code');
const isisPin = argValue('--isis-pin');
const isisInputTest = process.argv.includes('--isis-input-test');
const isisClipboardTest = process.argv.includes('--isis-clipboard-test');
const isisAutostop = argValue('--isis-autostop');

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
        ...(isisInputTest ? ['--isis-input-test'] : []),
        ...(isisClipboardTest ? ['--isis-clipboard-test'] : []),
        ...(isisAutostop ? [`--isis-autostop=${isisAutostop}`] : []),
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