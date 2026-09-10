import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientPeer,
  FirestoreStatus,
  getFirebaseDb,
  normalizeKey,
  type DataChannelMessage,
  type MouseAction,
  type MouseButton,
  type PeerStatus,
} from '@isisanubis/shared';
import type { SavedPair } from './global';

const STATUS_TOOLTIP: Record<PeerStatus, string> = {
  idle: 'En reposo',
  creating: 'Creando…',
  waiting: 'Esperando máquina…',
  looking_up: 'Buscando sesión…',
  signaling: 'Negociando conexión…',
  connecting: 'Conectando…',
  connected: 'Conectado',
  ended: 'Sesión terminada',
  error: 'Error',
};

const ERROR_DETAIL: Record<string, string> = {
  code_not_found: 'El código no existe. Revisa la máquina remota.',
  pin_required: 'Esta sesión exige un PIN.',
  pin_wrong: 'PIN incorrecto.',
  timeout: 'Se agotó el tiempo de conexión.',
  connection_failed: 'No se pudo establecer la conexión.',
  session_closed: 'La sesión fue cerrada por la máquina remota.',
  session_busy: 'La sesión ya está en uso por otro cliente (una sola sesión a la vez).',
  pair_required: 'Este equipo exige emparejamiento. Guardalo desde "Añadir equipo".',
  pair_token_invalid: 'El secreto de este equipo ya no es válido. Volvé a emparejar.',
  pair_token_missing: 'El host no pudo validar tu emparejamiento.',
  rejected: 'Conexión rechazada por la máquina remota.',
};

interface StreamStats {
  rtt?: number;
  mbps?: number;
  frames?: number;
}

const App: React.FC = () => {
  const [view, setView] = useState<'dashboard' | 'session'>('dashboard');
  const [sessionName, setSessionName] = useState('');
  const [pairs, setPairs] = useState<SavedPair[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newId, setNewId] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<PeerStatus>('idle');
  const [detail, setDetail] = useState('');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<{ x: number; y: number } | null>(null);
  const [freezeHint, setFreezeHint] = useState('');
  const peerRef = useRef<ClientPeer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cursorLogCountRef = useRef(0);
  /** Intentos automáticos de input_reset de esta sesión (limitado: si el host
   *  está congelado en un menú elevado de la bandeja, el reset no sirve de nada
   *  y no tiene sentido inundar el canal con decenas de resets). */
  const resetAttemptsRef = useRef(0);
  /** Throttle de moves: evita inundar el canal con decenas de puntos por segundo. */
  const moveTimerRef = useRef<number | undefined>(undefined);
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  /** Resolución REAL del escritorio del host (donde se inyecta el mouse). La
   *  captura puede llegar escalada (p. ej. 1920x1080 con pantalla 2560x1440),
   *  así que el mapeo de coordenadas usa ESTE valor, no el del video. */
  const hostDisplayRef = useRef<{ width: number; height: number } | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Botones que el cliente cree pulsados. Mantiene el estado del host
   *  consistente: si el `mouseup` se pierde (botón soltado fuera del video o
   *  al perder foco la ventana), el host quedaría con el botón pulsado y su
   *  mouse "arrastraría" en vez de moverse (mause trabado). */
  const pressedMouseRef = useRef<Set<MouseButton>>(new Set());
  /** Última vez que el usuario movió/hizo clic sobre el video. Se usa para
   *  detectar un host congelado (muevo pero el cursor del host no responde). */
  const lastLocalMouseAtRef = useRef(0);
  /** Última posición del cursor del host y cuándo cambió (para el detector de
   *  congelamiento: si muevo y el cursor del host no avanza, el host está atascado). */
  const lastHostCursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const hostCursorMovedAtRef = useRef(0);
  /** Evita mandar el input_reset en bucle (cooldown). */
  const lastInputResetAtRef = useRef(0);
  /** Acumulador de wheel: la rueda/trackpad genera decenas de eventos/segundo y
   *  cada `scroll` cuesta ~200 ms al host (paso de rueda de nut-js); un flujo
   *  sin control inunda el canal y la cola serializada del host (backlog de 130+
   *  eventos = 30+s sin poder hacer nada). Acumulamos ~80 ms y enviamos un solo
   *  evento con los deltas sumados. */
  const wheelAccumRef = useRef({ dx: 0, dy: 0 });
  const wheelTimerRef = useRef<number | undefined>(undefined);
  const everConnectedRef = useRef(false);
  const activePairIdRef = useRef<string | null>(null);
  /** Parámetros de la última conexión, para la reconexión automática. */
  const lastPeerParamsRef = useRef<{ c: string; p: string; s?: string } | null>(null);
  const autoRetryRef = useRef(0);
  const autoRetryTimerRef = useRef<number | null>(null);
  /** El usuario pulsó Desconectar: no reconectar en automático. */
  const manualDisconnectRef = useRef(false);

  /** Último valor del portapapeles local aplicado (evita ecos al sincronizar). */
  const lastClipboardRef = useRef<string | null>(null);

  const refreshPairs = useCallback(() => {
    void window.isis?.getPairs().then(setPairs);
  }, []);

  useEffect(() => {
    refreshPairs();
  }, [refreshPairs]);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => {
      const next = !prev;
      window.isis?.setFullscreen(next);
      return next;
    });
  }, []);

  /** F11 alterna la pantalla completa (local, sin reenviarse al host). */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  /** Convierte un punto del elemento <video> (incluye letterboxing) a la
   *  posición del escritorio del host según su resolución REAL. */
  const toHostPoint = useCallback((clientX: number, clientY: number) => {
    const video = videoRef.current;
    if (!video) {
      return null;
    }
    const host = hostDisplayRef.current;
    const hostW = host?.width ?? video.videoWidth;
    const hostH = host?.height ?? video.videoHeight;
    if (!hostW || !hostH) {
      return null;
    }
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / hostW, rect.height / hostH);
    const drawW = hostW * scale;
    const drawH = hostH * scale;
    const offsetX = (rect.width - drawW) / 2;
    const offsetY = (rect.height - drawH) / 2;
    const x = Math.round((clientX - rect.left - offsetX) / scale);
    const y = Math.round((clientY - rect.top - offsetY) / scale);
    return {
      x: Math.min(Math.max(x, 0), hostW - 1),
      y: Math.min(Math.max(y, 0), hostH - 1),
    };
  }, []);

  /** Mapea un punto del host al contenedor local (para el overlay del cursor). */
  const toClientPoint = useCallback((hostX: number, hostY: number) => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const host = hostDisplayRef.current;
    const hostW = host?.width ?? videoRef.current?.videoWidth;
    const hostH = host?.height ?? videoRef.current?.videoHeight;
    if (!hostW || !hostH) {
      return null;
    }
    const rect = container.getBoundingClientRect();
    const scale = Math.min(rect.width / hostW, rect.height / hostH);
    const drawW = hostW * scale;
    const drawH = hostH * scale;
    const left = (rect.width - drawW) / 2 + hostX * scale;
    const top = (rect.height - drawH) / 2 + hostY * scale;
    return { left, top };
  }, []);

  const send = useCallback((msg: DataChannelMessage): void => {
    peerRef.current?.send(msg);
  }, []);

  const sendMouse = useCallback(
    (action: MouseAction): void => {
      send({ kind: 'mouse', payload: action });
    },
    [send],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      const p = toHostPoint(e.clientX, e.clientY);
      if (!p) {
        return;
      }
      lastLocalMouseAtRef.current = Date.now();
      setRemoteCursor(p);
      lastMouseRef.current = p;
      pendingPointRef.current = p;
      if (moveTimerRef.current === undefined) {
        moveTimerRef.current = window.setTimeout(() => {
          moveTimerRef.current = undefined;
          const target = pendingPointRef.current;
          if (target) {
            pendingPointRef.current = null;
            sendMouse({ type: 'move', x: target.x, y: target.y });
          }
        }, 25);
      }
    },
    [sendMouse, toHostPoint],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      e.preventDefault();
      const p = toHostPoint(e.clientX, e.clientY);
      if (!p) {
        return;
      }
      lastLocalMouseAtRef.current = Date.now();
      lastMouseRef.current = p;
      setRemoteCursor(p);
      const button: MouseButton = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      if (pressedMouseRef.current.has(button)) {
        // Ya lo consideramos pulsado (p. ej. un down duplicado tras re-focus):
        // reenviarlo dejaría al host con dos press sin el release correspondiente.
        return;
      }
      pressedMouseRef.current.add(button);
      sendMouse({ type: 'move', x: p.x, y: p.y });
      sendMouse({ type: 'down', button, x: p.x, y: p.y });
      void videoRef.current?.focus();
    },
    [sendMouse, toHostPoint],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      const button: MouseButton = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      const p = toHostPoint(e.clientX, e.clientY);
      lastLocalMouseAtRef.current = Date.now();
      if (p) {
        lastMouseRef.current = p;
        setRemoteCursor(p);
        sendMouse({ type: 'move', x: p.x, y: p.y });
      }
      if (pressedMouseRef.current.delete(button)) {
        sendMouse({ type: 'up', button, x: lastMouseRef.current.x, y: lastMouseRef.current.y });
      }
    },
    [sendMouse, toHostPoint],
  );

  /** Libera los botones que el cliente tiene pulsados (recuperación cuando el
   *  `mouseup` no llega al video: botón soltado fuera de la ventana, blur, etc.) */
  const releaseAllMouseButtons = useCallback(() => {
    const pressed = pressedMouseRef.current;
    if (pressed.size === 0) {
      return;
    }
    const pos = lastMouseRef.current;
    for (const button of [...pressed]) {
      sendMouse({ type: 'up', button, x: pos.x, y: pos.y });
    }
    pressed.clear();
  }, [sendMouse]);

  /** Captura global del mouse: si el botón se suelta FUERA del área de video
   *  (arrastrando hacia fuera de la ventana, sobre la barra de sesión, etc.) el
   *  `onMouseUp` del elemento no se dispara y el host quedaría con el botón
   *  pulsado (mause trabado). Escuchamos el `mouseup` y el `blur` a nivel de
   *  ventana para garantizar que el host siempre reciba el `up`. */
  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    const onWindowMouseUp = (e: MouseEvent): void => {
      const button: MouseButton = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      if (pressedMouseRef.current.delete(button)) {
        const pos = lastMouseRef.current;
        sendMouse({ type: 'up', button, x: pos.x, y: pos.y });
      }
    };
    const onWindowBlur = (): void => {
      releaseAllMouseButtons();
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [sendMouse, releaseAllMouseButtons, status]);

  /** Detector de host congelado: si el usuario mueve el mouse sobre el video y
   *  el cursor del HOST no cambia de posición en ~2 s, la inyección del host se
   *  atascó (botón pegado o llamada nativa colgada). Envío un `inputReset` para
   *  que el host libere botones y reinicie la cola al instante, sin esperar su
   *  reconcile interno. Con cooldown de 5 s para no inundar el canal. */
  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    // Estado inicial limpio del detector de congelamiento por si se reconecta:
    // sin esto, con hostCursorMovedAtRef=0 podría mandar un input_reset falso
    // justo tras conectar.
    hostCursorMovedAtRef.current = Date.now();
    lastLocalMouseAtRef.current = 0;
    resetAttemptsRef.current = 0;
    setFreezeHint('');
    const timer = window.setInterval(() => {
      const now = Date.now();
      const userMoving = now - lastLocalMouseAtRef.current < 1500;
      const hostStuck = now - hostCursorMovedAtRef.current > 2000;
      const cooldownOk = now - lastInputResetAtRef.current > 5000;
      if (userMoving && hostStuck && cooldownOk && resetAttemptsRef.current < 3) {
        lastInputResetAtRef.current = now;
        resetAttemptsRef.current += 1;
        console.log('[client] host sin respuesta del cursor mientras muevo; enviando input_reset');
        send({ kind: 'control', payload: { kind: 'inputReset' } });
        if (resetAttemptsRef.current >= 2) {
          setFreezeHint(
            'El host no responde: probablemente quedó un menú del sistema de Windows (bandeja/Task Manager) abierto. ' +
              'Ciérralo con Escape en el host, o ejecuta el host como administrador.',
          );
          console.warn('[client] host congelado tras varios resets; probable menú elevado del sistema');
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [send, status]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLVideoElement>) => {
      e.preventDefault();
      wheelAccumRef.current.dx += e.deltaX;
      wheelAccumRef.current.dy += e.deltaY;
      if (wheelTimerRef.current === undefined) {
        wheelTimerRef.current = window.setTimeout(() => {
          wheelTimerRef.current = undefined;
          const { dx, dy } = wheelAccumRef.current;
          wheelAccumRef.current = { dx: 0, dy: 0 };
          if (dx !== 0 || dy !== 0) {
            sendMouse({ type: 'scroll', deltaX: dx, deltaY: dy });
          }
        }, 80);
      }
    },
    [sendMouse],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    e.preventDefault();
  }, []);

  // --- Envío de teclado ------------------------------------------------

  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'F11') {
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        send({ kind: 'key', payload: { type: 'type', key: e.key.toLowerCase(), text: e.key } });
        return;
      }
      send({ kind: 'key', payload: { type: 'down', key: e.code } });
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'F11') {
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        return;
      }
      send({ kind: 'key', payload: { type: 'up', key: e.code } });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [send, status]);

  // --- Portapapeles (sincronización bidireccional) ------------------------

  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      const initial = await window.isis?.readClipboard();
      console.log(`[client] clipboard_seed len=${initial === undefined ? 'undefined' : initial.length}`);
      if (cancelled || initial === undefined) {
        return;
      }
      lastClipboardRef.current = initial;
      timer = window.setInterval(async () => {
        try {
          const text = await window.isis?.readClipboard();
          if (cancelled || text === undefined || text === lastClipboardRef.current) {
            return;
          }
          lastClipboardRef.current = text;
          send({ kind: 'clipboard', payload: { text } });
          console.log(`[client] clipboard_sent len=${text.length}`);
        } catch (err) {
          console.error('[client] clipboard poll error:', err);
        }
      }, 700);
    })();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [send, status]);

  /** Con --isis-clipboard-test: simulo una copia local 1,5 s tras conectar
   *  (el poll de siembra ya está armado) para probar la sincronización. */
  useEffect(() => {
    if (status !== 'connected' || !window.isis?.clipboardTest) {
      return;
    }
    const timer = window.setTimeout(() => {
      const text = '[isis] portapapeles de prueba';
      void window.isis
        ?.writeClipboard(text)
        .then(() => console.log(`[client] clipboard_test: texto escrito len=${text.length}`))
        .catch((err) => console.error('[client] clipboard_test write error:', err));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [status]);

  /** Con --isis-input-test: envío una secuencia de entradas de prueba al conectar. */
  useEffect(() => {
    if (status !== 'connected' || !window.isis?.inputTest) {
      return;
    }
    console.log('[client] input_test: enviando secuencia de prueba');
    const steps: DataChannelMessage[] = [
      { kind: 'mouse', payload: { type: 'move', x: 400, y: 300 } },
      { kind: 'mouse', payload: { type: 'down', button: 'left', x: 400, y: 300 } },
      { kind: 'mouse', payload: { type: 'up', button: 'left', x: 400, y: 300 } },
      { kind: 'key', payload: { type: 'type', key: 'hola', text: 'Hola' } },
      { kind: 'key', payload: { type: 'down', key: 'Enter' } },
      { kind: 'key', payload: { type: 'up', key: 'Enter' } },
    ];
    let i = 0;
    const timer = window.setInterval(() => {
      if (i >= steps.length) {
        window.clearInterval(timer);
        console.log('[client] input_test: secuencia completa');
        return;
      }
      send(steps[i]);
      console.log(`[client] input_test: envio ${steps[i].kind} ${JSON.stringify(steps[i].payload)}`);
      i += 1;
    }, 500);
    return () => window.clearInterval(timer);
  }, [send, status]);

  /** Indicador de calidad: RTT, bitrate y frames decodificados vía getStats() cada 2 s. */
  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    let prev: { t: number; bytes: number } | null = null;
    const timer = window.setInterval(async () => {
      const report = await peerRef.current?.getStats();
      if (!report) {
        return;
      }
      let rtt: number | undefined;
      let bytes = 0;
      let frames = 0;
      report.forEach((stat) => {
        const s = stat as unknown as {
          type?: string;
          kind?: string;
          state?: string;
          currentRoundTripTime?: number;
          bytesReceived?: number;
          framesDecoded?: number;
        };
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') {
          rtt = s.currentRoundTripTime;
        }
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          bytes = s.bytesReceived ?? 0;
          frames = s.framesDecoded ?? 0;
        }
      });
      const now = performance.now();
      let mbps: number | undefined;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0) {
          mbps = ((bytes - prev.bytes) * 8) / dt / 1e6;
        }
      }
      prev = { t: now, bytes };
      setStats({ rtt, mbps, frames });
      console.log(
        `[client] stats rtt=${rtt !== undefined ? rtt.toFixed(0) : '?'}ms bitrate=${mbps !== undefined ? mbps.toFixed(1) : '?'}Mbps frames=${frames}`,
      );
    }, 2000);
    return () => window.clearInterval(timer);
  }, [status]);

  /** Con --isis-autostop=<seg>: el cliente pide al host cerrar la sesión a los N segundos. */
  useEffect(() => {
    if (status !== 'connected' || !window.isis?.autostop) {
      return;
    }
    const secs = window.isis.autostop;
    const timer = window.setTimeout(() => {
      console.log(`[client] autostop: requestDisconnect a los ${secs}s`);
      // Es un cierre iniciado por nosotros: no reconectar en automático.
      manualDisconnectRef.current = true;
      send({ kind: 'control', payload: { kind: 'requestDisconnect' } });
    }, secs * 1000);
    return () => window.clearTimeout(timer);
  }, [send, status]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && remoteStream) {
      video.srcObject = remoteStream;
      void video.play().catch(() => undefined);
    }
    if (video && !remoteStream) {
      video.srcObject = null;
    }
  }, [remoteStream]);

  const connect = useCallback(
    (codeArg?: string, pinArg?: string, secretArg?: string, pairName?: string) => {
      const c = (secretArg ? normalizeKey(codeArg ?? '') : (codeArg ?? code).trim().toLowerCase()).trim();
      const p = pinArg ?? pin;
      if (!c) {
        return;
      }
      setSessionName(pairName ?? c);
      setView('session');
      manualDisconnectRef.current = false;
      lastPeerParamsRef.current = { c, p, s: secretArg };
      void (async () => {
        if (peerRef.current) {
          await peerRef.current.stop();
          peerRef.current = null;
        }
        activePairIdRef.current = secretArg ? c : null;
        setRemoteStream(null);
        const peer = new ClientPeer({
          db: getFirebaseDb(),
          code: c,
          deviceName: 'Client',
          pin: p || undefined,
          secret: secretArg,
          onStatus: (s, d) => {
            console.log(`[client] status=${s}${d ? ` detail=${d}` : ''}`);
            setStatus(s);
            setDetail(d ? (ERROR_DETAIL[d] ?? d) : '');
            if (s === 'connected') {
              autoRetryRef.current = 0;
              console.log(`[client] CONNECTED code=${c}${pairName ? ` team=${pairName}` : ''}`);
              if (activePairIdRef.current) {
                void window.isis?.getPairs().then((list) => {
                  const rec = list.find((x) => x.id === activePairIdRef.current);
                  if (rec) {
                    void window.isis?.savePair({ ...rec, lastConnectedAt: Date.now() });
                  }
                });
              }
              return;
            }
            // Tras haber tenido una sesión buena, una caída del transporte se
            // intenta en automático (la WebRTC se muere sola a veces: ICE
            // limpy y sin candidatos se va a connection_failed). El usuario
            // puede pulsar Reconectar (resetea el contador) o Desconectar.
            if (
              (s === 'ended' || s === 'error') &&
              everConnectedRef.current &&
              !manualDisconnectRef.current &&
              autoRetryRef.current < 3
            ) {
              const params = lastPeerParamsRef.current;
              if (params) {
                autoRetryRef.current += 1;
                console.log(`[client] auto_reconnect intento ${autoRetryRef.current}/3 en 1.5s`);
                autoRetryTimerRef.current = window.setTimeout(() => {
                  autoRetryTimerRef.current = null;
                  connect(params.c, params.p, params.s);
                }, 1500);
              }
            }
          },
          onData: (msg) => {
            if (msg.kind === 'hello') {
              console.log(`[client] peer_hello device=${msg.payload.deviceName}`);
              setDetail(`Máquina remota: ${msg.payload.deviceName}`);
            } else if (msg.kind === 'clipboard') {
              void window.isis?.writeClipboard(msg.payload.text);
              lastClipboardRef.current = msg.payload.text;
              console.log(`[client] clipboard_recv (remoto) len=${msg.payload.text.length}`);
            } else if (msg.kind === 'display') {
              hostDisplayRef.current = { width: msg.payload.width, height: msg.payload.height };
              console.log(`[client] display_info ${msg.payload.width}x${msg.payload.height}`);
            } else if (msg.kind === 'cursor') {
              setRemoteCursor({ x: msg.payload.x, y: msg.payload.y });
              const last = lastHostCursorPosRef.current;
              if (!last || last.x !== msg.payload.x || last.y !== msg.payload.y) {
                lastHostCursorPosRef.current = { x: msg.payload.x, y: msg.payload.y };
                hostCursorMovedAtRef.current = Date.now();
                setFreezeHint('');
              }
              cursorLogCountRef.current += 1;
              if (cursorLogCountRef.current % 15 === 1) {
                console.log(`[client] cursor_host ${msg.payload.x},${msg.payload.y}`);
              }
            }
          },
          onChannelState: (open) => {
            console.log(`[client] channel_state=${open ? 'open' : 'closed'}`);
          },
          onRemoteStream: (stream) => {
            const tracks = stream.getVideoTracks();
            const audio = stream.getAudioTracks();
            console.log(
              `[client] remote_stream videoTracks=${tracks.length} audioTracks=${audio.length} w=${tracks[0]?.getSettings().width ?? '?'}`,
            );
            if (audio.length > 0) {
              console.log('[client] audio_ready');
            }
            setRemoteStream(stream);
          },
        });
        peerRef.current = peer;
        await peer.start();
        console.log(`[client] session_started code=${c}`);
      })();
    },
    [code, pin],
  );

  const disconnect = useCallback(() => {
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    manualDisconnectRef.current = true;
    autoRetryRef.current = 0;
    void (async () => {
      await peerRef.current?.stop();
      peerRef.current = null;
      activePairIdRef.current = null;
      setStatus('idle');
      setDetail('');
      setRemoteStream(null);
      setSessionName('');
      setView('dashboard');
    })();
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      everConnectedRef.current = true;
    }
  }, [status]);

  const lostConnection =
    (status === 'ended' || status === 'error') && everConnectedRef.current;

  const remoteActive = remoteStream && status === 'connected' && hovering;
  const cursorBox = remoteActive && remoteCursor ? toClientPoint(remoteCursor.x, remoteCursor.y) : null;

  const handleConnectPair = useCallback(
    (pair: SavedPair) => {
      connect(pair.id, '', pair.secret, pair.name);
    },
    [connect],
  );

  useEffect(() => {
    const args = window.isis;
    void (async () => {
      if (args?.code) {
        setCode(args.code);
        if (args.pin) {
          setPin(args.pin);
        }
        connect(args.code, args.pin);
      } else if (args?.pair) {
        connect(args.pair.id, '', args.pair.secret, args.pair.id);
      }
    })();
    return () => {
      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      void peerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSavePair = useCallback(() => {
    const id = normalizeKey(newId);
    const secret = normalizeKey(newSecret);
    const name = newName.trim() || id;
    if (!id || !secret) {
      setDetail('Completá ID del equipo y secreto.');
      return;
    }
    void window.isis
      ?.savePair({ id, secret, name, createdAt: Date.now() })
      .then(setPairs)
      .then(() => {
        setShowAdd(false);
        setNewName('');
        setNewId('');
        setNewSecret('');
        setDetail(`Equipo "${name}" guardado`);
        void window.isis?.getPairs().then(setPairs);
      });
  }, [newId, newSecret, newName]);

  const handleRemovePair = useCallback(
    (id: string) => {
      void window.isis?.removePair(id).then(setPairs);
    },
    [],
  );

  const formatLastConnected = (ts?: number): string => {
    if (!ts) {
      return 'Nunca conectado';
    }
    return `Última conexión: ${new Date(ts).toLocaleString()}`;
  };

  const dashboard = (
    <div className="app dashboard">
      <header className="dash-header">
        <h1>IsisAnubis Client</h1>
        <p className="muted">Tus equipos remotos</p>
      </header>

      {pairs.length === 0 && !showAdd && (
        <p className="muted">
          Todavía no tenés equipos emparejados. Agregá uno con el ID y secreto que muestra el host
          en su panel "Emparejado".
        </p>
      )}

      <div className="pairs-grid">
        {pairs.map((pair) => (
          <div
            className="pair-card clickable"
            key={pair.id}
            role="button"
            tabIndex={0}
            onClick={() => handleConnectPair(pair)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleConnectPair(pair);
              }
            }}
          >
            <div className="pair-card-info">
              <span className="pair-card-name">{pair.name}</span>
              <span className="pair-card-id">{pair.id}</span>
              <span className="pair-card-last muted">{formatLastConnected(pair.lastConnectedAt)}</span>
            </div>
            <span className="pair-card-arrow" aria-hidden="true">
              ▶
            </span>
            <button
              type="button"
              className="btn ghost remove"
              onClick={(e) => {
                e.stopPropagation();
                handleRemovePair(pair.id);
              }}
              title="Quitar equipo"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="form">
          <label className="field">
            <span>Nombre del equipo</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="p. ej. PC de escritorio"
            />
          </label>
          <label className="field">
            <span>ID del equipo (del panel del host)</span>
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="8 caracteres"
            />
          </label>
          <label className="field">
            <span>Secreto (del panel del host)</span>
            <input
              type="password"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="8 caracteres"
            />
          </label>
          <div className="actions">
            <button type="button" className="btn primary" onClick={handleSavePair}>
              Guardar equipo
            </button>
            <button type="button" className="btn" onClick={() => setShowAdd(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!showAdd && (
        <button type="button" className="btn primary add-pair" onClick={() => setShowAdd(true)}>
          + Añadir equipo
        </button>
      )}

      <p className="pill dashboard-pill">
        {STATUS_TOOLTIP[status]}
        {detail && ` — ${detail}`}
      </p>

      <FirestoreStatus />
    </div>
  );

  const session = (
    <div className="app session">
      <header className="session-bar">
        <span className="session-name">{sessionName}</span>
        <span className={`pill ${status}`}>
          {STATUS_TOOLTIP[status]}
          {detail && ` — ${detail}`}
        </span>
        {status === 'connected' && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              lastInputResetAtRef.current = Date.now();
              console.log('[client] reiniciar input remoto (manual)');
              send({ kind: 'control', payload: { kind: 'inputReset' } });
            }}
            title="Si el mouse remoto se queda congelado: libera botones y reinicia la cola de input del host"
          >
            Reiniciar input
          </button>
        )}
        <button type="button" className="btn" onClick={disconnect}>
          ← Volver
        </button>
      </header>

      {freezeHint && <p className="pill warn session-hint">{freezeHint}</p>}

      <div
        ref={containerRef}
        className={`video-container ${remoteActive ? 'remote-active' : ''}`}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => {
          setHovering(false);
          setRemoteCursor(null);
          releaseAllMouseButtons();
        }}
      >
        {remoteStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="remote-video"
            tabIndex={-1}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const track = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
              console.log(
                `[client] video_ready w=${v.videoWidth} h=${v.videoHeight} srcW=${track?.getSettings().width ?? '?'}`,
              );
            }}
          />
        ) : (
          <div className="no-video">
            {status === 'connected'
              ? 'Sin señal de video'
              : 'El video de la máquina remota aparecerá aquí'}
          </div>
        )}

        {cursorBox && (
          <div
            className="remote-cursor"
            style={{ left: cursorBox.left, top: cursorBox.top }}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path
                d="M3 1l7.5 18 3-7 7-3L3 1z"
                fill="#fff"
                stroke="#111"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}

        {remoteStream && (
          <button
            type="button"
            className="fs-toggle"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Salir de pantalla completa (F11)' : 'Pantalla completa (F11)'}
          >
            {fullscreen ? '⤢ Salir' : '⤢ Pantalla completa'}
          </button>
        )}

        {lostConnection && (
          <div className="lost-overlay">
            <p>Se perdió la conexión con la máquina remota.</p>
            <div className="lost-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  autoRetryRef.current = 0;
                  if (autoRetryTimerRef.current !== null) {
                    window.clearTimeout(autoRetryTimerRef.current);
                    autoRetryTimerRef.current = null;
                  }
                  const pair = activePairIdRef.current
                    ? pairs.find((x) => x.id === activePairIdRef.current)
                    : undefined;
                  if (pair) {
                    handleConnectPair(pair);
                  } else {
                    connect();
                  }
                }}
              >
                Reconectar
              </button>
              <button type="button" className="btn" onClick={disconnect}>
                Volver al inicio
              </button>
            </div>
          </div>
        )}

        {stats && status === 'connected' && (
          <p className="muted quality">
            Calidad: RTT {stats.rtt !== undefined ? `${stats.rtt.toFixed(0)} ms` : '—'} ·{' '}
            {stats.mbps !== undefined ? `${stats.mbps.toFixed(1)} Mbps` : '—'} ·{' '}
            {stats.frames ?? 0} fps
          </p>
        )}
      </div>

      <FirestoreStatus />
    </div>
  );

  return view === 'session' ? session : dashboard;
};

export default App;