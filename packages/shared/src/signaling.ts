import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
  /**
   * Identificador del intento de negociación actual. Lo genera el cliente (que
   * es quien ofrece), viaja en offer/answer y etiqueta los documentos de
   * candidatos para que cada peer descarte los de intentos anteriores.
   */
  attemptId?: string;
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

/**
 * Margen que se le da a ICE en `disconnected` antes de declarar la caída. Ese
 * estado es transitorio (se recupera solo tras un parpadeo de red o un cambio
 * de Wi-Fi), pero si la PC remota se apaga es DEFINITIVO: el puerto se queda
 * sin respuesta y nunca vuelve a `connected`. Con 8 s detectamos el apagado
 * mucho antes que el keepalive (15 s) y la UI puede mostrar "PC Offline".
 */
const ICE_LOST_GRACE_MS = 8_000;

/** Motivos de cierre que, para el operador, significan "la PC remota no está". */
export const HOST_OFFLINE_REASONS: ReadonlySet<string> = new Set([
  "host_offline",
  "keepalive_timeout",
  "connection_failed",
]);

/**
 * Antigüedad mínima de un candidato para que la purga lo considere basura. El
 * margen es deliberadamente amplio: la purga corre al arrancar el host, que es
 * justo cuando un cliente puede estar escribiendo su oferta y sus candidatos.
 * Descartar candidatos viejos no depende de esto (eso lo hace `attemptId`), así
 * que podemos serConservadores y no arriesgar una carrera.
 */
const CANDIDATE_PURGE_GRACE_MS = 2 * 60 * 1000;

/** Máximo de borrados por batch de Firestore. */
const FIRESTORE_BATCH_LIMIT = 500;

/** true si la oferta SDP no incluye ninguna sección `m=video` (sesión solo bocina). */
function isAudioOnlyOffer(sdp: string): boolean {
  return !sdp.split(/\r?\n/).some((line) => line.startsWith("m=video"));
}

/**
 * Un candidato pertenece al intento vigente solo si trae el mismo `attemptId`.
 * Los candidatos de intentos anteriores se descartan: apuntan a un peer
 * connection ya muerto y ensucian el estado ICE actual (y hacen que la
 * negociación sea más lenta al procesarlos).
 *
 * Casos ambiguos que se aceptan a propósito:
 * - `attemptId` desconocido todavía (el offer del otro peer aún no llegó): no se
 *   puede filtrar todavía, así que el candidato se encola y el filtro definitivo
 *   se aplica al vaciar la cola (justo cuando ya se sabe el intento).
 * - Candidato sin `attemptId` (peer de una versión anterior): no hay forma de
 *   atribuirlos; rechazarlos rompería la conexión.
 */
function isCandidateForAttempt(data: IceCandidateDoc, attemptId: string): boolean {
  if (!attemptId || !data.attemptId) {
    return true;
  }
  return data.attemptId === attemptId;
}

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
  /**
   * Intento de negociación al que pertenece el candidato. Los candidatos de
   * intentos anteriores se ignoran (y no se reinyectan en el `pc` actual).
   * Opcional por compatibilidad con hosts previos a este campo.
   */
  attemptId?: string;
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
  /**
   * Devuelve SOLO audio de escritorio (loopback) para sesiones "solo bocina".
   * Se usa únicamente cuando el cliente ofrece sin sección `m=video`; en ese
   * caso no se captura pantalla (evita la degradación de input de Windows al
   * abrir la segunda captura junto al video). Si devuelve `null`/lanza, la
   * sesión sigue sin audio.
   */
  getAudioStream?: () => Promise<MediaStream | null>;
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
  private readonly getAudioStream?: () => Promise<MediaStream | null>;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private screenStream: MediaStream | null = null;
  private audioStream: MediaStream | null = null;
  private sessionRef: DocumentReference<DocumentData>;
  private unsubDoc: Unsubscribe | null = null;
  private unsubCandidates: Unsubscribe | null = null;
  private lastOffer?: string;
  private stopped = false;
  private seenCandidates = new Set<string>();
  /** Candidatos remotos que llegaron antes del remote description (trickle). */
  private pendingCandidates: IceCandidateDoc[] = [];
  /** Intento de negociación que está sirviendo este host (el del offer recibido). */
  private attemptId = '';
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastClientActivityAt = 0;

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
    this.getAudioStream = options.getAudioStream;
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
        attemptId: deleteField(),
        ...(this.secret
          ? {}
          : { expiresAt: now + this.waitTimeoutMs }),
      },
      { merge: true },
    );
    this.onStatus("waiting", this.code);

    // Cada arranque del host es un ciclo limpio de negociación: los candidatos
    // de ciclos anteriores ya no sirven (el `attemptId` los descarta igual, pero
    // siguen ocupando espacio y lecturas en cada snapshot futuro).
    void this.purgeStaleCandidates();

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
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
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
      // Si el canal sigue abierto, avisamos al cliente que nos vamos para que
      // corte de inmediato (y recicle) en vez de quedarse en "connected".
      if (this.dc?.readyState === "open") {
        this.dc.send(JSON.stringify({ kind: "control", payload: { kind: "bye" } }));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    } catch {
      // El canal ya está muerto; solo cerramos.
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
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.audioStream = null;
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
      this.lastClientActivityAt = Date.now();
      this.send({ kind: "hello", payload: { sessionId: this.code, deviceName: this.deviceName } });
      this.startHostKeepalive();
    };
    dc.onclose = () => {
      this.onChannelState?.(false);
    };
    dc.onmessage = (ev) => {
      this.lastClientActivityAt = Date.now();
      const msg = decodeDataChannelMessage(ev.data);
      if (!msg) {
        return;
      }
      // El host responde a los healthcheck del cliente (keepalive) sin
      // reenviarlos a la UI.
      if (msg.kind === "control" && msg.payload.kind === "healthcheck") {
        this.send({ kind: "control", payload: { kind: "pong" } });
        return;
      }
      // El cliente avisó que se va: liberamos la sesión ya, sin esperar al
      // keepalive (evita 20s de "sesión fantasma" en el host).
      if (msg.kind === "control" && msg.payload.kind === "bye") {
        void this.stop("client_closed").catch(() => undefined);
        return;
      }
      this.onData?.(msg);
    };
  }

  /** Si el cliente no dice nada en 20 s, el canal está muerto o el cliente se
   *  fue sin avisar: liberamos la sesión (estado fantasma) para que el próximo
   *  cliente pueda entrar y el cliente actual muestre "se perdió la conexión". */
  private startHostKeepalive(): void {
    if (this.keepaliveTimer) {
      return;
    }
    this.keepaliveTimer = setInterval(() => {
      if (this.stopped) {
        return;
      }
      if (this.dc?.readyState === "open" && Date.now() - this.lastClientActivityAt > 20_000) {
        console.warn(`[HostPeer/${this.code}] cliente sin actividad 20s; cerrando sesión fantasma`);
        void this.stop("client_offline").catch(() => undefined);
      }
    }, 5000);
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
          attemptId: this.attemptId,
        },
      );
    } catch (err) {
      console.error(`[HostPeer/${this.code}] add host candidate error:`, err);
    }
  }

  /**
   * Borra los candidatos más viejos que `CANDIDATE_PURGE_GRACE_MS`. Sin esto las
   * subcolecciones crecen para siempre: cada reconexión vuelve a subir los
   * candidatos (el `seenCandidates` es por intento) y el TTL de Firestore solo
   * borra el documento padre, nunca las subcolecciones.
   */
  private async purgeStaleCandidates(): Promise<void> {
    const cutoff = Date.now() - CANDIDATE_PURGE_GRACE_MS;
    for (const name of ["clientCandidates", "hostCandidates"]) {
      try {
        const snap = await getDocs(
          query(
            collection(this.db, FIRESTORE_COLLECTION, this.code, name),
            where("at", "<=", cutoff),
          ),
        );
        for (let i = 0; i < snap.docs.length; i += FIRESTORE_BATCH_LIMIT) {
          const batch = writeBatch(this.db);
          for (const stale of snap.docs.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
            batch.delete(stale.ref);
          }
          await batch.commit();
        }
        if (snap.size > 0) {
          console.log(`[HostPeer/${this.code}] purga ${name}: ${snap.size} candidatos viejos`);
        }
      } catch (err) {
        // Purga es higiene, no función crítica: si falla, el filtro por
        // attemptId sigue impidiendo que los candidatos viejos se apliquen.
        console.warn(`[HostPeer/${this.code}] purge ${name} error:`, err);
      }
    }
  }

  private handleSessionDoc(snap: DocumentSnapshot<DocumentData>): void {
    if (!snap.exists()) {
      return;
    }
    const data = snap.data() as { offer?: string; token?: string; attemptId?: string };
    if (!data.offer || data.offer === this.lastOffer) {
      return;
    }
    this.lastOffer = data.offer;
    // El intento vigente es el del offer que vamos a contestar: desde ahora los
    // candidatos del host se etiquetan con él y se descartan los de otros.
    this.attemptId = data.attemptId ?? '';
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
      const offer = JSON.parse(offerJson) as RTCSessionDescriptionInit;
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      // Candidatos que llegaron antes del offer: aplicarlos ya.
      this.flushPendingCandidates();

      // Sesión "solo bocina": el cliente ofrece sin sección `m=video`. Se captura
      // únicamente audio (loopback) para no degradar el renderer ni el pipeline
      // de input (en Windows la segunda captura junto al video era la que
      // rompía --isis-desktop-audio).
      const audioOnly = offer.sdp ? isAudioOnlyOffer(offer.sdp) : false;
      if (audioOnly) {
        if (this.getAudioStream) {
          try {
            this.audioStream = await this.getAudioStream();
          } catch (err) {
            console.warn(`[HostPeer/${this.code}] getAudioStream error:`, err);
            this.audioStream = null;
          }
        }
        if (this.audioStream) {
          const existing = new Set(this.pc.getSenders().map((s) => s.track));
          for (const track of this.audioStream.getTracks()) {
            if (track.kind !== "audio" || existing.has(track)) {
              continue;
            }
            this.pc.addTrack(track, this.audioStream);
          }
        }
        console.log(
          `[HostPeer/${this.code}] answer audio_only audioTracks=${this.audioStream ? this.audioStream.getAudioTracks().length : 0}`,
        );
      } else {
        if (!this.screenStream && this.getScreenStream) {
          // En un arranque manual Windows puede tardar un momento en publicar la
          // fuente de escritorio. No contestamos una oferta sin video, porque el
          // cliente quedaría "conectado" pero mostrando una pantalla vacía.
          for (let attempt = 1; attempt <= 3 && !this.screenStream; attempt += 1) {
            try {
              this.screenStream = await this.getScreenStream();
            } catch (err) {
              console.warn(`[HostPeer/${this.code}] getScreenStream attempt=${attempt} error:`, err);
              this.screenStream = null;
            }
            if (!this.screenStream && attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, 400));
            }
          }
        }
        if (this.getScreenStream && !this.screenStream) {
          throw new Error('screen_stream_unavailable');
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
      }

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await updateDoc(this.sessionRef, {
        answer: JSON.stringify(answer),
        status: "signaling",
        updatedAt: Date.now(),
        // Se devuelve el id del intento para que el cliente lo pueda cotejar.
        ...(this.attemptId ? { attemptId: this.attemptId } : {}),
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
      if (!isCandidateForAttempt(data, this.attemptId)) {
        continue;
      }
      // Los candidatos pueden llegar ANTES de que haya remoteDescription
      // (trickle + doc) y addIceCandidate los rechaza. Si los marcamos como
      // vistos y no los reaplicamos, la conexión queda coja (sin candidatos
      // del remoto) y se cae con connection_failed. Por eso se encolan y se
      // aplican al procesar la descripción remota (flushPendingCandidates).
      this.seenCandidates.add(data.candidate);
      if (this.pc?.remoteDescription) {
        void this.addRemoteCandidate(data);
      } else {
        this.pendingCandidates.push(data);
      }
    }
  }

  /** Aplica los candidatos encolados antes de tener la descripción remota. */
  private flushPendingCandidates(): void {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) {
      // Ahora sí se sabe qué intento se está sirviendo: los encolados de antes
      // son basura y no deben entrar al pc actual.
      if (!isCandidateForAttempt(candidate, this.attemptId)) {
        console.log(
          `[HostPeer/${this.code}] candidato descartado por intento obsoleto (${candidate.attemptId})`,
        );
        continue;
      }
      void this.addRemoteCandidate(candidate);
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
      case "closed":
        // Cierre real (stop() de cualquiera de los dos, o remoto). La sesión
        // queda en "espera" para el próximo cliente (modo emparejado).
        this.onStatus("ended");
        break;
      // "disconnected" es TRANSITORIO en WebRTC (un parpadeo de red puede
      // volver a "connected"). NO cerramos por eso: el keepalive del canal
      // detecta una caída real en silencio.
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
  /**
   * Colección de Firestore donde vive el doc de señalización. Default
   * `FIRESTORE_COLLECTION` (`sessions`). Se usa `TABLET_STREAM_COLLECTION`
   * (`tablet_stream`) para recibir la cámara de la tablet, reutilizando el
   * mismo protocolo offer/answer/candidatos.
   */
  collection?: string;
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
  /**
   * Modo "solo bocina": no se negocia video, solo se recibe audio del host
   * (el oferente no crea la sección `m=video` y el host responde con solo audio).
   */
  audioOnly?: boolean;
  /**
   * Pide una sección `m=audio` (default `true`). En `false` la negociación SDP
   * no lleva audio: se usa para el streaming de cámara de la tablet, que es
   * solo vídeo. No tiene efecto si `audioOnly` es `true`.
   */
  audio?: boolean;
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
  private readonly audioOnly: boolean;
  private readonly wantAudio: boolean;
  private readonly collectionName: string;
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
  /** Candidatos remotos que llegaron antes del remote description (trickle). */
  private pendingCandidates: IceCandidateDoc[] = [];
  /** Id del intento de negociación en curso. Lo genera el cliente (es quien
   *  ofrece) y viaja en el offer; el host lo devuelve en el answer. Etiqueta
   *  nuestros candidatos y filtra los del host. */
  private attemptId = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private iceLostTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPongAt = 0;
  private keepaliveLogged = false;

  constructor(options: ClientPeerOptions) {
    this.db = options.db;
    this.code = options.code;
    this.deviceName = options.deviceName;
    this.pin = options.pin;
    this.secret = options.secret;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 90 * 1000;
    this.iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
    this.audioOnly = options.audioOnly === true;
    this.wantAudio = options.audio !== false;
    this.collectionName = options.collection ?? FIRESTORE_COLLECTION;
    this.onStatus = options.onStatus;
    this.onData = options.onData;
    this.onChannelState = options.onChannelState;
    this.onRemoteStream = options.onRemoteStream;
    this.sessionRef = doc(collection(this.db, this.collectionName), this.code);
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
    // Nuevo intento de negociación: id propio para etiquetar nuestros
    // candidatos y descartar los que el host dejó en intentos anteriores.
    this.attemptId = generateSessionCode(12);
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void this.pushCandidate(ev.candidate);
      }
    };
    this.pc.onconnectionstatechange = () => this.handleConnectionState();
    this.pc.ondatachannel = (ev) => this.attachChannel(ev.channel);
    // Esperamos video y audio (sendonly) del host en la respuesta. Se negocian
    // en el mismo offer/answer gracias a estos transceivers recvonly. En modo
    // "solo bocina" no se pide video: el SDP resultante no lleva sección
    // `m=video` y el host responde capturando únicamente audio (loopback).
    if (!this.audioOnly) {
      this.pc.addTransceiver("video", { direction: "recvonly" });
      if (this.wantAudio) {
        this.pc.addTransceiver("audio", { direction: "recvonly" });
      }
    }
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
        collection(this.db, this.collectionName, this.code, "hostCandidates"),
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
        // El host lo copia al answer y lo usa para etiquetar sus candidatos.
        attemptId: this.attemptId,
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
    this.keepaliveLogged = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.iceLostTimer) {
      clearTimeout(this.iceLostTimer);
      this.iceLostTimer = null;
    }
    this.unsubDoc?.();
    this.unsubCandidates?.();
    this.unsubDoc = null;
    this.unsubCandidates = null;

    try {
      // Avisamos al host para que libere la sesión ya (sin esperar client_offline).
      if (this.dc?.readyState === "open") {
        this.dc.send(JSON.stringify({ kind: "control", payload: { kind: "bye" } }));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    } catch {
      // El canal ya está muerto; solo cerramos.
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
      this.lastPongAt = Date.now();
      this.send({ kind: "hello", payload: { sessionId: this.code, deviceName: this.deviceName } });
      this.startClientKeepalive();
    };
    dc.onclose = () => {
      this.onChannelState?.(false);
      // El canal se cerró sin que nosotros lo pidamos: el host cerró/apagó su app
      // (o se cayó la conexión). Antes solo se registraba y el cliente quedaba
      // "Conectado" con un frame congelado hasta que lo mataba el keepalive
      // (15 s). Cerramos ya para que la UI muestre el fallback "PC Offline".
      if (!this.stopped && this.dc === dc) {
        console.warn(`[ClientPeer/${this.code}] canal cerrado por el peer remoto; sesión caída`);
        void this.stop("host_offline").catch(() => undefined);
      }
    };
    dc.onmessage = (ev) => {
      const msg = decodeDataChannelMessage(ev.data);
      if (!msg) {
        return;
      }
      if (msg.kind === "control" && msg.payload.kind === "pong") {
        this.lastPongAt = Date.now();
        return;
      }
      // El host cortó (p. ej. requestDisconnect del propio cliente o cierre del
      // tray). Cerramos de inmediato para no quedarnos en "connected" con un
      // canal muerto (que además disparaba retries del keepalive).
      if (msg.kind === "control" && msg.payload.kind === "bye") {
        void this.stop("bye").catch(() => undefined);
        return;
      }
      this.onData?.(msg);
    };
  }

  /** Ping cada 5 s. Si el canal muere en silencio (sin que cambie el estado ICE),
   *  el host deja de contestar y a los 15 s declaramos la caída: sin esto los
   *  inputs se enviarían a un canal muerto, "congelando" el control. */
  private startClientKeepalive(): void {
    if (this.keepaliveTimer) {
      return;
    }
    this.keepaliveTimer = setInterval(() => {
      if (this.stopped) {
        return;
      }
      if (this.dc?.readyState !== "open") {
        return;
      }
      this.send({ kind: "control", payload: { kind: "healthcheck" } });
      if (Date.now() - this.lastPongAt > 15_000) {
        if (!this.keepaliveLogged) {
          this.keepaliveLogged = true;
          console.warn(`[ClientPeer/${this.code}] canal sin pong 15s; cerrando`);
        }
        void this.stop("keepalive_timeout").catch(() => undefined);
      }
    }, 5000);
  }

  private async pushCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      await addDoc(
        collection(this.db, this.collectionName, this.code, "clientCandidates"),
        {
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          candidate: candidate.candidate,
          at: Date.now(),
          attemptId: this.attemptId,
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
    const data = snap.data() as {
      answer?: string;
      status?: string;
      rejected?: string;
      attemptId?: string;
    };
    if (data.answer && !this.answerReceived) {
      this.answerReceived = true;
      // El host confirma el intento en curso. Solo lo adoptamos si coincide con
      // el nuestro: si no, es la respuesta de una negociación vieja.
      if (data.attemptId && data.attemptId !== this.attemptId) {
        console.warn(
          `[ClientPeer/${this.code}] answer de otro intento (${data.attemptId} != ${this.attemptId}); ignorada`,
        );
        return;
      }
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
      // Candidatos que llegaron antes del answer: aplicarlos ya.
      this.flushPendingCandidates();
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
      if (!isCandidateForAttempt(data, this.attemptId)) {
        continue;
      }
      // Los candidatos pueden llegar ANTES de que haya remoteDescription
      // (trickle + doc) y addIceCandidate los rechaza. Si los marcamos como
      // vistos y no los reaplicamos, la conexión queda coja y se cae con
      // connection_failed. Se encolan y se aplican al procesar el answer.
      this.seenCandidates.add(data.candidate);
      if (this.pc?.remoteDescription) {
        void this.addRemoteCandidate(data);
      } else {
        this.pendingCandidates.push(data);
      }
    }
  }

  /** Aplica los candidatos encolados antes de tener el remote description. */
  private flushPendingCandidates(): void {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) {
      // Ahora sí se sabe qué intento se está sirviendo: los encolados de antes
      // son basura y no deben entrar al pc actual.
      if (!isCandidateForAttempt(candidate, this.attemptId)) {
        console.log(
          `[ClientPeer/${this.code}] candidato descartado por intento obsoleto (${candidate.attemptId})`,
        );
        continue;
      }
      void this.addRemoteCandidate(candidate);
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
        this.clearIceLostTimer();
        this.onStatus("connected", this.code);
        break;
      case "failed":
        this.onStatus("error", "connection_failed");
        break;
      case "disconnected":
        // Caída de transporte: el host se apagó, se quedó sin red o el camino
        // cambió. Es transitorio, así que damos un margen (si vuelve a
        // "connected" se cancela) antes de declararlo PC apagada.
        this.scheduleIceLost();
        break;
      case "closed":
        this.onStatus("ended");
        break;
      default:
        break;
    }
  }

  /** Programa la declaración de "PC Offline" tras `ICE_LOST_GRACE_MS` en `disconnected`. */
  private scheduleIceLost(): void {
    if (this.iceLostTimer || this.stopped) {
      return;
    }
    console.warn(`[ClientPeer/${this.code}] ICE disconnected; esperando ${ICE_LOST_GRACE_MS}ms`);
    this.iceLostTimer = setTimeout(() => {
      this.iceLostTimer = null;
      if (this.stopped || !this.pc) {
        return;
      }
      // Si el estado volvió a connected/failed mientras esperábamos, otro
      // manejador ya decidió qué hacer y esta alarma queda invalidada.
      if (this.pc.connectionState === "disconnected") {
        void this.stop("host_offline").catch(() => undefined);
      }
    }, ICE_LOST_GRACE_MS);
  }

  private clearIceLostTimer(): void {
    if (this.iceLostTimer) {
      clearTimeout(this.iceLostTimer);
      this.iceLostTimer = null;
    }
  }
}
