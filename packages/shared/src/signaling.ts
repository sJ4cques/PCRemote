import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { FIRESTORE_COLLECTION } from "./config";
import { decodeDataChannelMessage, type DataChannelMessage } from "./control";

// ---------------------------------------------------------------------------
// Tipos del documento de sesión (colección `sessions/{code}`)
// ---------------------------------------------------------------------------

export interface SessionState {
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

export type SessionStatus = "waiting" | "signaling" | "active" | "closed";

export interface SessionDoc {
  machineCode: string;
  status: SessionStatus;
  deviceName: string;
  pinProtected: boolean;
  createdAt: number;
  updatedAt: number;
  /** El host deja de esperar y se cierra a esta hora (ms epoch). */
  expiresAt: number;
  /** Hash SHA-256 del PIN con el que el host protege la sesión. */
  pinHash?: string;
  /** Offer/answer serializados (JSON string de RTCSessionDescriptionInit). */
  offer?: string;
  answer?: string;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;

/** Genera un código de sesión sin caracteres ambiguos (i/l/o/0/1). */
export function generateSessionCode(length: number = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Hash SHA-256 en hexadecimal de una cadena. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

const CHANNEL_NAME = "control";

// ---------------------------------------------------------------------------
// Estado del emparejamiento (expuesto a la UI)
// ---------------------------------------------------------------------------

export type PeerStatus =
  | "idle"
  | "creating"
  | "waiting"
  | "looking_up"
  | "signaling"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export interface PeerHandlers {
  onStatus: (status: PeerStatus, detail?: string) => void;
  onData?: (msg: DataChannelMessage) => void;
  onChannelState?: (open: boolean) => void;
}

export interface IceCandidateDoc {
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  candidate: string;
  at: number;
}

// ---------------------------------------------------------------------------
// HostPeer: el equipo controlado crea la sesión y espera al cliente
// ---------------------------------------------------------------------------

export interface HostPeerOptions extends PeerHandlers {
  db: Firestore;
  code: string;
  deviceName: string;
  /** PIN opcional. Si se indica, el cliente debe enviarlo para unirse. */
  pin?: string;
  /** Tiempo máximo esperando al cliente antes de cerrar la sesión (ms). */
  waitTimeoutMs?: number;
  iceServers?: RTCIceServer[];
  /**
   * Devuelve la captura de pantalla del host. Se llama al responder la oferta
   * del cliente; sus tracks se añaden al peer antes de generar el answer.
   * Si devuelve `null`/lanza, la sesión sigue sin video.
   */
  getScreenStream?: () => Promise<MediaStream | null>;
}

export class HostPeer {
  private readonly db: Firestore;
  private readonly code: string;
  private readonly deviceName: string;
  private readonly pin?: string;
  private readonly waitTimeoutMs: number;
  private readonly iceServers: RTCIceServer[];
  private readonly onStatus: (status: PeerStatus, detail?: string) => void;
  private readonly onData?: (msg: DataChannelMessage) => void;
  private readonly onChannelState?: (open: boolean) => void;
  private readonly getScreenStream?: () => Promise<MediaStream | null>;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private screenStream: MediaStream | null = null;
  private sessionRef: DocumentReference<DocumentData>;
  private unsubDoc: Unsubscribe | null = null;
  private unsubCandidates: Unsubscribe | null = null;
  private hasAnswered = false;
  private stopped = false;
  private seenCandidates = new Set<string>();
  private waitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HostPeerOptions) {
    this.db = options.db;
    this.code = options.code;
    this.deviceName = options.deviceName;
    this.pin = options.pin;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 10 * 60 * 1000;
    this.iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
    this.onStatus = options.onStatus;
    this.onData = options.onData;
    this.onChannelState = options.onChannelState;
    this.getScreenStream = options.getScreenStream;
    this.sessionRef = doc(collection(this.db, FIRESTORE_COLLECTION), this.code);
  }

  async start(): Promise<void> {
    this.onStatus("creating");

    const pinHash = this.pin ? await sha256Hex(this.pin) : undefined;
    const now = Date.now();
    await setDoc(this.sessionRef, {
      machineCode: this.code,
      status: "waiting",
      deviceName: this.deviceName,
      pinProtected: Boolean(this.pin),
      ...(pinHash ? { pinHash } : {}),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.waitTimeoutMs,
    });
    this.onStatus("waiting", this.code);

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void this.pushCandidate(ev.candidate);
      }
    };
    this.pc.onconnectionstatechange = () => this.handleConnectionState();
    // El canal de datos lo crea el CLIENTE (ofertante); aquí lo recibimos.
    this.pc.ondatachannel = (ev) => this.attachChannel(ev.channel);

    this.unsubDoc = onSnapshot(
      this.sessionRef,
      (snap) => this.handleSessionDoc(snap),
      (err) => {
        console.error(`[HostPeer/${this.code}] doc watch error:`, err);
      },
    );

    this.unsubCandidates = onSnapshot(
      query(
        collection(this.db, FIRESTORE_COLLECTION, this.code, "clientCandidates"),
        orderBy("at", "asc"),
      ),
      (snap) => this.handleCandidates(snap),
      (err) => {
        console.error(`[HostPeer/${this.code}] candidates watch error:`, err);
      },
    );

    this.waitTimer = setTimeout(() => {
      if (!this.stopped && this.pc && this.pc.connectionState !== "connected") {
        void this.stop("expired");
      }
    }, this.waitTimeoutMs);
  }

  async stop(detail?: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    if (this.waitTimer) {
      clearTimeout(this.waitTimer);
      this.waitTimer = null;
    }
    this.unsubDoc?.();
    this.unsubCandidates?.();
    this.unsubDoc = null;
    this.unsubCandidates = null;

    try {
      await updateDoc(this.sessionRef, {
        status: "closed",
        updatedAt: Date.now(),
      });
    } catch {
      // La sesión ya no existe; no pasa nada.
    }

    try {
      this.dc?.close();
    } catch {
      // ignorar
    }
    try {
      this.pc?.close();
    } catch {
      // ignorar
    }
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.dc = null;
    this.pc = null;

    this.onStatus("ended", detail);
  }

  send(message: DataChannelMessage): boolean {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // -- internals -----------------------------------------------------------

  private attachChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      this.onChannelState?.(true);
      this.send({ kind: "hello", payload: { sessionId: this.code, deviceName: this.deviceName } });
    };
    dc.onclose = () => {
      this.onChannelState?.(false);
    };
    dc.onmessage = (ev) => {
      const msg = decodeDataChannelMessage(ev.data);
      if (msg) {
        this.onData?.(msg);
      }
    };
  }

  private async pushCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      await addDoc(
        collection(this.db, FIRESTORE_COLLECTION, this.code, "hostCandidates"),
        {
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          candidate: candidate.candidate,
          at: Date.now(),
        },
      );
    } catch (err) {
      console.error(`[HostPeer/${this.code}] add host candidate error:`, err);
    }
  }

  private handleSessionDoc(snap: DocumentSnapshot<DocumentData>): void {
    if (!snap.exists()) {
      return;
    }
    const data = snap.data() as { offer?: string };
    if (data.offer && !this.hasAnswered) {
      this.hasAnswered = true;
      void this.answerOffer(data.offer);
    }
  }

  private async answerOffer(offerJson: string): Promise<void> {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(offerJson) as RTCSessionDescriptionInit),
      );

      if (!this.screenStream && this.getScreenStream) {
        try {
          this.screenStream = await this.getScreenStream();
        } catch (err) {
          console.warn(`[HostPeer/${this.code}] getScreenStream error:`, err);
          this.screenStream = null;
        }
      }
      if (this.screenStream) {
        const existing = new Set(this.pc.getSenders().map((s) => s.track));
        for (const track of this.screenStream.getTracks()) {
          if (track.kind !== "video" && track.kind !== "audio") {
            continue;
          }
          if (!existing.has(track)) {
            this.pc.addTrack(track, this.screenStream);
          }
        }
      }

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await updateDoc(this.sessionRef, {
        answer: JSON.stringify(answer),
        status: "signaling",
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[HostPeer/${this.code}] answer error:`, err);
      this.onStatus("error", "answer_failed");
    }
  }

  private handleCandidates(snap: QuerySnapshot<DocumentData>): void {
    for (const item of snap.docs) {
      const data = item.data() as IceCandidateDoc;
      if (!data.candidate || this.seenCandidates.has(data.candidate)) {
        continue;
      }
      this.seenCandidates.add(data.candidate);
      void this.addRemoteCandidate(data);
    }
  }

  private async addRemoteCandidate(candidate: IceCandidateDoc): Promise<void> {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    } catch (err) {
      console.warn(`[HostPeer/${this.code}] addIceCandidate error:`, err);
    }
  }

  private handleConnectionState(): void {
    if (!this.pc) {
      return;
    }
    switch (this.pc.connectionState) {
      case "connected":
        if (this.waitTimer) {
          clearTimeout(this.waitTimer);
          this.waitTimer = null;
        }
        this.onStatus("connected", this.code);
        void updateDoc(this.sessionRef, {
          status: "active",
          updatedAt: Date.now(),
        }).catch(() => undefined);
        break;
      case "failed":
        this.onStatus("error", "connection_failed");
        break;
      case "disconnected":
      case "closed":
        this.onStatus("ended");
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// ClientPeer: el equipo que controla busca la sesión y negocia
// ---------------------------------------------------------------------------

export interface ClientPeerOptions extends PeerHandlers {
  db: Firestore;
  code: string;
  deviceName: string;
  /** PIN enviado por el usuario (vacío si la sesión no lo exige). */
  pin?: string;
  /** Tiempo máximo de negociación antes de abortar (ms). */
  connectionTimeoutMs?: number;
  iceServers?: RTCIceServer[];
  /** Se invoca al recibir el primer track remoto con el stream de video. */
  onRemoteStream?: (stream: MediaStream) => void;
}

export interface ClientPeerStartResult {
  ok: boolean;
  reason?: string;
}

export class ClientPeer {
  private readonly db: Firestore;
  private readonly code: string;
  private readonly deviceName: string;
  private readonly pin?: string;
  private readonly connectionTimeoutMs: number;
  private readonly iceServers: RTCIceServer[];
  private readonly onStatus: (status: PeerStatus, detail?: string) => void;
  private readonly onData?: (msg: DataChannelMessage) => void;
  private readonly onChannelState?: (open: boolean) => void;
  private readonly onRemoteStream?: (stream: MediaStream) => void;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private remoteStream: MediaStream | null = null;
  private sessionRef: DocumentReference<DocumentData>;
  private unsubDoc: Unsubscribe | null = null;
  private unsubCandidates: Unsubscribe | null = null;
  private answerReceived = false;
  private stopped = false;
  private seenCandidates = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ClientPeerOptions) {
    this.db = options.db;
    this.code = options.code;
    this.deviceName = options.deviceName;
    this.pin = options.pin;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 90 * 1000;
    this.iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
    this.onStatus = options.onStatus;
    this.onData = options.onData;
    this.onChannelState = options.onChannelState;
    this.onRemoteStream = options.onRemoteStream;
    this.sessionRef = doc(collection(this.db, FIRESTORE_COLLECTION), this.code);
  }

  async start(): Promise<ClientPeerStartResult> {
    this.onStatus("looking_up", this.code);

    const snap = await getDoc(this.sessionRef);
    if (!snap.exists()) {
      this.onStatus("error", "code_not_found");
      return { ok: false, reason: "code_not_found" };
    }

    const data = snap.data() as SessionDoc;
    if (data.status === "active") {
      this.onStatus("error", "session_busy");
      return { ok: false, reason: "session_busy" };
    }
    if (data.pinProtected) {
      if (!this.pin) {
        this.onStatus("error", "pin_required");
        return { ok: false, reason: "pin_required" };
      }
      const hash = await sha256Hex(this.pin);
      if (hash !== data.pinHash) {
        this.onStatus("error", "pin_wrong");
        return { ok: false, reason: "pin_wrong" };
      }
    }

    this.onStatus("signaling", this.code);
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void this.pushCandidate(ev.candidate);
      }
    };
    this.pc.onconnectionstatechange = () => this.handleConnectionState();
    this.pc.ondatachannel = (ev) => this.attachChannel(ev.channel);
    // Esperamos video y audio (sendonly) del host en la respuesta. Se negocian
    // en el mismo offer/answer gracias a estos transceivers recvonly.
    this.pc.addTransceiver("video", { direction: "recvonly" });
    this.pc.addTransceiver("audio", { direction: "recvonly" });
    this.pc.ontrack = (ev) => {
      if (ev.streams.length > 0 && ev.streams[0]) {
        this.remoteStream = ev.streams[0];
        this.onRemoteStream?.(ev.streams[0]);
      }
    };

    this.unsubDoc = onSnapshot(
      this.sessionRef,
      (s) => this.handleSessionDoc(s),
      (err) => {
        console.error(`[ClientPeer/${this.code}] doc watch error:`, err);
      },
    );

    this.unsubCandidates = onSnapshot(
      query(
        collection(this.db, FIRESTORE_COLLECTION, this.code, "hostCandidates"),
        orderBy("at", "asc"),
      ),
      (s) => this.handleCandidates(s),
      (err) => {
        console.error(`[ClientPeer/${this.code}] candidates watch error:`, err);
      },
    );

    // El ofertante crea el canal de datos para que entre en la negociación SDP.
    this.dc = this.pc.createDataChannel(CHANNEL_NAME, { ordered: true });
    this.attachChannel(this.dc);

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await updateDoc(this.sessionRef, {
        offer: JSON.stringify(offer),
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[ClientPeer/${this.code}] offer error:`, err);
      this.onStatus("error", "offer_failed");
      return { ok: false, reason: "offer_failed" };
    }

    this.timer = setTimeout(() => {
      if (!this.stopped && this.pc && this.pc.connectionState !== "connected") {
        void this.stop("timeout");
      }
    }, this.connectionTimeoutMs);

    return { ok: true };
  }

  async stop(detail?: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unsubDoc?.();
    this.unsubCandidates?.();
    this.unsubDoc = null;
    this.unsubCandidates = null;

    try {
      this.dc?.close();
    } catch {
      // ignorar
    }
    try {
      this.pc?.close();
    } catch {
      // ignorar
    }
    this.remoteStream?.getTracks().forEach((t) => t.stop());
    this.remoteStream = null;
    this.dc = null;
    this.pc = null;

    this.onStatus("ended", detail);
  }

  send(message: DataChannelMessage): boolean {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /** Estadísticas WebRTC de la conexión (para el indicador de calidad). */
  async getStats(): Promise<RTCStatsReport | null> {
    if (!this.pc) {
      return null;
    }
    try {
      return await this.pc.getStats();
    } catch {
      return null;
    }
  }

  // -- internals -----------------------------------------------------------

  private attachChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      this.onChannelState?.(true);
      this.send({ kind: "hello", payload: { sessionId: this.code, deviceName: this.deviceName } });
    };
    dc.onclose = () => {
      this.onChannelState?.(false);
    };
    dc.onmessage = (ev) => {
      const msg = decodeDataChannelMessage(ev.data);
      if (msg) {
        this.onData?.(msg);
      }
    };
  }

  private async pushCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      await addDoc(
        collection(this.db, FIRESTORE_COLLECTION, this.code, "clientCandidates"),
        {
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          candidate: candidate.candidate,
          at: Date.now(),
        },
      );
    } catch (err) {
      console.error(`[ClientPeer/${this.code}] add client candidate error:`, err);
    }
  }

  private handleSessionDoc(snap: DocumentSnapshot<DocumentData>): void {
    if (!snap.exists()) {
      return;
    }
    const data = snap.data() as { answer?: string; status?: string };
    if (data.answer && !this.answerReceived) {
      this.answerReceived = true;
      void this.setRemoteAnswer(data.answer);
    }
    if (data.status === "closed") {
      void this.stop("session_closed");
      return;
    }
    // Ya hay otro cliente conectado y aun no procesamos respuesta propia.
    if (data.status === "active" && !this.answerReceived && this.pc?.connectionState !== "connected") {
      void this.stop("session_busy");
    }
  }

  private async setRemoteAnswer(answerJson: string): Promise<void> {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(answerJson) as RTCSessionDescriptionInit),
      );
    } catch (err) {
      console.error(`[ClientPeer/${this.code}] setRemoteDescription error:`, err);
      this.onStatus("error", "answer_invalid");
    }
  }

  private handleCandidates(snap: QuerySnapshot<DocumentData>): void {
    for (const item of snap.docs) {
      const data = item.data() as IceCandidateDoc;
      if (!data.candidate || this.seenCandidates.has(data.candidate)) {
        continue;
      }
      this.seenCandidates.add(data.candidate);
      void this.addRemoteCandidate(data);
    }
  }

  private async addRemoteCandidate(candidate: IceCandidateDoc): Promise<void> {
    if (!this.pc) {
      return;
    }
    try {
      await this.pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      });
    } catch (err) {
      console.warn(`[ClientPeer/${this.code}] addIceCandidate error:`, err);
    }
  }

  private handleConnectionState(): void {
    if (!this.pc) {
      return;
    }
    switch (this.pc.connectionState) {
      case "connected":
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.onStatus("connected", this.code);
        break;
      case "failed":
        this.onStatus("error", "connection_failed");
        break;
      case "disconnected":
      case "closed":
        this.onStatus("ended");
        break;
      default:
        break;
    }
  }
}