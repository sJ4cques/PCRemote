import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, getDoc, type Firestore } from "firebase/firestore";
import { firebaseConfig } from "./config";

let db: Firestore | null = null;

/**
 * Inicializa Firebase (client SDK) una sola vez y devuelve la instancia de
 * Firestore. Usado desde el renderer de las apps de escritorio.
 */
export function getFirebaseDb(): Firestore {
  if (db) {
    return db;
  }
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  db = getFirestore(app);
  return db;
}

/** Devuelve `true` si podemos escribir/leer en Firestore (verificación de Fase 0). */
export async function pingFirestore(): Promise<boolean> {
  const database = getFirebaseDb();
  const docRef = doc(collection(database, "_healthcheck"), "ping");
  await setDoc(docRef, { at: Date.now() });
  const snap = await getDoc(docRef);
  return snap.exists();
}