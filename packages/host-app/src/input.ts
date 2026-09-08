import { mouse, keyboard, Button, Key, Point } from '@nut-tree-fork/nut-js';
import type { DataChannelMessage, KeyEvent, MouseButton } from '@isisanubis/shared';

/** Si está activo, registramos los inputs sin inyectarlos (pruebas/CI). */
export const FAKE_INPUT = process.argv.includes('--isis-fake-input');

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

/** Aplica un mensaje de entrada recibido del cliente (mouse/teclado). */
export async function handleInputMessage(msg: DataChannelMessage): Promise<void> {
  if (msg.kind !== 'mouse' && msg.kind !== 'key') {
    return;
  }
  if (FAKE_INPUT) {
    console.log(`[input] ${msg.kind} ${JSON.stringify(msg.payload)}`);
    return;
  }
  try {
    if (msg.kind === 'mouse') {
      const a = msg.payload;
      switch (a.type) {
        case 'move':
          await mouse.setPosition(new Point(Math.round(a.x), Math.round(a.y)));
          console.log(`[input] mouse_move real aplicado ${Math.round(a.x)},${Math.round(a.y)}`);
          break;
        case 'down':
          await mouse.pressButton(toButton(a.button));
          break;
        case 'up':
          await mouse.releaseButton(toButton(a.button));
          break;
        case 'click':
          await mouse.click(toButton(a.button));
          break;
        case 'dblclick':
          await mouse.doubleClick(toButton(a.button));
          break;
        case 'scroll': {
          const steps = Math.max(1, Math.round(Math.abs(a.deltaY || a.deltaX) / 100));
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
          break;
        }
      }
    } else {
      await applyKey(msg.payload);
    }
  } catch (err) {
    console.error('[input] error inyectando entrada:', err);
  }
}