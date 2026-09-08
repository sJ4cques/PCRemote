import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientPeer,
  FirestoreStatus,
  getFirebaseDb,
  type DataChannelMessage,
  type MouseAction,
  type PeerStatus,
} from '@isisanubis/shared';

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
};

interface StreamStats {
  rtt?: number;
  mbps?: number;
  frames?: number;
}

const App: React.FC = () => {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<PeerStatus>('idle');
  const [detail, setDetail] = useState('');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const peerRef = useRef<ClientPeer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const everConnectedRef = useRef(false);

  /** Último valor del portapapeles local aplicado (evita ecos al sincronizar). */
  const lastClipboardRef = useRef<string | null>(null);

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

  /** Convierte un punto del elemento <video> (incluye letterboxing) a la posición
   *  de pantalla del host según la resolución real del stream. */
  const toHostPoint = useCallback((clientX: number, clientY: number) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const drawW = video.videoWidth * scale;
    const drawH = video.videoHeight * scale;
    const offsetX = (rect.width - drawW) / 2;
    const offsetY = (rect.height - drawH) / 2;
    const x = Math.round((clientX - rect.left - offsetX) / scale);
    const y = Math.round((clientY - rect.top - offsetY) / scale);
    return {
      x: Math.min(Math.max(x, 0), video.videoWidth - 1),
      y: Math.min(Math.max(y, 0), video.videoHeight - 1),
    };
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
      if (p.x === lastMouseRef.current.x && p.y === lastMouseRef.current.y) {
        return;
      }
      lastMouseRef.current = p;
      sendMouse({ type: 'move', x: p.x, y: p.y });
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
      lastMouseRef.current = p;
      const button = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      sendMouse({ type: 'move', x: p.x, y: p.y });
      sendMouse({ type: 'down', button, x: p.x, y: p.y });
      void videoRef.current?.focus();
    },
    [sendMouse, toHostPoint],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      const p = toHostPoint(e.clientX, e.clientY);
      if (!p) {
        return;
      }
      lastMouseRef.current = p;
      const button = (['left', 'middle', 'right'] as const)[e.button] ?? 'left';
      sendMouse({ type: 'move', x: p.x, y: p.y });
      sendMouse({ type: 'up', button, x: p.x, y: p.y });
    },
    [sendMouse, toHostPoint],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLVideoElement>) => {
      e.preventDefault();
      sendMouse({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
    },
    [sendMouse],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      e.preventDefault();
    },
    [],
  );

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

  /** Sincroniza el portapapeles del cliente → host mientras haya sesión.
   *  Polling del portapapeles local cada 700 ms; si cambió, se propaga.
   *  Al conectar se siembra el valor actual para no reenviar contenido previo. */
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
    (codeArg?: string, pinArg?: string) => {
      const c = (codeArg ?? code).trim().toLowerCase();
      const p = pinArg ?? pin;
      if (!c) {
        return;
      }
      void (async () => {
        if (peerRef.current) {
          await peerRef.current.stop();
          peerRef.current = null;
        }
        setRemoteStream(null);
        const peer = new ClientPeer({
          db: getFirebaseDb(),
          code: c,
          deviceName: 'Client',
          pin: p || undefined,
          onStatus: (s, d) => {
            console.log(`[client] status=${s}${d ? ` detail=${d}` : ''}`);
            setStatus(s);
            setDetail(d ? (ERROR_DETAIL[d] ?? d) : '');
            if (s === 'connected') {
              console.log(`[client] CONNECTED code=${c}`);
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
    void (async () => {
      await peerRef.current?.stop();
      peerRef.current = null;
      setStatus('idle');
      setDetail('');
      setRemoteStream(null);
    })();
  }, []);

  useEffect(() => {
    if (status === 'connected') {
      everConnectedRef.current = true;
    }
  }, [status]);

  const lostConnection =
    (status === 'ended' || status === 'error') && everConnectedRef.current;

  useEffect(() => {
    const args = window.isis;
    if (args?.code) {
      setCode(args.code);
      if (args.pin) {
        setPin(args.pin);
      }
      connect(args.code, args.pin);
    }
    return () => {
      void peerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = status === 'looking_up' || status === 'signaling' || status === 'connecting';

  return (
    <div className="app">
      <h1>IsisAnubis Client</h1>
      <p className="muted">Equipo que controla (macOS).</p>

      <div className="video-container">
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
            <button type="button" className="btn primary" onClick={() => connect()}>
              Reconectar
            </button>
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

      <div className="form">
        <label className="field">
          <span>Código de la máquina</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="p. ej. abc234"
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="field">
          <span>PIN (si la máquina lo exige)</span>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Opcional"
            disabled={busy}
          />
        </label>
        <div className="actions">
          {status === 'connected' ? (
            <button type="button" className="btn danger" onClick={disconnect}>
              Desconectar
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => connect()}
              disabled={!code.trim() || busy}
            >
              Conectar
            </button>
          )}
        </div>
      </div>

      <p className={`pill ${status}`}>
        {STATUS_TOOLTIP[status]}
        {detail && ` — ${detail}`}
      </p>

      <FirestoreStatus />
    </div>
  );
};

export default App;