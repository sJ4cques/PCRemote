export interface SessionState {
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

export type SessionStatus = "waiting" | "active" | "closed";

export interface SessionDoc {
  machineCode: string;
  status: SessionStatus;
  pinProtected: boolean;
  createdAt: number;
  updatedAt: number;
  /** Hash (o valor opaco) del PIN con el que el host protege la sesión. */
  pinHash?: string;
}
