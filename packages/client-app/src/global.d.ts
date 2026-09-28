export {};

export interface SavedPair {
  id: string;
  name: string;
  secret: string;
  createdAt: number;
  lastConnectedAt?: number;
}

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
      /** Si se lanza con --isis-pair=<hostId>,<secret>, conecta directo a un host emparejado. */
      pair?: { id: string; secret: string };
      /** Si se lanza con --isis-audio-only, conecta en modo "solo bocina" (sin video ni control). */
      audioOnly?: boolean;
      /** Lee el texto del portapapeles del sistema. */
      readClipboard: () => Promise<string>;
      /** Escribe el texto en el portapapeles del sistema. */
      writeClipboard: (text: string) => Promise<void>;
      /** Alterna la pantalla completa de la ventana. */
      setFullscreen: (full: boolean) => void;
      /** Activa/desactiva el modo tapa cerrada (solo macOS, sesión "solo bocina"). */
      setLidMode: (enabled: boolean) => void;
      /** Devuelve la lista de equipos emparejados guardados. */
      getPairs: () => Promise<SavedPair[]>;
      /** Guarda/actualiza un equipo emparejado. Devuelve la lista. */
      savePair: (rec: SavedPair) => Promise<SavedPair[]>;
      /** Elimina un equipo emparejado. Devuelve la lista. */
      removePair: (id: string) => Promise<SavedPair[]>;
    };
  }
}