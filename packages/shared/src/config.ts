export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseURL?: string;
}

/**
 * Configuración web pública del proyecto Firebase `baobaoadmin`.
 *
 * Nota de seguridad: este objeto es PÚBLICO por diseño (se distribuye dentro de
 * las apps de escritorio). NUNCA añadir aquí credenciales de Admin SDK, secretos
 * o claves de servicio.
 *
 * Para sobrescribir sin tocar código, definir las variables FIREBASE_API_KEY,
 * FIREBASE_PROJECT_ID, etc. en el entorno de la app.
 */
const env = (name: string, fallback: string): string => {
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name];
  }
  return fallback;
};

export const firebaseConfig: FirebaseConfig = {
  apiKey: env("FIREBASE_API_KEY", "AIzaSyATBvoGzZ75DWFf1F7ZyMtuZnrV7EC1JAg"),
  authDomain: env("FIREBASE_AUTH_DOMAIN", "baobaoadmin.firebaseapp.com"),
  projectId: env("FIREBASE_PROJECT_ID", "baobaoadmin"),
  storageBucket: env("FIREBASE_STORAGE_BUCKET", "baobaoadmin.firebasestorage.app"),
  messagingSenderId: env("FIREBASE_MESSAGING_SENDER_ID", "274362152284"),
  appId: env("FIREBASE_APP_ID", "1:274362152284:web:f806ebedb542eb897dfd99"),
};

export const FIRESTORE_COLLECTION = "sessions";

// ---------------------------------------------------------------------------
// Presencia bajo demanda ("¿está la PC prendida?")
//
// Layout (solo 4 documentos FIJOS; ningún request crea documentos nuevos):
//
//   presence/{machineId}                 doc del host: estado, bootId, appVersion
//   presence/{machineId}/probe/pending   doc del TELÉFONO: pide un chequeo
//   presence/{machineId}/probe/answer    doc de RESPUESTA (Function o host)
//   presence/{machineId}/probe/rate      contador de la ventana de rate limit
//
// OJO con la aritmética de rutas de Firestore: los números de segmentos impares
// son COLECCIONES. Por eso los tres docs de probe viven bajo la subcolección
// `probe` y no directamente bajo `{machineId}`.
// ---------------------------------------------------------------------------

/** Colección raíz de presencia. */
export const PRESENCE_COLLECTION = "presence";

/** Subcolección con los tres documentos fijos del probe. */
export const PRESENCE_PROBE_SUBCOLLECTION = "probe";

/** Identificador de la máquina controlada. Debe coincidir con el que usa la app Android. */
export const PRESENCE_MACHINE_ID = "desktop";

// ---------------------------------------------------------------------------
// Comando de encendido WoL que la tableta escucha
//
// Layout (un solo doc FIJOS; el teléfono y el cliente de escritorio escriben,
// la tableta lo relee y dispara el magic packet):
//
//   pc_commands/{docId}   powerOn=true + timestamp + senderDevice
//
// La app Android (modo tablet) lee `pc_commands/desktop` en su PcPollingLoop:
// cuando `timestamp` avanza y `powerOn=true`, manda WoL a la MAC/broadcast
// configurados. El cliente de escritorio usa la MISMA ruta ("desktop") para
// encender desde el dashboard o desde el overlay "PC Offline". Es single-host
// por diseño; si algún día hay dos PCs, este doc debería pasar a
// `pc_commands/{hostId}` y la tablet se emparejaría por host.
// ---------------------------------------------------------------------------

/** Colección del comando de encendido/apagado. */
export const PC_COMMANDS_COLLECTION = "pc_commands";

/** Doc fijo que la tableta escucha (mismo que usa la app Android). */
export const PC_COMMANDS_DOC_ID = "desktop";

/**
 * Ventana de frescura de una orden de APAGADO remoto (ms).
 *
 * El host ejecuta un shutdown del SO solo si recibe `powerOn=false` con un
 * `timestamp` dentro de esta ventana. El filtro evita apagar la PC por un
 * comando viejo que quedó escrito en el doc durante una sesión anterior (por
 * ejemplo, si el host arranca con el doc ya "sucio").
 */
export const POWER_OFF_ACCEPT_WINDOW_MS = 30_000;

/** Tope de probes por ventana. Lo aplica la Cloud Function (`packages/functions`). */
export const PROBE_RATE_LIMIT_MAX = 10;

/** Largo de la ventana del rate limit, en ms. */
export const PROBE_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Un probe con `dispatchedAt` más viejo que esto se considera caducado y el
 * host lo ignora: evita que un host que vuelve tarde conteste un pedido viejo.
 */
export const PROBE_MAX_AGE_MS = 30_000;

/** Presupuesto de espera del cliente antes de declarar "apagada o encendiendo". */
export const PROBE_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------
// Heartbeat del host (liveness pasiva)
//
// El host publica `presence/{machineId}` cada vez que ocurre un evento
// (boot, suspend, lock, unlock, shutdown). Entre eventos, ese doc se queda
// quieto: para que un cliente pueda enterarse de que la PC sigue viva SIN
// escribir un probe (y por lo tanto SIN gastar cuota de escritura cuando
// solo quiere mirar), el host también lo actualiza periódicamente.
//
// El campo nuevo es `lastHeartbeatAt`: marca de tiempo del último latido.
// El Android lo usa para distinguir:
//
//   - state='online' + lastHeartbeatAt fresco  -> operativa
//   - state='online' + lastHeartbeatAt viejo   -> "estuvo operativa" (posible
//     cuelgue de red entre el host y Firestore)
//   - state='offline' o sin doc                -> apagada / nunca encendida
//
// Cinco minutos es generoso a propósito: es el costo de UNA escritura cada 5
// minutos (~288/día), casi gratis en la capa gratuita, y le da al cliente
// margen para absorber una sola escritura perdida antes de mostrar "viejo".
// ---------------------------------------------------------------------------

/** Cada cuánto el host publica su estado en `presence/{machineId}` aunque no
 *  haya ocurrido ningún evento. */
export const PRESENCE_HEARTBEAT_MS = 5 * 60 * 1000;

/** Si `lastHeartbeatAt` es más viejo que esto, el Android considera que el
 *  host está sin señal aunque el último `state` conocido diga "online". Es 2x
 *  el heartbeat: aguanta una escritura caída sin parpadear. */
export const PRESENCE_STALE_AFTER_MS = 10 * 60 * 1000;

/** Cada cuánto el Android relee `presence/{machineId}` cuando solo necesita
 *  el dato pasivo (sin tocar la cuota). Lo eligen las apps Android según su
 *  modo (teléfono vs tablet con foreground service). */
export const PRESENCE_PASSIVE_POLL_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// Cámara de la tablet (cliente de escritorio → tablet Android)
//
// El cliente de escritorio pide la cámara de la tablet y recibe el vídeo por
// WebRTC. La señalización es un espejo del protocolo de `sessions`: el cliente
// ofrece (`recvonly` de vídeo) y la tablet responde con su cámara. La identidad
// se reutiliza del emparejamiento host (`hostId` + `secret`): el cliente escribe
// `token = sha256(secret)` y la tablet lo valida.
//
// Layout:
//   tablet_commands/{hostId}   cameraStream + mode + timestamp + token (cliente)
//   tablet_stream/{hostId}     offer/answer + status + tokenHash
//     ├─ clientCandidates      candidatos ICE del cliente
//     └─ hostCandidates        candidatos ICE de la tablet (nombre legacy)
// ---------------------------------------------------------------------------

/** Colección del comando de cámara que la tablet escucha. */
export const TABLET_COMMANDS_COLLECTION = "tablet_commands";

/** Colección de señalización del streaming de cámara de la tablet. */
export const TABLET_STREAM_COLLECTION = "tablet_stream";

/**
 * Ventana de frescura de una orden de cámara (ms).
 *
 * La tablet ignora un `cameraStream=true` con `timestamp` más viejo que esto:
 * si el usuario abre el Modo Tablet mucho después de que el cliente pidiera la
 * cámara, no queremos encenderla sola. El cliente repite el comando mientras
 * su vista sigue esperando.
 */
export const TABLET_CMD_FRESH_MS = 60 * 1000;
