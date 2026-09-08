export {};

declare global {
  interface Window {
    /** Args inyectados por el preload (automatización/pruebas). */
    isis?: {
      code?: string;
      pin?: string;
      /** Si se lanza con --isis-input-test, el cliente envía entradas de prueba automáticas. */
      inputTest?: boolean;
      /** Si se lanza con --isis-clipboard-test, el cliente sincroniza texto de prueba. */
      clipboardTest?: boolean;
      /** Si se lanza con --isis-autostop=<seg>, el cliente envía requestDisconnect a los N segundos. */
      autostop?: number;
      /** Lee el texto del portapapeles del sistema. */
      readClipboard: () => Promise<string>;
      /** Escribe el texto en el portapapeles del sistema. */
      writeClipboard: (text: string) => Promise<void>;
      /** Alterna la pantalla completa de la ventana. */
      setFullscreen: (full: boolean) => void;
    };
  }
}