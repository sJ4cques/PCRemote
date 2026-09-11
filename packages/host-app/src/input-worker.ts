import { keyboard, Key } from '@nut-tree-fork/nut-js';
import type { DataChannelMessage } from '@isisanubis/shared';
import { handleInputMessage, resetMouseButtons } from './input';

type InputCommand =
  | { type: 'initialize'; escape: boolean }
  | { type: 'input'; message: DataChannelMessage };

type InputEvent =
  | { type: 'log'; line: string }
  | { type: 'ready' }
  | { type: 'operation-start'; at: number }
  | { type: 'operation-done' };

const queue: DataChannelMessage[] = [];
let initialized = false;
let draining = false;

function emit(event: InputEvent): void {
  process.parentPort?.postMessage(event);
}

function log(line: string): void {
  emit({ type: 'log', line });
}

function enqueue(message: DataChannelMessage): void {
  if (message.kind === 'mouse' && message.payload.type === 'move') {
    const existing = queue.findIndex(
      (item) => item.kind === 'mouse' && item.payload.type === 'move',
    );
    if (existing !== -1) {
      queue[existing] = message;
      return;
    }
  }
  if (message.kind === 'mouse' && message.payload.type === 'scroll') {
    const existing = queue.findIndex(
      (item) => item.kind === 'mouse' && item.payload.type === 'scroll',
    );
    if (existing !== -1) {
      const current = queue[existing];
      if (current.kind === 'mouse' && current.payload.type === 'scroll') {
        current.payload.deltaX += message.payload.deltaX;
        current.payload.deltaY += message.payload.deltaY;
        return;
      }
    }
  }
  queue.push(message);
  if (queue.length > 40) {
    log(`[input-worker] backlog=${queue.length}`);
  }
  void drain();
}

async function drain(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  try {
    while (queue.length > 0) {
      const message = queue.shift() as DataChannelMessage;
      emit({ type: 'operation-start', at: Date.now() });
      try {
        await handleInputMessage(message, log);
      } finally {
        emit({ type: 'operation-done' });
      }
    }
  } finally {
    draining = false;
    if (queue.length > 0) {
      void drain();
    }
  }
}

async function initialize(escape: boolean): Promise<void> {
  await resetMouseButtons(log);
  if (escape) {
    try {
      await keyboard.pressKey(Key.Escape);
      await keyboard.releaseKey(Key.Escape);
    } catch (err) {
      log(`[input-worker] Escape falló: ${String(err)}`);
    }
  }
  initialized = true;
  emit({ type: 'ready' });
  void drain();
}

process.parentPort?.on('message', (event: { data: InputCommand }) => {
  const command = event.data;
  if (command.type === 'initialize') {
    initialized = false;
    void initialize(command.escape).catch((err) => {
      log(`[input-worker] inicialización falló: ${String(err)}`);
      emit({ type: 'ready' });
      initialized = true;
    });
    return;
  }
  if (initialized) {
    enqueue(command.message);
  }
});
