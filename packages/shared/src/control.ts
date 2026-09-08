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

export type DataChannelMessage =
  | { kind: "mouse"; payload: MouseAction }
  | { kind: "key"; payload: KeyEvent }
  | { kind: "clipboard"; payload: ClipboardEventData }
  | { kind: "control"; payload: ControlCommand };
