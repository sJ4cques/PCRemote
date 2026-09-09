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
