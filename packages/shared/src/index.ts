export {
  firebaseConfig,
  FIRESTORE_COLLECTION,
  PRESENCE_COLLECTION,
  PRESENCE_PROBE_SUBCOLLECTION,
  PRESENCE_MACHINE_ID,
  PC_COMMANDS_COLLECTION,
  PC_COMMANDS_DOC_ID,
  POWER_OFF_ACCEPT_WINDOW_MS,
  PROBE_RATE_LIMIT_MAX,
  PROBE_RATE_LIMIT_WINDOW_MS,
  PROBE_MAX_AGE_MS,
  PROBE_TIMEOUT_MS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_STALE_AFTER_MS,
  PRESENCE_PASSIVE_POLL_MS,
  type FirebaseConfig,
} from "./config";
export {
  isPresenceFresh,
  isHostPoweredOn,
  hostStateLabel,
  presenceSummary,
  readHostPresence,
  sendWakeCommand,
  sendPowerOffCommand,
  type HostState,
  type HostPresenceSnapshot,
} from "./presence";
export { APP_VERSION } from "./version";
export { getFirebaseDb, pingFirestore } from "./firebase";
export { FirestoreStatus, type FirestoreStatusValue } from "./FirestoreStatus";
export {
  generatePairSecret,
  generateHostId,
  normalizeKey,
  tokenFor,
  type HostConfig,
  type PairRecord,
} from "./pairing";
export {
  generateSessionCode,
  sha256Hex,
  HostPeer,
  ClientPeer,
  HOST_OFFLINE_REASONS,
  type PeerStatus,
  type PeerHandlers,
  type HostPeerOptions,
  type ClientPeerOptions,
  type ClientPeerStartResult,
  type SessionState,
  type SessionStatus,
  type SessionDoc,
  type IceCandidateDoc,
} from "./signaling";
export {
  type MouseButton,
  type MouseAction,
  type KeyEvent,
  type ClipboardEventData,
  type ControlCommand,
  type HelloPayload,
  type DisplayInfo,
  type CursorInfo,
  type DataChannelMessage,
  encodeDataChannelMessage,
  decodeDataChannelMessage,
} from "./control";
