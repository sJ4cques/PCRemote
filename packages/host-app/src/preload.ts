import { contextBridge, ipcRenderer } from 'electron';

// Args opcionales inyectados desde el proceso main (probar/automatizar la app):
//   --isis-code=<codigo>  --isis-pin=<pin>  --isis-simulate-video
//   --isis-simulate-audio  --isis-fake-input
const isisArgs: {
  code?: string;
  pin?: string;
  sessionTtl?: number;
  simulateVideo?: boolean;
  simulateAudio?: boolean;
  fakeInput?: boolean;
} = {};

for (const arg of process.argv) {
  if (arg.startsWith('--isis-code=')) {
    isisArgs.code = arg.slice('--isis-code='.length);
  } else if (arg.startsWith('--isis-pin=')) {
    isisArgs.pin = arg.slice('--isis-pin='.length);
  } else if (arg.startsWith('--isis-session-ttl=')) {
    const value = Number(arg.slice('--isis-session-ttl='.length));
    if (Number.isFinite(value) && value > 0) {
      isisArgs.sessionTtl = value;
    }
  } else if (arg === '--isis-simulate-video') {
    isisArgs.simulateVideo = true;
  } else if (arg === '--isis-simulate-audio') {
    isisArgs.simulateAudio = true;
  } else if (arg === '--isis-fake-input') {
    isisArgs.fakeInput = true;
  }
}

contextBridge.exposeInMainWorld('isis', {
  ...isisArgs,
  /** Devuelve el id de la pantalla principal para capturarla con getUserMedia. */
  getScreenSourceId: (): Promise<string> =>
    ipcRenderer.invoke('isis:get-screen-source') as Promise<string>,
  /** Envía una acción de entrada (mouse/teclado) al proceso principal para inyectarla. */
  sendInput: (msg: unknown): void => {
    ipcRenderer.send('isis:input', msg);
  },
  /** Lee el texto del portapapeles del sistema. */
  readClipboard: (): Promise<string> =>
    ipcRenderer.invoke('isis:clipboard-read') as Promise<string>,
  /** Escribe el texto en el portapapeles del sistema. */
  writeClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('isis:clipboard-write', text) as Promise<void>,
});

export {};