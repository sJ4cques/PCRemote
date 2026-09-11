export { firebaseConfig, FIRESTORE_COLLECTION, type FirebaseConfig } from "./config";
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
