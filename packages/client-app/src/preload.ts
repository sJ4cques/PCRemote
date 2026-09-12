import { contextBridge, ipcRenderer } from 'electron';

// Args opcionales inyectados desde el proceso main (probar/automatizar la app):
//   --isis-code=<codigo>  --isis-pin=<pin>  --isis-input-test  --isis-clipboard-test
//   --isis-autostop=<seg>  --isis-pair=<hostId>,<secret>  --isis-audio-only
const isisArgs: {
  code?: string;
  pin?: string;
  inputTest?: boolean;
  clipboardTest?: boolean;
  autostop?: number;
  pair?: { id: string; secret: string };
  audioOnly?: boolean;
} = {};

for (const arg of process.argv) {
  if (arg.startsWith('--isis-code=')) {
    isisArgs.code = arg.slice('--isis-code='.length);
  } else if (arg.startsWith('--isis-pin=')) {
    isisArgs.pin = arg.slice('--isis-pin='.length);
  } else if (arg === '--isis-input-test') {
    isisArgs.inputTest = true;
  } else if (arg === '--isis-clipboard-test') {
    isisArgs.clipboardTest = true;
  } else if (arg === '--isis-audio-only') {
    isisArgs.audioOnly = true;
  } else if (arg.startsWith('--isis-autostop=')) {
    const value = Number(arg.slice('--isis-autostop='.length));
    if (Number.isFinite(value) && value > 0) {
      isisArgs.autostop = value;
    }
  } else if (arg.startsWith('--isis-pair=')) {
    const raw = arg.slice('--isis-pair='.length);
    const [id, secret] = raw.includes(',') ? raw.split(',') : [raw, ''];
    if (id && secret) {
      isisArgs.pair = { id, secret };
    }
  }
}

contextBridge.exposeInMainWorld('isis', {
  ...isisArgs,
  /** Lee el texto del portapapeles del sistema. */
  readClipboard: (): Promise<string> =>
    ipcRenderer.invoke('isis:clipboard-read') as Promise<string>,
  /** Escribe el texto en el portapapeles del sistema. */
  writeClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('isis:clipboard-write', text) as Promise<void>,
  /** Alterna la pantalla completa de la ventana. */
  setFullscreen: (full: boolean): void => {
    ipcRenderer.send('isis:set-fullscreen', full);
  },
  /** Devuelve la lista de equipos emparejados guardados. */
  getPairs: (): Promise<SavedPair[]> => ipcRenderer.invoke('isis:pairs-get') as Promise<SavedPair[]>,
  /** Guarda/actualiza un equipo emparejado. Devuelve la lista. */
  savePair: (rec: SavedPair): Promise<SavedPair[]> =>
    ipcRenderer.invoke('isis:pairs-save', rec) as Promise<SavedPair[]>,
  /** Elimina un equipo emparejado. Devuelve la lista. */
  removePair: (id: string): Promise<SavedPair[]> =>
    ipcRenderer.invoke('isis:pairs-remove', id) as Promise<SavedPair[]>,
});

export {};

interface SavedPair {
  id: string;
  name: string;
  secret: string;
  createdAt: number;
  lastConnectedAt?: number;
}