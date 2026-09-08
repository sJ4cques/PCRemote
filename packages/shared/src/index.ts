export { firebaseConfig, FIRESTORE_COLLECTION, type FirebaseConfig } from "./config";
export { getFirebaseDb, pingFirestore } from "./firebase";
export { FirestoreStatus, type FirestoreStatusValue } from "./FirestoreStatus";
export type {
  SessionState,
  SessionStatus,
  SessionDoc,
} from "./signaling";
export type {
  MouseButton,
  MouseAction,
  KeyEvent,
  ClipboardEventData,
  ControlCommand,
  DataChannelMessage,
} from "./control";
