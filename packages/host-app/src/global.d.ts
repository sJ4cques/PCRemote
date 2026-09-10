export {};

export interface HostConfigView {
  hostId: string;
  secret: string;
  deviceName: string;
  service: boolean;
  autostart: boolean;
  desktopAudio: boolean;
  simulateVideo: boolean;
  simulateAudio: boolean;
  fakeInput: boolean;
}

declare global {
  interface Window {
    /** Args inyectados por el preload (automatización/pruebas). */
    isis?: {
      code?: string;
      pin?: string;
      /** TTL de la sesión en segundos (--isis-session-ttl). */
      sessionTtl?: number;
      /** Si se lanza con --isis-simulate-video, usamos una fuente de video sintética. */
      simulateVideo?: boolean;
      /** Si se lanza con --isis-simulate-audio, usamos una fuente de audio sintética (tono). */
      simulateAudio?: boolean;
      /** Si se lanza con --isis-fake-input, los inputs se registran sin inyectarse. */
      fakeInput?: boolean;
      /** Identidad estable del host (modo emparejado). */
      hostId?: string;
      /** Secreto de emparejamiento (modo emparejado). */
      pairSecret?: string;
      /** Modo servicio: ventana oculta + re-escucha automática. */
      service?: boolean;
      /** Modo manual forzado (sesión temporal por código). */
      manual?: boolean;
      /** Diagnóstico: prueba la captura al arrancar (--isis-capture-test). */
      captureTest?: boolean;
      /** Salta getUserMedia y usa getDisplayMedia para capturar (--isis-force-getdisplaymedia). */
      forceGetDisplayMedia?: boolean;
      /** Captura el audio de escritorio (loopback) en Windows (--isis-desktop-audio / config). */
      desktopAudio?: boolean;
      /** Plataforma del host ('darwin' | 'win32' | 'linux'). */
      platform: string;
      /** Id de la pantalla a capturar con getUserMedia (desktopCapturer). */
      getScreenSourceId: () => Promise<string>;
      /** Envía una acción de entrada (mouse/teclado) al proceso main para inyectarla. */
      sendInput: (msg: unknown) => void;
      /** Lee el texto del portapapeles del sistema. */
      readClipboard: () => Promise<string>;
      /** Escribe el texto en el portapapeles del sistema. */
      writeClipboard: (text: string) => Promise<void>;
      /** Configuración del host (hostId, secret, autostart, service, sim flags). */
      getConfig: () => Promise<HostConfigView>;
      /** Actualiza campos de config (deviceName, service, desktopAudio). */
      setConfig: (
        patch: Partial<Pick<HostConfigView, 'deviceName' | 'service' | 'desktopAudio'>>,
      ) => Promise<unknown>;
      /** Devuelve si el inicio con Windows está activo (existe la tarea programada). */
      getAutostart: () => Promise<boolean>;
      /** Activa/desactiva el inicio elevado con Windows (tarea programada /RL HIGHEST). */
      setAutostart: (on: boolean) => Promise<{ ok: boolean; error?: string }>;
      /** Regenera hostId + secreto. Devuelve el par nuevo. */
      regeneratePairing: () => Promise<{ hostId: string; secret: string }>;
      /** Oculta la ventana (modo servicio). */
      hideWindow: () => void;
      /** Actualiza el tooltip del tray. */
      setTrayStatus: (text: string) => void;
      /** Suscriptor de acciones de la bandeja (p. ej. "Desconectar sesión"). */
      onControl: (cb: (cmd: string) => void) => () => void;
      /** Activa/desactiva el streaming de la posición del cursor + resolución del host. */
      watchCursor: (on: boolean) => void;
      /** Libera todos los botones del mouse (al cerrar/cambiar de sesión). */
      releaseInputButtons: () => void;
      /** Pánico: libera botones, despeja la cola y cierra un menú/flyout del
       *  sistema abierto que bloquea el input (menús elevados de bandeja/taskbar). */
      inputPanic: () => void;
      /** Recibe la posición del cursor del host (y la resolución del escritorio). */
      onCursorEvent: (cb: (e: { x: number; y: number; width: number; height: number }) => void) => () => void;
    };
  }
}