export type MouseButton = "left" | "right" | "middle";

export type MouseAction =
  | { type: "move"; x: number; y: number }
  | { type: "down"; button: MouseButton; x: number; y: number }
  | { type: "up"; button: MouseButton; x: number; y: number }
  | { type: "click"; button: MouseButton; x: number; y: number }
  | { type: "dblclick"; button: MouseButton; x: number; y: number }
  | { type: "scroll"; deltaX: number; deltaY: number };

export interface KeyEvent {
  type: "down" | "up" | "type";
  /** Código de tecla normalizado (p. ej. "Enter", "a", "Control"). */
  key: string;
  /** Texto a escribir cuando type === "type". */
  text?: string;
}

export interface ClipboardEventData {
  /** Contenido de texto del portapapeles. */
  text: string;
}

export type ControlCommand =
  | { kind: "requestDisconnect" }
  | { kind: "healthcheck" };

/** Saludo inicial al abrir el canal de datos (Fase 1: verificar conectividad). */
export interface HelloPayload {
  sessionId: string;
  deviceName: string;
}

export type DataChannelMessage =
  | { kind: "hello"; payload: HelloPayload }
  | { kind: "mouse"; payload: MouseAction }
  | { kind: "key"; payload: KeyEvent }
  | { kind: "clipboard"; payload: ClipboardEventData }
  | { kind: "control"; payload: ControlCommand };

/** Codifica una mensaje para enviarlo por el DataChannel (JSON). */
export function encodeDataChannelMessage(msg: DataChannelMessage): string {
  return JSON.stringify(msg);
}

/** Decodifica una mensaje recibido por el DataChannel. Devuelve `null` si no es válido. */
export function decodeDataChannelMessage(raw: unknown): DataChannelMessage | null {
  try {
    return JSON.parse(String(raw)) as DataChannelMessage;
  } catch {
    return null;
  }
}
