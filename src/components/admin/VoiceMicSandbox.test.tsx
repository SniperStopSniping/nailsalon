import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoiceMicSandbox } from './VoiceMicSandbox';

class FakeChannel extends EventTarget {
  emit(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}

class FakePeer extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'complete';
  localDescription: RTCSessionDescriptionInit = { type: 'offer', sdp: 'offer-sdp' };
  channel = new FakeChannel();
  addTrack = vi.fn();
  createDataChannel = vi.fn(() => this.channel);
  createOffer = vi.fn(async () => this.localDescription);
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => {
    this.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'I want short nails.' });
    this.channel.emit({ type: 'session.started' });
  });

  close = vi.fn();
}

describe('VoiceMicSandbox', () => {
  const track = { stop: vi.fn() };
  let peer: FakePeer;

  beforeEach(() => {
    peer = new FakePeer();
    vi.stubGlobal('RTCPeerConnection', vi.fn(() => peer));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return Response.json({ callId: 'call_1', sessionId: 'session_1', sdp: 'answer-sdp' });
    }));
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async () => undefined) });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts after SDP exchange, keeps captions only in memory, and releases mic resources', async () => {
    render(<VoiceMicSandbox salonSlug="isla" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start mic test' }));
    await screen.findByText('Listening');

    expect(screen.getByText('I want short nails.')).toBeInTheDocument();
    expect(peer.createDataChannel).toHaveBeenCalledWith('oai-events');
    expect(peer.createOffer).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'End mic test' }));
    await waitFor(() => expect(track.stop).toHaveBeenCalled());

    expect(peer.close).toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/admin/voice-receptionist/sandbox?salonSlug=isla',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ callId: 'call_1' }) }),
    );
    expect(screen.queryByText('I want short nails.')).not.toBeInTheDocument();
  });

  it('plays the remote voice track', async () => {
    render(<VoiceMicSandbox salonSlug="isla" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start mic test' }));
    await screen.findByText('Listening');

    const remoteStream = {} as MediaStream;
    const event = new Event('track');
    Object.defineProperty(event, 'streams', { value: [remoteStream] });
    peer.dispatchEvent(event);

    const audio = document.querySelector('audio') as HTMLAudioElement;

    expect(audio.srcObject).toBe(remoteStream);
    expect(audio.play).toHaveBeenCalled();
  });

  it('stops a microphone resolved after unmount without opening a session', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const lateTrack = { stop: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      })) },
    });
    const { unmount } = render(<VoiceMicSandbox salonSlug="isla" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start mic test' }));
    unmount();
    resolveStream?.({ getTracks: () => [lateTrack] } as unknown as MediaStream);

    await waitFor(() => expect(lateTrack.stop).toHaveBeenCalled());

    expect(fetch).not.toHaveBeenCalled();
  });
});
