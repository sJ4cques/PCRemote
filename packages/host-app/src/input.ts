import { mouse, keyboard, Button, Key, Point } from '@nut-tree-fork/nut-js';
import type { DataChannelMessage, KeyEvent, MouseButton } from '@isisanubis/shared';

/** Si está activo, registramos los inputs sin inyectarlos (pruebas/CI). */
export const FAKE_INPUT = process.argv.includes('--isis-fake-input');

type InputLog = (line: string) => void;

let realMoveCount = 0;
const MOVE_LOG_EVERY = 25;

/** Botones que el host cree pulsados. Evita que un `down` duplicado o un `up`
 *  perdido en el camino dejen el botón "pegado" (arrastre sin fin) o inyecten
 *  estados inconsistentes. */
const pressedButtons = new Set<MouseButton>();

/** Libera todos los botones del mouse (recuperación tras una operación colgada:
 *  si un press quedó sin release, el SO considera el botón pulsado y los clics
 *  siguientes "arrastran" en lugar de hacer clic). */
export async function resetMouseButtons(log: InputLog = (l) => console.log(l)): Promise<void> {
  const hadPressed = pressedButtons.size > 0;
  for (const b of [Button.LEFT, Button.MIDDLE, Button.RIGHT]) {
    try {
      await mouse.releaseButton(b);
    } catch {
      // si ya está suelto, no importa
    }
  }
  pressedButtons.clear();
  if (hadPressed) {
    log('[input] reset_buttons (recuperación: botones colgados)');
  }
}

/** true si el host cree tener algún botón pulsado (para la reconciliación). */
export function pressedButtonState(): boolean {
  return pressedButtons.size > 0;
}

/** Botones que el host cree pulsados (para el log de salud). */
export function pressedButtonsList(): MouseButton[] {
  return [...pressedButtons];
}

const KEY_NAMES: Record<string, string> = {
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Space: 'Space',
  Escape: 'Escape',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftSuper',
  MetaRight: 'RightSuper',
};

const CODE_TO_KEY: Record<string, Key> = buildKeyMap();

function buildKeyMap(): Record<string, Key> {
  const map: Record<string, Key> = {};
  const entries = Key as unknown as Record<string, Key>;
  for (const [code, name] of Object.entries(KEY_NAMES)) {
    const key = entries[name];
    if (key !== undefined) {
      map[code] = key;
    }
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const key = entries[ch];
    if (key !== undefined) {
      map[`Key${ch}`] = key;
    }
  }
  for (let i = 1; i <= 24; i += 1) {
    const key = entries[`F${i}`];
    if (key !== undefined) {
      map[`F${i}`] = key;
    }
  }
  return map;
}

const BUTTON_INDEX: MouseButton[] = ['left', 'middle', 'right'];
const BUTTON_MAP: Record<number, Button> = {
  0: Button.LEFT,
  1: Button.MIDDLE,
  2: Button.RIGHT,
};

function toButton(button: MouseButton): Button {
  return BUTTON_MAP[BUTTON_INDEX.indexOf(button) % 3] ?? Button.LEFT;
}

async function applyKey(event: KeyEvent): Promise<void> {
  if (event.type === 'type' && event.text) {
    await keyboard.type(event.text);
    return;
  }
  const key = CODE_TO_KEY[event.key];
  if (key === undefined) {
    console.warn(`[input] tecla sin mapeo: ${event.key}`);
    return;
  }
  if (event.type === 'down') {
    await keyboard.pressKey(key);
  } else if (event.type === 'up') {
    await keyboard.releaseKey(key);
  }
}

/** Aplica un mensaje de entrada recibido del cliente (mouse/teclado).
 *  `log` permite volcar las acciones al log de la app (Windows no tiene consola).
 *  NOTA: el main debe llamar esto SERIALIZADO (una cola), nunca en paralelo:
 *  nut-js no es seguro bajo solape y un move entre press/release "rompe" el clic. */
export async function handleInputMessage(
  msg: DataChannelMessage,
  log: InputLog = (line) => console.log(line),
): Promise<void> {
  if (msg.kind !== 'mouse' && msg.kind !== 'key') {
    return;
  }
  if (FAKE_INPUT) {
    log(`[input] ${msg.kind} ${JSON.stringify(msg.payload)}`);
    return;
  }
  try {
    if (msg.kind === 'mouse') {
      const a = msg.payload;
      switch (a.type) {
        case 'move':
          await mouse.setPosition(new Point(Math.round(a.x), Math.round(a.y)));
          realMoveCount += 1;
          if (realMoveCount % MOVE_LOG_EVERY === 1) {
            log(`[input] mouse_move aplicado ${Math.round(a.x)},${Math.round(a.y)}`);
          }
          break;
        case 'down': {
          const btn = toButton(a.button);
          const name = a.button as MouseButton;
          if (pressedButtons.has(name)) {
            log(`[input] mouse_down IGNORADO (ya pulsado) ${name}`);
            // El cliente no tuvo el `up` (mouseup soltado fuera del video o canal
            // caído): el SO pudo quedar con el botón físicamente pulsado, y los
            // moves siguientes arrastran en vez de mover (mause trabado). Forzamos
            // el release REAL para despegarlo; el `up` del cliente será ignorado.
            try {
              await mouse.releaseButton(btn);
            } catch {
              // ignorar
            }
            break;
          }
          pressedButtons.add(name);
          await mouse.pressButton(btn);
          log(`[input] mouse_down ${a.button}@${Math.round(a.x)},${Math.round(a.y)}`);
          // Micro-movimiento de 1px tras el press: Los flyouts/menús del sistema
          // de Windows 11 (bandeja "^", taskbar, centro de notificaciones) son
          // superficies XAML que IGNORAN un clic si el puntero no genera un
          // evento de movimiento durante el press. Un cambio de 1px (bajo el
          // umbral de arrastre) hace que el clic se registre sin convertirlo en
          // drag. Para apps normales del escritorio es imperceptible.
          try {
            await mouse.setPosition(new Point(Math.round(a.x) + 1, Math.round(a.y)));
          } catch {
            // ignorar; el siguiente move real del cliente lo sobreescribe
          }
          break;
        }
        case 'up': {
          const name = a.button as MouseButton;
          if (!pressedButtons.has(name)) {
            log(`[input] mouse_up IGNORADO (no estaba pulsado) ${name}`);
            break;
          }
          pressedButtons.delete(name);
          await mouse.releaseButton(toButton(a.button));
          log(`[input] mouse_up ${a.button}`);
          break;
        }
        case 'click':
          await mouse.click(toButton(a.button));
          log(`[input] mouse_click ${a.button}@${Math.round(a.x)},${Math.round(a.y)}`);
          break;
        case 'dblclick':
          await mouse.doubleClick(toButton(a.button));
          log(`[input] mouse_dblclick ${a.button}@${Math.round(a.x)},${Math.round(a.y)}`);
          break;
        case 'scroll': {
          // Un trackpad puede mandar deltas enormes (flick); lo acotamos para
          // no encolar cientos de eventos de scroll (colgando la cola de input).
          const steps = Math.max(1, Math.min(10, Math.round(Math.abs(a.deltaY || a.deltaX) / 100)));
          if (a.deltaY > 0) {
            await mouse.scrollDown(steps);
          } else if (a.deltaY < 0) {
            await mouse.scrollUp(steps);
          }
          if (a.deltaX > 0) {
            await mouse.scrollRight(steps);
          } else if (a.deltaX < 0) {
            await mouse.scrollLeft(steps);
          }
          log(`[input] mouse_scroll dx=${a.deltaX} dy=${a.deltaY}`);
          break;
        }
      }
    } else {
      await applyKey(msg.payload);
      log(`[input] key ${msg.payload.type} ${msg.payload.key}`);
    }
  } catch (err) {
    log(`[input] error inyectando [${msg.kind} ${JSON.stringify(msg.payload)}]: ${String(err)}`);
  }
}