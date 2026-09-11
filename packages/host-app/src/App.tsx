import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FirestoreStatus,
  APP_VERSION,
  generateSessionCode,
  getFirebaseDb,
  HostPeer,
  type DataChannelMessage,
  type PeerStatus,
} from '@isisanubis/shared';
import type { HostConfigView } from './global';

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
  pair_token_invalid: 'El secreto de emparejamiento es incorrecto. Revisa el equipo en el cliente.',
  pair_token_missing: 'El cliente no envió su credencial de emparejamiento.',
  rejected: 'Conexión rechazada.',
};

type ScreenMode = 'off' | 'real' | 'simulated';
type Mode = 'paired' | 'manual';

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
  const pairedAvailable = Boolean(
    window.isis?.hostId && window.isis?.pairSecret && !window.isis?.manual,
  );
  const [mode, setMode] = useState<Mode>(pairedAvailable ? 'paired' : 'manual');
  const [config, setConfig] = useState<HostConfigView | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [deviceName, setDeviceName] = useState('Mi equipo');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<PeerStatus>('idle');
  const [detail, setDetail] = useState('');
  const [screenMode, setScreenMode] = useState<ScreenMode>('off');
  const [audioMode, setAudioMode] = useState<'off' | 'simulated' | 'loopback'>('off');
  const [captureMode, setCaptureMode] = useState<'legacy' | 'getDisplayMedia' | null>(null);
  const [captureError, setCaptureError] = useState('');
  const [restartKey, setRestartKey] = useState(0);
  const [autostart, setAutostart] = useState(false);

  const peerRef = useRef<HostPeer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const deviceNameRef = useRef(deviceName);
  const lastClipboardRef = useRef<string | null>(null);
  const restartTimerRef = useRef<number | undefined>(undefined);
  const channelOpenRef = useRef(false);
  const lastSentCursorRef = useRef<{ x: number; y: number } | null>(null);
  const displayInfoRef = useRef<{ width: number; height: number } | null>(null);

  deviceNameRef.current = deviceName;

  const stopScreen = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScreenMode('off');
    setAudioMode('off');
  }, []);

  /**
   * Agrega el audio de escritorio (loopback) del host al stream, SOLO Windows.
   * Se pide en una llamada getDisplayMedia separada (audio únicamente) para no
   * reintroducir la fragilidad del video: pedir video+audio del escritorio en
   * una misma getUserMedia rompe la captura de video en Windows.
   *
   * Está gateado por --isis-desktop-audio / config desktopAudio (OFF por default):
   * en algunos Windows abrir esta segunda captura degrada el renderer y rompe
   * el input (mouse/clics). La captura de pantalla verifica entonces que el flag
   * haya llegado al renderer.
   */
  const addDesktopAudio = useCallback(async (stream: MediaStream): Promise<void> => {
    const platform = window.isis?.platform ?? 'darwin';
    if (
      platform !== 'win32' ||
      window.isis?.simulateVideo ||
      window.isis?.desktopAudio !== true
    ) {
      if (platform === 'win32' && !window.isis?.simulateVideo) {
        console.log('[host] stream_audio=off (loopback desactivado; actívalo en el panel)');
      }
      return;
    }
    try {
      const audioStream = (await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: false,
      } as MediaStreamConstraints)) as MediaStream;
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length === 0) {
        audioStream.getTracks().forEach((t) => t.stop());
        setAudioMode('off');
        return;
      }
      audioTracks.forEach((t) => stream.addTrack(t));
      setAudioMode('loopback');
      console.log(`[host] stream_audio=loopback tracks=${audioTracks.length}`);
    } catch (err) {
      console.warn('[host] audio loopback fallida; sin audio:', err);
      setAudioMode('off');
    }
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
        const result = await captureScreenStream();
        if (!result) {
          console.error('[host] screen capture failed (los dos métodos de captura)');
          setScreenMode('off');
          setCaptureError('Captura de pantalla fallida; revisa el log.');
          return null;
        }
        if (result.stream === null) {
          console.error(`[host] screen capture failed: ${result.error}`);
          setScreenMode('off');
          setCaptureError(`No se pudo capturar la pantalla: ${result.error}`);
          return null;
        }
        const videoCount = result.stream.getVideoTracks().length;
        if (videoCount === 0) {
          console.error(
            `[host] captura sin video tracks (audio=${result.stream.getAudioTracks().length}); abortando`,
          );
          result.stream.getTracks().forEach((t) => t.stop());
          setScreenMode('off');
          setCaptureError('La captura no devolvió pistas de video.');
          return null;
        }
        stream = result.stream;
        setCaptureMode(result.mode);
        setCaptureError('');
        setScreenMode('real');
      }

      if (window.isis?.simulateAudio) {
        const audioTrack = await createSyntheticAudioTrack();
        stream.addTrack(audioTrack);
        setAudioMode('simulated');
        console.log('[host] stream_audio=simulated');
      } else if (window.isis?.simulateVideo) {
        console.log('[host] stream_audio=off');
      } else {
        await addDesktopAudio(stream);
        console.log(
          `[host] stream_audio_final=${stream.getAudioTracks().length > 0 ? 'yes' : 'off'}`,
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

  /**
   * Captura la pantalla real (Windows/macOS/Linux).
   *
   * Preferimos getDisplayMedia porque Electron puede resolverlo desde main sin
   * depender del picker ni del foco de la ventana oculta. Dejamos el camino
   * legacy como fallback para versiones de Windows/Electron que lo requieran.
   */
  const captureScreenStream = useCallback(
    async ():
      Promise<
        | { stream: MediaStream; mode: 'legacy' | 'getDisplayMedia' }
        | { stream: null; error: string }
      > => {
    const platform = window.isis?.platform ?? 'darwin';
    const forceGdm = window.isis?.forceGetDisplayMedia === true;
    try {
      const stream = (await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { frameRate: { max: 30 } },
      } as MediaStreamConstraints)) as MediaStream;
      console.log(
        `[host] capture_result video=${stream.getVideoTracks().length} audio=${stream.getAudioTracks().length} mode=getDisplayMedia`,
      );
      return { stream, mode: 'getDisplayMedia' };
    } catch (errGdm) {
      if (forceGdm) {
        const error = errGdm instanceof Error ? errGdm.message : String(errGdm);
        console.error('[host] getDisplayMedia fallida (modo forzado):', errGdm);
        return { stream: null, error };
      }
      console.warn('[host] getDisplayMedia fallida; probando captura legacy:', errGdm);
    }
    try {
      const sourceId = await window.isis!.getScreenSourceId();
      const chromeSource = platform === 'darwin' ? 'screen' : 'desktop';
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: chromeSource,
            chromeMediaSourceId: sourceId,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        },
      } as unknown as MediaStreamConstraints;
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log(
        `[host] capture_result video=${stream.getVideoTracks().length} audio=${stream.getAudioTracks().length} mode=legacy`,
      );
      return { stream, mode: 'legacy' };
    } catch (errLegacy) {
      const error = errLegacy instanceof Error ? errLegacy.message : String(errLegacy);
      console.error('[host] captura de pantalla fallida en ambos modos:', errLegacy);
      return { stream: null, error };
    }
  }, []);

  const statusMessage = useCallback((s: PeerStatus, d?: string) => {
    console.log(`[host] status=${s}${d ? ` detail=${d}` : ''}`);
    setStatus(s);
    setDetail(d ? (ERROR_DETAIL[d] ?? d) : '');
    window.isis?.setTrayStatus(
      `${STATUS_TOOLTIP[s]}${d ? ` — ${ERROR_DETAIL[d] ?? d}` : ''}`,
    );
    if (s === 'connected') {
      console.log(`[host] CONNECTED`);
    }
  }, []);

  const handleData = useCallback((msg: DataChannelMessage, peer?: HostPeer) => {
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
        void (peer ?? peerRef.current)?.stop();
      } else if (msg.payload.kind === 'inputReset') {
        // Recuperación explícita solicitada por el operador: liberar botones,
        // despejar la cola y cerrar con Escape un menú que esté capturando input.
        console.log('[host] input_reset solicitado por el cliente');
        window.isis?.inputPanic();
      }
    }
  }, []);

  const onChannelState = useCallback((open: boolean) => {
    console.log(`[host] channel_state=${open ? 'open' : 'closed'}`);
    channelOpenRef.current = open;
    // Solo liberar al cerrar. Reiniciar el worker justo al abrir el canal crea
    // una carrera con el primer movimiento/clic del cliente y puede alterar
    // menús del sistema que todavía están abiertos.
    if (!open) {
      window.isis?.releaseInputButtons();
    }
    if (open && displayInfoRef.current) {
      const { width, height } = displayInfoRef.current;
      peerRef.current?.send({ kind: 'display', payload: { width, height } });
    }
  }, []);

  // El host difunde su cursor y la resolución real del escritorio para que el
  // cliente dibuje el overlay (comportamiento tipo Chrome Remote Desktop).
  useEffect(() => {
    window.isis?.watchCursor(true);
    const unsub = window.isis?.onCursorEvent(({ x, y, width, height }) => {
      if (
        !displayInfoRef.current ||
        displayInfoRef.current.width !== width ||
        displayInfoRef.current.height !== height
      ) {
        displayInfoRef.current = { width, height };
        if (channelOpenRef.current) {
          peerRef.current?.send({ kind: 'display', payload: { width, height } });
        }
      }
      if (!channelOpenRef.current) {
        return;
      }
      const last = lastSentCursorRef.current;
      if (!last || last.x !== x || last.y !== y) {
        lastSentCursorRef.current = { x, y };
        if (!last) {
          console.log(`[host] cursor_stream_inicio ${x},${y}`);
        }
        peerRef.current?.send({ kind: 'cursor', payload: { x, y } });
      }
    });
    // Heartbeat del cursor: reenvía la última posición aunque NO cambie, para que
    // el cliente distinga "cursor quieto pero canal vivo" de "canal muerto". Sin
    // esto, cuando el menú de la bandeja se traga el input y el cursor no se
    // mueve, el cliente no ve NINGÚN mensaje de cursor y dispara inputReset.
    const heartbeat = window.setInterval(() => {
      if (channelOpenRef.current && lastSentCursorRef.current) {
        peerRef.current?.send({ kind: 'cursor', payload: lastSentCursorRef.current });
      }
    }, 400);
    return () => {
      window.clearInterval(heartbeat);
      unsub?.();
      window.isis?.watchCursor(false);
    };
  }, []);

  // --- Modo manual (sesión temporal por código, flujo previo) --------------

  const startManual = useCallback(
    (nameArg?: string, pinArg?: string) => {
      const name = (nameArg ?? 'Mi equipo').trim() || 'Mi equipo';
      const p = pinArg ?? '';
      void (async () => {
        if (peerRef.current) {
          await peerRef.current.stop();
          peerRef.current = null;
        }
        const newCode = window.isis?.code || generateSessionCode();
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
          onStatus: (s, d) => statusMessage(s, d),
          onData: (m) => handleData(m, peer),
          onChannelState,
        });
        peerRef.current = peer;
        await peer.start();
        console.log(`[host] manual_session_ready code=${newCode}`);
      })();
    },
    [getScreenStream, statusMessage, handleData, onChannelState],
  );

  useEffect(() => {
    if (mode !== 'manual') {
      return;
    }
    void startManual('Mi equipo', window.isis?.pin ?? '');
    return () => {
      stopScreen();
      void peerRef.current?.stop();
      peerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --- Modo emparejado (servicio): escucha persistente ----------------------

  useEffect(() => {
    if (mode !== 'paired' || !pairedAvailable) {
      return;
    }
    const hostId = window.isis!.hostId!;
    const secret = window.isis!.pairSecret!;
    let cancelled = false;
    window.clearTimeout(restartTimerRef.current);

    const run = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      if (peerRef.current) {
        await peerRef.current.stop();
        peerRef.current = null;
      }
      const peer = new HostPeer({
        db: getFirebaseDb(),
        code: hostId,
        secret,
        deviceName: deviceNameRef.current,
        getScreenStream,
        onStatus: (s, d) => {
          statusMessage(s, d);
          if ((s === 'ended' || s === 'error') && !cancelled) {
            void peer.stop();
            if (s === 'error') {
              console.log('[host] error escuchando, reintentando en 2 s…');
            }
            restartTimerRef.current = window.setTimeout(() => {
              if (!cancelled) {
                setRestartKey((k) => k + 1);
              }
            }, s === 'error' ? 2000 : 1500);
          }
        },
        onData: (m) => handleData(m, peer),
        onChannelState,
      });
      peerRef.current = peer;
      await peer.start();
      console.log(`[host] listening hostId=${hostId}`);
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(restartTimerRef.current);
      void peerRef.current?.stop();
      peerRef.current = null;
      stopScreen();
    };
  }, [mode, restartKey, pairedAvailable, getScreenStream, statusMessage, handleData, onChannelState, stopScreen]);

  // --- Diagnóstico: `--isis-capture-test` captura al arrancar y loguea ------

  useEffect(() => {
    if (!window.isis?.captureTest) {
      return;
    }
    let cancelled = false;
    void (async () => {
      console.log('[host] capture_test: probando captura de pantalla…');
      const stream = await getScreenStream();
      if (cancelled || !stream) {
        console.log('[host] capture_test: resultado FALLO');
        return;
      }
      console.log(
        `[host] capture_test OK video=${stream.getVideoTracks().length} audio=${stream.getAudioTracks().length}`,
      );
      setTimeout(() => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setScreenMode('off');
        console.log('[host] capture_test: stream liberado');
      }, 2000);
    })();
    return () => {
      cancelled = true;
      stopScreen();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Config inicial (panel emparejado) ------------------------------------

  useEffect(() => {
    void (async () => {
      const cfg = await window.isis?.getConfig();
      if (cfg) {
        setConfig(cfg);
        setDeviceName(cfg.deviceName);
      }
      const auto = await window.isis?.getAutostart();
      if (auto !== undefined) {
        setAutostart(auto);
      } else if (cfg) {
        setAutostart(cfg.autostart);
      }
    })();
  }, []);

  // Acción desde la bandeja: "Desconectar sesión".
  useEffect(() => {
    return window.isis?.onControl((cmd) => {
      if (cmd === 'requestDisconnect') {
        void peerRef.current?.stop();
      }
    });
  }, []);

  // --- Portapapeles (sincronización host → cliente) -------------------------

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

  const stopSession = useCallback(() => {
    void (async () => {
      await peerRef.current?.stop();
      peerRef.current = null;
      stopScreen();
      setDetail('');
      if (mode === 'manual') {
        setStatus('idle');
        setCode('');
      }
    })();
  }, [mode, stopScreen]);

  const copyText = useCallback((text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setDetail('Copiado al portapapeles'))
      .catch(() => setDetail('No se pudo copiar automáticamente'));
  }, []);

  const toggleAutostart = useCallback(() => {
    void (async () => {
      const next = !autostart;
      setAutostart(next);
      const applied = await window.isis?.setAutostart(next);
      if (!applied) {
        setAutostart(!next);
        return;
      }
      if (applied.ok) {
        setDetail(next ? 'Inicio elevado con Windows activado' : 'Inicio elevado con Windows desactivado');
      } else {
        setAutostart(!next);
        setDetail(
          `No se pudo ${next ? 'activar' : 'desactivar'} el inicio con Windows: ejecuta el host como administrador y vuelve a intentarlo (${applied.error ?? 'error'})`,
        );
      }
    })();
  }, [autostart]);

  const regeneratePairing = useCallback(() => {
    if (!window.confirm('¿Regenerar el emparejamiento? Los equipos guardados con el código actual dejarán de conectar.')) {
      return;
    }
    void (async () => {
      const next = await window.isis?.regeneratePairing();
      if (!next) {
        return;
      }
      setConfig((prev) =>
        prev ? { ...prev, hostId: next.hostId, secret: next.secret } : prev,
      );
      setSecretVisible(false);
      setDetail('Nuevo emparejamiento generado. Pasalo al cliente una sola vez.');
    })();
  }, []);

  const toggleService = useCallback(() => {
    void (async () => {
      const cfg = await window.isis?.getConfig();
      const next = !(config?.service ?? cfg?.service ?? false);
      await window.isis?.setConfig({ service: next });
      setConfig((prev) => (prev ? { ...prev, service: next } : prev));
      setDetail(next ? 'Modo servicio activado (se aplicará en el próximo arranque)' : 'Modo servicio desactivado');
    })();
  }, [config]);

  const busy = status === 'creating' || status === 'looking_up' || status === 'signaling' || status === 'connecting';

  return (
    <div className="app">
      <span className="build-version">v{APP_VERSION}</span>
      <h1>IsisAnubis Host</h1>
      <p className="muted">Equipo controlado (Windows).</p>

      {pairedAvailable && (
        <div className="mode-tabs">
          <button
            type="button"
            className={`mode-tab ${mode === 'paired' ? 'active' : ''}`}
            onClick={() => setMode('paired')}
          >
            Emparejado
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => setMode('manual')}
          >
            Código
          </button>
        </div>
      )}

      {mode === 'paired' && config && (
        <>
          <div className="form">
            <label className="field">
              <span>Nombre del equipo</span>
              <input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="Mi equipo"
              />
            </label>
          </div>

          <div className="pairing-block">
            <p className="muted">Este equipo queda conectable desde el cliente con:</p>
            <div className="pairing-row">
              <span>ID del equipo</span>
              <button type="button" className="pairing-key" onClick={() => copyText(config.hostId)} title="Copiar ID">
                {config.hostId}
              </button>
            </div>
            <div className="pairing-row">
              <span>Secreto</span>
              <button
                type="button"
                className="pairing-key"
                onClick={() => copyText(config.secret)}
                title="Copiar secreto"
              >
                {secretVisible ? config.secret : '••••••••'}
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => setSecretVisible((v) => !v)}
                title={secretVisible ? 'Ocultar' : 'Mostrar'}
              >
                {secretVisible ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <p className="muted">Entrega estos datos al cliente UNA sola vez en "Añadir equipo".</p>
          </div>

          <div className="actions column">
            <button type="button" className="btn primary" onClick={() => copyText(`${config.hostId} ${config.secret}`)}>
              Copiar ID y secreto
            </button>
            <button type="button" className="btn" onClick={regeneratePairing}>
              Regenerar emparejamiento
            </button>
            <label className="row-toggle">
              <input type="checkbox" checked={autostart} onChange={toggleAutostart} />
              <span>Iniciar automáticamente con la PC</span>
            </label>
            <label className="row-toggle">
              <input type="checkbox" checked={config.service} onChange={toggleService} />
              <span>Modo servicio (sin ventana)</span>
            </label>
            <div className="actions">
              <button type="button" className="btn" onClick={() => window.isis?.hideWindow()}>
                Ocultar ventana
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={stopSession}
                title="Desconectar al cliente actual (el host sigue escuchando)"
              >
                Desconectar cliente
              </button>
            </div>
          </div>
        </>
      )}

      {mode === 'manual' && (
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
            <button type="button" className="btn primary" onClick={() => void startManual(deviceName, pin)}>
              Renovar sesión
            </button>
            {code && (
              <button type="button" className="btn danger" onClick={stopSession}>
                Detener sesión
              </button>
            )}
          </div>
        </div>
      )}

      {mode === 'manual' && code && (
        <div className="code-block">
          <button type="button" className="session-code" onClick={() => copyText(code)} title="Copiar código">
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
          ? `Trasmitiendo pantalla real (${captureMode ?? '?'})`
          : screenMode === 'simulated'
            ? 'Trasmitiendo video sintético (prueba)'
            : captureError
              ? `Pantalla: ${captureError}`
              : 'Pantalla: sin transmitir (esperando cliente)'}
      </p>

      <p className="muted">
        Input:{' '}
        {window.isis?.fakeInput
          ? 'simulado (sin inyectar)'
          : window.isis?.platform === 'win32'
            ? 'helper elevado separado'
            : 'inyección real'}
      </p>

      <p className="muted">
        Audio:{' '}
        {audioMode === 'simulated'
          ? 'tono sintético (prueba)'
          : audioMode === 'loopback'
            ? 'escritorio (loopback)'
            : 'no transmitido'}
      </p>

      {window.isis?.platform === 'win32' && !window.isis?.simulateVideo && (
        <label className="field checkbox">
          <span>Audio de escritorio (loopback)</span>
          <input
            type="checkbox"
            checked={config?.desktopAudio ?? false}
            onChange={(e) => {
              window.isis
                ?.setConfig({ desktopAudio: e.target.checked })
                .then(() => window.isis?.getConfig().then(setConfig));
            }}
          />
        </label>
      )}

      <FirestoreStatus />
    </div>
  );
};

export default App;
