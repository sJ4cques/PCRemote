import { contextBridge, ipcRenderer } from 'electron';

// Args opcionales inyectados desde el proceso main (probar/automatizar la app):
//   --isis-code=<codigo>  --isis-pin=<pin>  --isis-session-ttl=<seg>
//   --isis-simulate-video  --isis-simulate-audio  --isis-fake-input
//   --isis-host-id=<id>  --isis-pair-secret=<secret>  --isis-service
const isisArgs: {
  code?: string;
  pin?: string;
  sessionTtl?: number;
  simulateVideo?: boolean;
  simulateAudio?: boolean;
  fakeInput?: boolean;
  hostId?: string;
  pairSecret?: string;
  service?: boolean;
  manual?: boolean;
  captureTest?: boolean;
  forceGetDisplayMedia?: boolean;
  desktopAudio?: boolean;
  platform: string;
} = {
  platform: process.platform,
};

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
  } else if (arg.startsWith('--isis-host-id=')) {
    isisArgs.hostId = arg.slice('--isis-host-id='.length);
  } else if (arg.startsWith('--isis-pair-secret=')) {
    isisArgs.pairSecret = arg.slice('--isis-pair-secret='.length);
  } else if (arg === '--isis-simulate-video') {
    isisArgs.simulateVideo = true;
  } else if (arg === '--isis-simulate-audio') {
    isisArgs.simulateAudio = true;
  } else if (arg === '--isis-fake-input') {
    isisArgs.fakeInput = true;
  } else if (arg === '--isis-service') {
    isisArgs.service = true;
  } else if (arg === '--isis-manual') {
    isisArgs.manual = true;
  } else if (arg === '--isis-capture-test') {
    isisArgs.captureTest = true;
  } else if (arg === '--isis-force-getdisplaymedia') {
    isisArgs.forceGetDisplayMedia = true;
  } else if (arg === '--isis-desktop-audio') {
    isisArgs.desktopAudio = true;
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
  /** Libera todos los botones del mouse (al cerrar/cambiar de sesión). */
  releaseInputButtons: (): void => {
    ipcRenderer.send('isis:input-release');
  },
  /** Pánico: libera botones, despeja la cola y cierra un menú/flyout del sistema
   *  que haya quedado abierto bloqueando el input (menús elevados de bandeja/taskbar). */
  inputPanic: (): void => {
    ipcRenderer.send('isis:input-panic');
  },
  /** Lee el texto del portapapeles del sistema. */
  readClipboard: (): Promise<string> =>
    ipcRenderer.invoke('isis:clipboard-read') as Promise<string>,
  /** Escribe el texto en el portapapeles del sistema. */
  writeClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('isis:clipboard-write', text) as Promise<void>,
  /** Configuración del host (hostId, secret, autostart, service, sim flags). */
  getConfig: (): Promise<HostConfigView> => ipcRenderer.invoke('isis:config-get') as Promise<HostConfigView>,
  /** Actualiza campos de config (deviceName, service). */
  setConfig: (patch: Partial<Pick<HostConfigView, 'deviceName' | 'service'>>): Promise<unknown> =>
    ipcRenderer.invoke('isis:config-set', patch),
  /** Devuelve si el inicio con Windows está activo (existe la tarea programada). */
  getAutostart: (): Promise<boolean> => ipcRenderer.invoke('isis:autostart-get') as Promise<boolean>,
  /** Activa/desactiva el inicio elevado con Windows (tarea programada /RL HIGHEST). */
  setAutostart: (on: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('isis:autostart-set', on) as Promise<{ ok: boolean; error?: string }>,
  /** Regenera hostId + secreto. Devuelve el par nuevo. */
  regeneratePairing: (): Promise<{ hostId: string; secret: string }> =>
    ipcRenderer.invoke('isis:regenerate-pairing') as Promise<{ hostId: string; secret: string }>,
  /** Oculta la ventana (modo servicio). */
  hideWindow: (): void => {
    ipcRenderer.send('isis:hide-window');
  },
  /** Actualiza el tooltip del tray. */
  setTrayStatus: (text: string): void => {
    ipcRenderer.send('isis:tray-status', text);
  },
  /** Suscriptor de acciones de la bandeja (p. ej. "Desconectar sesión"). */
  onControl: (cb: (cmd: string) => void): (() => void) => {
    const listener = (_e: unknown, cmd: string): void => cb(cmd);
    ipcRenderer.on('isis:ctrl-disconnect', listener);
    return () => ipcRenderer.removeListener('isis:ctrl-disconnect', listener);
  },
  /** Activa/desactiva el streaming de la posición del cursor + resolución del host. */
  watchCursor: (on: boolean): void => {
    ipcRenderer.send(on ? 'isis:cursor-watch' : 'isis:cursor-unwatch');
  },
  /** Recibe la posición del cursor del host (y la resolución del escritorio). */
  onCursorEvent: (cb: (e: { x: number; y: number; width: number; height: number }) => void): (() => void) => {
    const listener = (_e: unknown, data: { x: number; y: number; width: number; height: number }): void =>
      cb(data);
    ipcRenderer.on('isis:cursor-event', listener);
    return () => ipcRenderer.removeListener('isis:cursor-event', listener);
  },
});

export {};

interface HostConfigView {
  hostId: string;
  secret: string;
  deviceName: string;
  service: boolean;
  autostart: boolean;
  simulateVideo: boolean;
  simulateAudio: boolean;
  fakeInput: boolean;
}