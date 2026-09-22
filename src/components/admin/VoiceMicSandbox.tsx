'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SandboxResponse = { callId: string; sessionId: string; sdp: string };
type Caption = { id: number; text: string };
type SandboxState = 'idle' | 'connecting' | 'connected' | 'stopping' | 'error';

const COPY = {
  en: {
    title: 'Browser mic sandbox',
    body: 'Test the receptionist from this browser. Sandbox calls cannot create appointments, payment links, or client messages.',
    start: 'Start mic test',
    stop: 'End mic test',
    connecting: 'Connecting your mic…',
    connected: 'Listening',
  },
  fr: {
    title: 'Bac à sable microphone',
    body: 'Testez la réceptionniste dans ce navigateur. Les tests ne peuvent pas créer de rendez-vous, de liens de paiement ou de messages clients.',
    start: 'Démarrer le test micro',
    stop: 'Terminer le test micro',
    connecting: 'Connexion du micro…',
    connected: 'À l’écoute',
  },
  es: {
    title: 'Prueba de micrófono',
    body: 'Prueba la recepcionista en este navegador. Las pruebas no pueden crear citas, enlaces de pago ni mensajes para clientes.',
    start: 'Iniciar prueba de micrófono',
    stop: 'Terminar prueba de micrófono',
    connecting: 'Conectando el micrófono…',
    connected: 'Escuchando',
  },
} as const;

const MAX_CAPTIONS = 24;
const ICE_GATHERING_TIMEOUT_MS = 3_000;
const SESSION_START_TIMEOUT_MS = 15_000;

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, ICE_GATHERING_TIMEOUT_MS);
    function done() {
      window.clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }
    function onChange() {
      if (peer.iceGatheringState === 'complete') {
        done();
      }
    }
    peer.addEventListener('icegatheringstatechange', onChange);
  });
}

function eventCaption(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const event = value as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';
  if (!/transcript|caption/i.test(type)) {
    return null;
  }
  const text = [event.transcript, event.text, event.delta].find(item => typeof item === 'string');
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 500) : null;
}

export function VoiceMicSandbox({ salonSlug, locale = 'en' }: { salonSlug: string; locale?: 'en' | 'fr' | 'es' }) {
  const copy = COPY[locale];
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const startedRef = useRef<(() => void) | null>(null);
  const sessionTimeoutRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<SandboxState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  const release = useCallback(async (notifyServer: boolean) => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const callId = callIdRef.current;
    callIdRef.current = null;
    startedRef.current = null;
    if (sessionTimeoutRef.current !== null) {
      window.clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    setCaptions([]);
    setPlaybackBlocked(false);
    if (notifyServer && callId) {
      await fetch(`/api/admin/voice-receptionist/sandbox?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      }).catch(() => undefined);
    }
  }, [salonSlug]);

  const stop = useCallback(async () => {
    setState('stopping');
    await release(true);
    setState('idle');
  }, [release]);

  useEffect(() => () => {
    void release(true);
  }, [release]);

  const start = async () => {
    if (state !== 'idle' && state !== 'error') {
      return;
    }
    setState('connecting');
    setError(null);
    setCaptions([]);
    setPlaybackBlocked(false);
    const generation = ++generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== generationRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const peer = new RTCPeerConnection();
      if (generation !== generationRef.current) {
        peer.close();
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      peerRef.current = peer;
      peer.addEventListener('track', (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        if (!audioRef.current || generation !== generationRef.current) {
          return;
        }
        audioRef.current.srcObject = remoteStream;
        void audioRef.current.play().catch(() => {
          if (generation === generationRef.current) {
            setPlaybackBlocked(true);
          }
        });
      });
      const localStream = streamRef.current;
      if (!localStream) {
        throw new Error('Microphone stream was released before connection. Start a new mic test.');
      }
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
      const channel = peer.createDataChannel('oai-events');
      const sessionStarted = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('The voice session did not start. Try a new mic test.')), SESSION_START_TIMEOUT_MS);
        sessionTimeoutRef.current = timeout;
        startedRef.current = () => {
          window.clearTimeout(timeout);
          sessionTimeoutRef.current = null;
          resolve();
        };
      });
      channel.addEventListener('message', (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if ((payload as { type?: unknown })?.type === 'session.started') {
          startedRef.current?.();
        }
        const text = eventCaption(payload);
        if (text) {
          setCaptions(current => [...current, { id: Date.now(), text }].slice(-MAX_CAPTIONS));
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const response = await fetch(`/api/admin/voice-receptionist/sandbox?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: peer.localDescription?.sdp }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as SandboxResponse | { error?: { message?: string } } | null;
      const failureMessage = payload && 'error' in payload ? payload.error?.message : undefined;
      if (!response.ok || !payload || !('sdp' in payload) || !payload.sdp) {
        throw new Error(failureMessage || 'Mic sandbox is unavailable.');
      }
      if (generation !== generationRef.current) {
        await fetch(`/api/admin/voice-receptionist/sandbox?salonSlug=${encodeURIComponent(salonSlug)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId: payload.callId }) }).catch(() => undefined);
        return;
      }
      callIdRef.current = payload.callId;
      await peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      await sessionStarted;
      if (generation !== generationRef.current) {
        return;
      }
      setState('connected');
    } catch (cause) {
      if (generation !== generationRef.current) {
        return;
      }
      await release(true);
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Could not start the mic test.');
    }
  };

  return (
    <section className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
      <p className="text-sm font-semibold text-[var(--owner-ink)]">{copy.title}</p>
      <p className="mt-1 text-sm text-[var(--owner-muted)]">{copy.body}</p>
      <div className="mt-3 flex items-center gap-3">
        {state === 'connected'
          ? <button type="button" onClick={() => void stop()} className="rounded-lg border border-[var(--owner-line)] px-4 py-2 text-sm font-semibold text-[var(--owner-ink)]">{copy.stop}</button>
          : <button type="button" onClick={() => void start()} disabled={state === 'connecting' || state === 'stopping'} className="rounded-lg bg-[var(--owner-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{state === 'connecting' ? copy.connecting : copy.start}</button>}
        {state === 'connected' && <span className="text-sm text-emerald-700" role="status">{copy.connected}</span>}
      </div>
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {playbackBlocked && <button type="button" onClick={() => void audioRef.current?.play().then(() => setPlaybackBlocked(false)).catch(() => setError('Your browser blocked audio playback. Enable sound, then try again.'))} className="mt-3 rounded-lg border border-[var(--owner-line)] px-3 py-2 text-sm font-semibold text-[var(--owner-ink)]">Enable sound</button>}
      {captions.length > 0 && <div className="mt-3 max-h-40 space-y-2 overflow-y-auto text-sm text-[var(--owner-muted)]" aria-live="polite">{captions.map(caption => <p key={caption.id}>{caption.text}</p>)}</div>}
      <audio ref={audioRef} autoPlay playsInline className="hidden"><track kind="captions" /></audio>
    </section>
  );
}
