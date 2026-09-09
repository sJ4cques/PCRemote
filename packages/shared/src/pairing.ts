import { sha256Hex } from "./signaling";

// ---------------------------------------------------------------------------
// Emparejamiento persistente (modo servicio)
//
// Modelo de identidad sin cuentas:
//   - El host genera un `hostId` estable (la dirección `sessions/{hostId}`) y
//     un `secret` de emparejamiento mostrado UNA sola vez al usuario.
//   - El cliente lo introduce una vez y guarda el par localmente.
//   - El `secret` NUNCA se escribe en Firestore (que es público). Las
//     conexiones proban identidad con `token = sha256(secret)`; el host guarda
//     solo el hash y rechaza cualquier oferta con token inválido.
// ---------------------------------------------------------------------------

/** Alfabeto sin caracteres ambiguos (i/l/o/0/1), igual que los códigos. */
export const PAIR_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const HOST_ID_LENGTH = 8;
export const PAIR_SECRET_LENGTH = 8;

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  }
  return out;
}

/** Identidad estable del host (dirección de la sesión persistente). */
export function generateHostId(): string {
  return randomString(HOST_ID_LENGTH);
}

/** Secreto de emparejamiento de un solo uso (lo guarda el cliente). */
export function generatePairSecret(): string {
  return randomString(PAIR_SECRET_LENGTH);
}

/** Token de prueba de identidad derivado del secreto (nunca viaja en claro). */
export function tokenFor(secret: string): Promise<string> {
  return sha256Hex(secret);
}

/** Normalización al guardar/ingresar IDs y secretos. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Configuración persistente del host (userData/isis-host.json). */
export interface HostConfig {
  hostId: string;
  /** Secreto de emparejamiento en claro (persistido SOLO localmente en el host). */
  secret: string;
  deviceName: string;
  /** Modo servicio: ventana oculta + re-escucha automática. */
  service: boolean;
  /** Iniciar con Windows (app.setLoginItemSettings). */
  autostart: boolean;
  simulateVideo?: boolean;
  simulateAudio?: boolean;
  fakeInput?: boolean;
}

/** Par guardado en el cliente (userData/isis-pairs.json). */
export interface PairRecord {
  /** hostId del host. */
  id: string;
  /** Nombre descriptivo que le puso el usuario. */
  name: string;
  /** Secreto de emparejamiento (persistido SOLO localmente en el cliente). */
  secret: string;
  createdAt: number;
  lastConnectedAt?: number;
}