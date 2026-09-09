import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Permitir reproducir srcObject sin gesto del usuario (audífonos del control remoto).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------------------------------------------------------------------------
// Pares guardados (userData/isis-pairs.json). Estructura idéntica a PairRecord
// de @isisanubis/shared (se define local para no arrastrar el bundle de shared
// al proceso main).
// ---------------------------------------------------------------------------

interface SavedPair {
  id: string;
  name: string;
  secret: string;
  createdAt: number;
  lastConnectedAt?: number;
}

const pairsPath = (): string => path.join(app.getPath('userData'), 'isis-pairs.json');

function loadPairs(): SavedPair[] {
  try {
    const raw = JSON.parse(fs.readFileSync(pairsPath(), 'utf8') as string) as unknown;
    if (Array.isArray(raw)) {
      return raw.filter(
        (p): p is SavedPair =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as SavedPair).id === 'string' &&
          typeof (p as SavedPair).secret === 'string',
      );
    }
  } catch {
    // sin pares todavía
  }
  return [];
}

function savePairs(pairs: SavedPair[]): void {
  try {
    fs.mkdirSync(path.dirname(pairsPath()), { recursive: true });
    fs.writeFileSync(pairsPath(), JSON.stringify(pairs, null, 2), 'utf8');
  } catch (err) {
    console.error('[client] no se pudieron guardar los equipos:', err);
  }
}

ipcMain.handle('isis:pairs-get', () => loadPairs());

ipcMain.handle('isis:pairs-save', (_event, rec: unknown) => {
  const r = rec as Partial<SavedPair>;
  if (typeof r.id !== 'string' || !r.id || typeof r.secret !== 'string' || !r.secret) {
    throw new Error('equipo inválido');
  }
  const pairs = loadPairs();
  const existing = pairs.find((p) => p.id === r.id);
  if (existing) {
    Object.assign(existing, {
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : existing.name,
      secret: r.secret,
    });
  } else {
    pairs.push({
      id: r.id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.id,
      secret: r.secret,
      createdAt: Date.now(),
    });
  }
  savePairs(pairs);
  return pairs;
});

ipcMain.handle('isis:pairs-remove', (_event, id: unknown) => {
  const pairs = loadPairs().filter((p) => p.id !== String(id));
  savePairs(pairs);
  return pairs;
});

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
// Pruebas: --isis-pair=<hostId>,<secret> conecta directo a un host emparejado.
const isisPairArgs = argValue('--isis-pair');

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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
        ...(isisPairArgs ? [`--isis-pair=${isisPairArgs}`] : []),
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