import {
  addDoc,
  collection,
  deleteField,
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

export type SessionStatus = "waiting" | "signaling" | "active" | "closed" | "rejected";

export interface SessionDoc {
  machineCode: string;
  status: SessionStatus;
  deviceName: string;
  pinProtected: boolean;
  createdAt: number;
  updatedAt: number;
  /** El host deja de esperar y se cierra a esta hora (ms epoch). Solo modo manual. */
  expiresAt?: number;
  /** Hash SHA-256 del PIN con el que el host protege la sesión. */
  pinHash?: string;
  /** Offer/answer serializados (JSON string de RTCSessionDescriptionInit). */
  offer?: string;
  answer?: string;
  /** hostId del host en modo emparejado (en manual coincide con machineCode). */
  hostId?: string;
  /** Hash SHA-256 del secreto de emparejamiento (modo emparejado). */
  tokenHash?: string;
  /** Token `sha256(secreto)` que escribe el CLIENTE junto a su oferta. */
  token?: string;
  /** Motivo por el que el host rechazó la conexión (p. ej. par_token_invalid). */
  rejected?: string;
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
  /**
   * Secreto de emparejamiento (modo persistente). Si se indica la sesión queda
   * anclada a `sessions/{code}` (hostId), sin TTL, valida `token = sha256(secret)`
   * antes de responder y sigue vivo tras terminar. NUNCA se publica en Firestore.
   */
  secret?: string;
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
  private readonly secret?: string;
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
  private lastOffer?: string;
  private stopped = false;
  private seenCandidates = new Set<string>();
  private waitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HostPeerOptions) {
    this.db = options.db;
    this.code = options.code;
    this.deviceName = options.deviceName;
    this.pin = options.pin;
    this.secret = options.secret;
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
    const tokenHash = this.secret ? await sha256Hex(this.secret) : undefined;
    const now = Date.now();
    // merge + delete: la sesión persistente conserva campos ajenos (offer/token
    // de un intento en curso entre ciclos) y limpia artefactos de sesiones previas.
    await setDoc(
      this.sessionRef,
      {
        machineCode: this.code,
        status: "waiting",
        deviceName: this.deviceName,
        pinProtected: Boolean(this.pin),
        ...(pinHash ? { pinHash } : {}),
        ...(tokenHash ? { tokenHash } : {}),
        ...(this.secret ? { hostId: this.code } : {}),
        createdAt: now,
        updatedAt: now,
        offer: deleteField(),
        answer: deleteField(),
        rejected: deleteField(),
        ...(this.secret
          ? {}
          : { expiresAt: now + this.waitTimeoutMs }),
      },
      { merge: true },
    );
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

    if (!this.secret) {
      this.waitTimer = setTimeout(() => {
        if (!this.stopped && this.pc && this.pc.connectionState !== "connected") {
          void this.stop("expired");
        }
      }, this.waitTimeoutMs);
    }
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
      // En modo emparejado la sesión persiste "escuchando" para el próximo
      // cliente; en modo manual se cierra como hasta ahora.
      await updateDoc(this.sessionRef, {
        status: this.secret ? "waiting" : "closed",
        answer: deleteField(),
        offer: deleteField(),
        rejected: deleteField(),
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
    const data = snap.data() as { offer?: string; token?: string };
    if (!data.offer || data.offer === this.lastOffer) {
      return;
    }
    this.lastOffer = data.offer;
    if (this.secret) {
      // Modo emparejado: solo contestamos si el cliente prueba identidad.
      void sha256Hex(this.secret)
        .then((hash) => {
          if (!data.token) {
            return this.reject("pair_token_missing");
          }
          if (hash !== data.token) {
            return this.reject("pair_token_invalid");
          }
          return this.answerOffer(data.offer as string);
        })
        .catch((err) => {
          console.error(`[HostPeer/${this.code}] token check error:`, err);
        });
      return;
    }
    void this.answerOffer(data.offer);
  }

  /** Marca la sesión como rechazada (sin responder la oferta) y avisa a la UI. */
  private async reject(reason: string): Promise<void> {
    this.onStatus("error", reason);
    try {
      await updateDoc(this.sessionRef, {
        status: "rejected",
        rejected: reason,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[HostPeer/${this.code}] reject error:`, err);
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
  /**
   * Secreto de emparejamiento (modo persistente). Si el doc de la sesión exige
   * token (`tokenHash`), este secreto es obligatorio y se envía como
   * `token = sha256(secret)` junto a la oferta. Nunca viaja en claro.
   */
  secret?: string;
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
  private readonly secret?: string;
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
    this.secret = options.secret;
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
    if (data.tokenHash) {
      // Sesión emparejada: exigimos el secreto y lo usamos como prueba de identidad.
      if (!this.secret) {
        this.onStatus("error", "pair_required");
        return { ok: false, reason: "pair_required" };
      }
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
      const patch: Record<string, unknown> = {
        offer: JSON.stringify(offer),
        updatedAt: Date.now(),
      };
      if (this.secret) {
        patch.token = await sha256Hex(this.secret);
      }
      await updateDoc(this.sessionRef, patch);
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
    const data = snap.data() as { answer?: string; status?: string; rejected?: string };
    if (data.answer && !this.answerReceived) {
      this.answerReceived = true;
      void this.setRemoteAnswer(data.answer);
    }
    if (data.status === "rejected") {
      void this.stop(data.rejected || "rejected");
      return;
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