import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { sha256Hex } from "./signaling";
import {
  PC_COMMANDS_DOC_ID,
  TABLET_COMMANDS_COLLECTION,
  TABLET_CMD_FRESH_MS,
  TABLET_PRESENCE_COLLECTION,
  TABLET_PRESENCE_STALE_MS,
  TABLET_STREAM_COLLECTION,
} from "./config";

/** Cámara de la tablet que el cliente puede pedir. */
export type TabletCameraMode = "front" | "back";

/**
 * Pide a la tablet (Android, en Modo Tablet) que encienda su cámara y transmita
 * por WebRTC. Escribe `tablet_commands/{hostId}` con `cameraStream=true` y un
 * `timestamp` fresco; la tablet relee ese doc, valida el `token` y arranca la
 * captura.
 *
 * La identidad reutiliza el emparejamiento del host: `hostId` y `secret` son
 * los mismos que el cliente ya guardó para esa PC. `token = sha256(secret)` es
 * la prueba de identidad (igual que en `sessions`). Sin emparejamiento, cae al
 * doc default `desktop` y se omite el token (modelo de confianza abierto, igual
 * que `pc_commands`).
 *
 * El comando es efímero: si la tablet lo lee más de `TABLET_CMD_FRESH_MS`
 * después, lo ignora (evita encender la cámara sola al abrir la app tarde). El
 * cliente debe repetir la llamada mientras su vista siga esperando.
 *
 * `requestId` es un identificador único de ESTE pedido. La tablet lo copia al
 * doc de streaming (`tablet_stream/{hostId}.requestId`); el cliente espera a
 * verlo ahí antes de negociar, para no pisar/leer el estado de una sesión
 * anterior (ver `readTabletStreamState`).
 */
export async function requestTabletCamera(
  db: Firestore,
  hostId: string,
  secret: string | undefined,
  mode: TabletCameraMode,
  requestId: string,
): Promise<void> {
  const id = hostId || PC_COMMANDS_DOC_ID;
  const token = secret ? await sha256Hex(secret) : "";
  await setDoc(
    doc(db, TABLET_COMMANDS_COLLECTION, id),
    {
      cameraStream: true,
      mode,
      timestamp: Date.now(),
      senderDevice: "client",
      requestId,
      ...(token ? { token } : {}),
    },
    { merge: true },
  );
}

/**
 * Ordena a la tablet detener la cámara (`cameraStream=false`). El servicio de
 * Modo Tablet cierra la captura y el `PeerConnection`, pero sigue escuchando
 * para el próximo pedido.
 */
export async function stopTabletCamera(db: Firestore, hostId: string): Promise<void> {
  const id = hostId || PC_COMMANDS_DOC_ID;
  await setDoc(
    doc(db, TABLET_COMMANDS_COLLECTION, id),
    {
      cameraStream: false,
      timestamp: Date.now(),
      senderDevice: "client",
    },
    { merge: true },
  );
}

/** Estado publicado por la tablet en su doc de streaming (si existe). */
export interface TabletStreamState {
  status: string;
  deviceName: string;
  mode: string;
  updatedAt: number;
  /** Identificador del pedido de cámara que la tablet está atendiendo. */
  requestId: string;
}

/**
 * Lee `tablet_stream/{hostId}` para saber si la tablet está transmitiendo. Es
 * informativo para la UI; la fuente autoritativa es el propio `ClientPeer`.
 * Nunca lanza: cualquier error devuelve `null`.
 */
export async function readTabletStreamState(
  db: Firestore,
  hostId: string,
): Promise<TabletStreamState | null> {
  const id = hostId || PC_COMMANDS_DOC_ID;
  try {
    const snap = await getDoc(doc(db, TABLET_STREAM_COLLECTION, id));
    if (!snap.exists()) {
      return null;
    }
    const d = snap.data() as Record<string, unknown>;
    const num = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "0")) || 0);
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    return {
      status: str(d.status),
      deviceName: str(d.deviceName),
      mode: str(d.mode),
      updatedAt: num(d.updatedAt),
      requestId: str(d.requestId),
    };
  } catch (err) {
    console.error(`[tablet] readTabletStreamState(${id}) falló:`, err);
    return null;
  }
}

/** `true` si un `timestamp` de comando todavía es atendible (no rancio). */
export function isTabletCommandFresh(timestamp: number, nowMs: number = Date.now()): boolean {
  return timestamp > 0 && nowMs - timestamp <= TABLET_CMD_FRESH_MS;
}

/** Estado que la app Android publica en `tablet_presence/{hostId}`. */
export interface TabletPresenceState {
  /** El proceso de la pantalla Modo Tablet sigue vivo (no se cerró). */
  running: boolean;
  /** `true` = la pantalla Modo Tablet está en primer plano (activa). */
  foreground: boolean;
  /** Marca del último latido (ms epoch). */
  updatedAt: number;
  deviceName: string;
  appVersion: string;
  mode: string;
}

/**
 * Lee `tablet_presence/{hostId}` para saber si la app Android (Modo Tablet)
 * está abierta y si está en primer plano o en segundo plano. Es una lectura
 * BAJO DEMANDA: se llama solo cuando el usuario lo pide, nunca en un loop.
 *
 * Devuelve `null` si el doc no existe (la app nunca se abrió en Modo Tablet,
 * o se borró). Nunca lanza: cualquier error devuelve `null`.
 */
export async function readTabletPresence(
  db: Firestore,
  hostId: string,
): Promise<TabletPresenceState | null> {
  const id = hostId || PC_COMMANDS_DOC_ID;
  try {
    const snap = await getDoc(doc(db, TABLET_PRESENCE_COLLECTION, id));
    if (!snap.exists()) {
      return null;
    }
    const d = snap.data() as Record<string, unknown>;
    const num = (v: unknown): number =>
      typeof v === "number" ? v : Number(String(v ?? "0")) || 0;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const bool = (v: unknown): boolean => v === true || v === "true";
    return {
      running: bool(d.running),
      foreground: bool(d.foreground),
      updatedAt: num(d.updatedAt),
      deviceName: str(d.deviceName),
      appVersion: str(d.appVersion),
      mode: str(d.mode),
    };
  } catch (err) {
    console.error(`[tablet] readTabletPresence(${id}) falló:`, err);
    return null;
  }
}

/** `true` si el latido de presencia de la tablet sigue fresco. */
export function isTabletPresenceFresh(
  updatedAt: number,
  nowMs: number = Date.now(),
): boolean {
  return updatedAt > 0 && nowMs - updatedAt <= TABLET_PRESENCE_STALE_MS;
}
