import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import fs from "node:fs";

const CREDENTIAL_PATH =
  process.env.FIREBASE_ADMIN_CRED_PATH ??
  (globalThis as any).__dirname ??
  "firebase-admin.json";

function loadCredentials(): string {
  const localPath = "firebase-admin.json";
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  if (fs.existsSync(CREDENTIAL_PATH)) {
    return CREDENTIAL_PATH;
  }
  if (fs.existsSync("/Users/jyang/Downloads/baobaoadmin-firebase-adminsdk-w3o6s-43556cff9f.json")) {
    return "/Users/jyang/Downloads/baobaoadmin-firebase-adminsdk-w3o6s-43556cff9f.json";
  }
  throw new Error(
    "No se encontraron credenciales de Admin SDK. Coloca firebase-admin.json en " +
      "packages/scripts o exporta FIREBASE_ADMIN_CRED_PATH.",
  );
}

export function getAdminFirestore(): Firestore {
  let app: App;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
  } else {
    app = initializeApp(
      { credential: cert(loadCredentials()) },
      "isisanubis-scripts",
    );
  }
  return getFirestore(app);
}

export const SESSIONS_COLLECTION = "sessions";
