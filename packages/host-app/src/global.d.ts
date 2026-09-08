export {};

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
      /** Id de la pantalla a capturar con getUserMedia (desktopCapturer). */
      getScreenSourceId: () => Promise<string>;
      /** Envía una acción de entrada (mouse/teclado) al proceso main para inyectarla. */
      sendInput: (msg: unknown) => void;
      /** Lee el texto del portapapeles del sistema. */
      readClipboard: () => Promise<string>;
      /** Escribe el texto en el portapapeles del sistema. */
      writeClipboard: (text: string) => Promise<void>;
    };
  }
}