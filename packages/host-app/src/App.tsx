import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FirestoreStatus,
  generateSessionCode,
  getFirebaseDb,
  HostPeer,
  type PeerStatus,
} from '@isisanubis/shared';

const STATUS_TOOLTIP: Record<PeerStatus, string> = {
  idle: 'En reposo',
  creating: 'Creando sesión…',
  waiting: 'Esperando cliente…',
  looking_up: 'Buscando…',
  signaling: 'Negociando conexión…',
  connecting: 'Conectando…',
  connected: 'Cliente conectado',
  ended: 'Sesión cerrada',
  error: 'Error',
};

const ERROR_DETAIL: Record<string, string> = {
  answer_failed: 'No se pudo generar la respuesta de conexión.',
  connection_failed: 'Se perdió la conexión con el cliente.',
  expired: 'Se agotó el tiempo de espera.',
  screen_permission: 'Permiso de grabación de pantalla denegado.',
};

type ScreenMode = 'off' | 'real' | 'simulated';

/** Fuente de video sintética (canvas animado) para pruebas sin permiso. */
function createSyntheticStream(): MediaStream {
  const width = 640;
  const height = 360;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no se pudo crear el canvas de prueba');
  }

  const draw = (frame: number): void => {
    const hue = (frame * 4 + 160) % 360;
    ctx.fillStyle = `hsl(${hue}, 70%, 40%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '42px monospace';
    ctx.fillText(`isis ${frame}`, 42, 72);
    ctx.font = '20px monospace';
    ctx.fillStyle = '#fff8';
    ctx.fillText('fuente sintetica de prueba', 42, 110);
  };

  draw(0);
  const stream = canvas.captureStream(15);
  let frame = 0;
  const timer = window.setInterval(() => {
    frame += 1;
    draw(frame);
  }, 1000 / 15);
  stream.getVideoTracks()[0].addEventListener('ended', () => window.clearInterval(timer));
  return stream;
}

/** Fuente de audio sintética (tono de 440 Hz) para probar el pipeline sin micrófono. */
function createSyntheticAudioTrack(): Promise<MediaStreamTrack> {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  osc.type = 'sine';
  const dest = ctx.createMediaStreamDestination();
  osc.connect(dest);
  void osc.start();
  const track = dest.stream.getAudioTracks()[0];
  track.addEventListener('ended', () => {
    void osc.stop();
    void ctx.close();
  });
  return Promise.resolve(track);
}

const App: React.FC = () => {
  const [deviceName, setDeviceName] = useState('Mi equipo');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<PeerStatus>('idle');
  const [detail, setDetail] = useState('');
  const [screenMode, setScreenMode] = useState<ScreenMode>('off');
  const peerRef = useRef<HostPeer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /** Último valor del portapapeles local aplicado (evita ecos al sincronizar). */
  const lastClipboardRef = useRef<string | null>(null);

  /** Sincroniza el portapapeles del host → cliente mientras haya sesión.
   *  Polling del portapapeles del sistema cada 700 ms; si cambió, se propaga.
   *  Al conectar se siembra el valor actual para no reenviar contenido previo. */
  useEffect(() => {
    if (status !== 'connected') {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      const initial = await window.isis?.readClipboard();
      console.log(`[host] clipboard_seed len=${initial === undefined ? 'undefined' : initial.length}`);
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
          peerRef.current?.send({ kind: 'clipboard', payload: { text } });
          console.log(`[host] clipboard_sent len=${text.length}`);
        } catch (err) {
          console.error('[host] clipboard poll error:', err);
        }
      }, 700);
    })();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [status]);

  const stopScreen = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScreenMode('off');
  }, []);

  const getScreenStream = useCallback(async (): Promise<MediaStream | null> => {
    await stopScreen();
    try {
      let stream: MediaStream;
      if (window.isis?.simulateVideo) {
        stream = createSyntheticStream();
        setScreenMode('simulated');
        console.log('[host] screen_mode=simulated');
      } else {
        const sourceId = await window.isis!.getScreenSourceId();
        const constraints = {
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 30,
            },
          },
        } as unknown as MediaStreamConstraints;
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        setScreenMode('real');
        console.log('[host] screen_mode=real');
      }

      if (window.isis?.simulateAudio) {
        const audioTrack = await createSyntheticAudioTrack();
        stream.addTrack(audioTrack);
        console.log('[host] stream_audio=simulated');
      } else {
        console.log(
          `[host] stream_audio=${stream.getAudioTracks().length > 0 ? 'real' : 'off'}`,
        );
      }

      streamRef.current = stream;
      return stream;
    } catch (err) {
      console.error('[host] screen capture failed:', err);
      setScreenMode('off');
      return null;
    }
  }, [stopScreen]);

  const start = useCallback(
    (nameArg?: string, pinArg?: string) => {
      const name = (nameArg ?? 'Mi equipo').trim() || 'Mi equipo';
      const p = pinArg ?? '';
      void (async () => {
        if (peerRef.current) {
          await peerRef.current.stop();
          peerRef.current = null;
        }
        const newCode = generateSessionCode();
        setCode(newCode);
        const ttlSec = window.isis?.sessionTtl;
        const ttlMs =
          ttlSec !== undefined && ttlSec > 0
            ? ttlSec * 1000
            : 10 * 60 * 1000;
        const peer = new HostPeer({
          db: getFirebaseDb(),
          code: newCode,
          deviceName: name,
          pin: p || undefined,
          waitTimeoutMs: ttlMs,
          getScreenStream,
          onStatus: (s, d) => {
            console.log(`[host] status=${s}${d ? ` detail=${d}` : ''}`);
            setStatus(s);
            setDetail(d ? (ERROR_DETAIL[d] ?? d) : '');
            if (s === 'connected') {
              console.log(`[host] CONNECTED code=${newCode}`);
            }
          },
          onData: (msg) => {
            if (msg.kind === 'hello') {
              console.log(`[host] peer_hello device=${msg.payload.deviceName}`);
              setDetail(`Cliente remoto: ${msg.payload.deviceName}`);
            } else if (msg.kind === 'mouse' || msg.kind === 'key') {
              window.isis?.sendInput(msg);
            } else if (msg.kind === 'clipboard') {
              void window.isis?.writeClipboard(msg.payload.text);
              lastClipboardRef.current = msg.payload.text;
              console.log(`[host] clipboard_recv (cliente) len=${msg.payload.text.length}`);
            } else if (msg.kind === 'control') {
              console.log(`[host] control ${msg.payload.kind}`);
              if (msg.payload.kind === 'requestDisconnect') {
                void peerRef.current?.stop();
              }
            }
          },
          onChannelState: (open) => {
            console.log(`[host] channel_state=${open ? 'open' : 'closed'}`);
          },
        });
        peerRef.current = peer;
        await peer.start();
        console.log(`[host] session_ready code=${newCode}`);
      })();
    },
    [getScreenStream],
  );

  useEffect(() => {
    const args = window.isis;
    void start('Mi equipo', args?.pin ?? '');
    return () => {
      stopScreen();
      void peerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const stopSession = useCallback(() => {
    void (async () => {
      await peerRef.current?.stop();
      peerRef.current = null;
      stopScreen();
      setStatus('idle');
      setDetail('');
      setCode('');
    })();
  }, [stopScreen]);

  const copyCode = useCallback(() => {
    const text = code;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setDetail('Código copiado'))
      .catch(() => setDetail('No se pudo copiar automáticamente'));
  }, [code]);

  return (
    <div className="app">
      <h1>IsisAnubis Host</h1>
      <p className="muted">Equipo controlado (Windows).</p>

      <div className="form">
        <label className="field">
          <span>Nombre del equipo</span>
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="Mi equipo"
          />
        </label>
        <label className="field">
          <span>PIN (opcional)</span>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Sin PIN"
          />
        </label>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => void start(deviceName, pin)}>
            Renovar sesión
          </button>
          {code && (
            <button type="button" className="btn danger" onClick={stopSession}>
              Detener sesión
            </button>
          )}
        </div>
      </div>

      {code && (
        <div className="code-block">
          <button type="button" className="session-code" onClick={copyCode} title="Copiar código">
            {code}
          </button>
          <p className="muted">Entregá este código al cliente (clic para copiar)</p>
          <p className="muted">
            TTL:{' '}
            {window.isis?.sessionTtl && window.isis.sessionTtl > 0
              ? `${window.isis.sessionTtl} s`
              : '10 min'}
          </p>
        </div>
      )}

      <p className={`pill ${status}`}>
        {STATUS_TOOLTIP[status]}
        {detail && ` — ${detail}`}
      </p>

      <p className="muted">
        {screenMode === 'real'
          ? 'Trasmitiendo pantalla real'
          : screenMode === 'simulated'
            ? 'Trasmitiendo video sintético (prueba)'
            : 'Pantalla: sin transmitir (esperando cliente)'}
      </p>

      <p className="muted">
        Input: {window.isis?.fakeInput ? 'simulado (sin inyectar)' : 'inyección real'}
      </p>

      <p className="muted">
        Audio: {window.isis?.simulateAudio ? 'tono sintético (prueba)' : 'audio del sistema'}
      </p>

      <FirestoreStatus />
    </div>
  );
};

export default App;