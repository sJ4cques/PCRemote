import { contextBridge, ipcRenderer } from 'electron';

// Args opcionales inyectados desde el proceso main (probar/automatizar la app):
//   --isis-code=<codigo>  --isis-pin=<pin>  --isis-input-test  --isis-clipboard-test
const isisArgs: {
  code?: string;
  pin?: string;
  inputTest?: boolean;
  clipboardTest?: boolean;
  autostop?: number;
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
  } else if (arg.startsWith('--isis-autostop=')) {
    const value = Number(arg.slice('--isis-autostop='.length));
    if (Number.isFinite(value) && value > 0) {
      isisArgs.autostop = value;
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
});

export {};