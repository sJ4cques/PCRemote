import React, { useEffect, useRef, useState } from 'react';

interface SignalMessage {
  type?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

/**
 * Ventana separada (BrowserWindow) que muestra la cámara de la tablet.
 *
 * Recibe el `MediaStream` por un relay WebRTC loopback: esta ventana es el
 * **respondedor**; la ventana principal de la app es el oferente. La
 * señalización viaja por IPC (el proceso main solo reenvía mensajes), porque un
 * `MediaStream` no se puede compartir directamente entre procesos.
 */
const CameraWindow: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingRef = useRef<RTCIceCandidateInit[]>([]);
  const [status, setStatus] = useState('Conectando…');

  useEffect(() => {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream && videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        window.isis?.cameraSend({ type: 'ice', candidate: ev.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('');
      } else if (pc.connectionState === 'failed') {
        setStatus('Se perdió la conexión');
      } else if (pc.connectionState !== 'closed') {
        setStatus('Conectando…');
      }
    };

    async function handleSignal(msg: SignalMessage): Promise<void> {
      if (msg?.type === 'offer' && typeof msg.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        for (const candidate of pendingRef.current) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            // candidato obsoleto: se ignora
          }
        }
        pendingRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        window.isis?.cameraSend({ type: 'answer', sdp: answer.sdp });
      } else if (msg?.type === 'ice' && msg.candidate) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(msg.candidate);
          } catch {
            // candidato obsoleto: se ignora
          }
        } else {
          pendingRef.current.push(msg.candidate);
        }
      }
    }

    const off = window.isis?.onCameraSignal((data) => {
      void handleSignal(data as SignalMessage);
    });

    // Avisa a la ventana principal que estamos listos para recibir la oferta.
    window.isis?.cameraSend({ type: 'ready' });

    return () => {
      off?.();
      pc.close();
      pcRef.current = null;
    };
  }, []);

  return (
    <div className="camwin">
      <div className="camwin-bar">
        <span className="camwin-title">📷 Cámara de la tablet</span>
        <button
          type="button"
          className="camwin-btn"
          onClick={() => window.isis?.cameraSend({ type: 'switchCamera' })}
          title="Cambiar cámara (frontal/trasera)"
        >
          🔄
        </button>
        <button
          type="button"
          className="camwin-btn"
          onClick={() => void window.isis?.closeCameraWindow()}
          title="Cerrar la cámara"
        >
          ✕
        </button>
      </div>
      <div className="camwin-stage">
        <video ref={videoRef} autoPlay playsInline muted className="camwin-video" />
        {status && <div className="camwin-status">{status}</div>}
      </div>
    </div>
  );
};

export default CameraWindow;
