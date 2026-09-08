import React, { useEffect, useState } from "react";
import { pingFirestore } from "./firebase";

export type FirestoreStatusValue = "checking" | "ok" | "error";

export interface FirestoreStatusProps {
  onStateChange?: (state: FirestoreStatusValue) => void;
}

/** Conecta a Firestore y verifica lectura/escritura. Usado en Fase 0. */
export const FirestoreStatus: React.FC<FirestoreStatusProps> = ({
  onStateChange,
}) => {
  const [state, setState] = useState<FirestoreStatusValue>("checking");

  useEffect(() => {
    let cancelled = false;
    pingFirestore()
      .then((ok) => {
        if (cancelled) return;
        setState(ok ? "ok" : "error");
        console.log(`[FirestoreStatus] ping ok=${ok}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setState("error");
        console.error(`[FirestoreStatus] ping error: ${err}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  const label =
    state === "checking"
      ? "Conectando a Firebase..."
      : state === "ok"
        ? "Conectado a Firebase"
        : "Error de conexión a Firebase";

  const color =
    state === "checking" ? "#e8a23c" : state === "ok" ? "#3ddc84" : "#f2555a";

  return (
    <p className="muted" style={{ color }}>
      {label}
    </p>
  );
};