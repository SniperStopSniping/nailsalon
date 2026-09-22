import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const { requireAdminSalon, requireRealSalonOwner, getVoiceRuntimeConfig, createVoiceCall, getVoiceSettings, voiceLiveRequest, bindLiveSession, claimVoiceLease } = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
  requireRealSalonOwner: vi.fn(),
  getVoiceRuntimeConfig: vi.fn(),
  createVoiceCall: vi.fn(),
  getVoiceSettings: vi.fn(),
  voiceLiveRequest: vi.fn(),
  bindLiveSession: vi.fn(),
  claimVoiceLease: vi.fn(),
}));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon, requireRealSalonOwner }));
vi.mock('@/libs/voiceReceptionist/config.server', () => ({ getVoiceRuntimeConfig }));
vi.mock('@/libs/voiceReceptionist/security.server', () => ({ readVoiceBody: vi.fn(async request => request.text()), voiceRouteToken: vi.fn(() => 'route'), voiceTokenHash: vi.fn(() => 'hash') }));
vi.mock('@/libs/voiceReceptionist/storage.server', () => ({ createVoiceCall, getVoiceSettings, bindLiveSession, claimVoiceLease, getVoiceCall: vi.fn(), releaseVoiceLease: vi.fn() }));
vi.mock('@/libs/voiceReceptionist/live.server', () => ({ buildVoiceSession: vi.fn(() => ({ model: 'gpt-live-1' })), voiceLiveRequest, liveSessionPath: vi.fn() }));
vi.mock('@/libs/voiceReceptionist/coordinator.server', () => ({ coordinateVoiceCall: vi.fn() }));

describe('/api/admin/voice-receptionist/sandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1', name: 'Isla' }, error: null });
    requireRealSalonOwner.mockResolvedValue({ ok: true });
    getVoiceRuntimeConfig.mockReturnValue({ signingSecret: 'x'.repeat(32) });
    createVoiceCall.mockResolvedValue({ call: { id: '00000000-0000-4000-8000-000000000000' } });
    getVoiceSettings.mockResolvedValue({ voice: 'marin', language: 'auto', greeting: '', bookingEnabled: true });
    voiceLiveRequest.mockResolvedValue(Response.json({ session: { id: 'session_1' }, transport: { sdp: 'answer-sdp' } }));
    bindLiveSession.mockResolvedValue({ id: 'call_1' });
    claimVoiceLease.mockResolvedValue({ id: 'call_1' });
  });

  it('sends the offer only through the documented WebRTC transport envelope', async () => {
    const response = await POST(new Request('https://app.test/api/admin/voice-receptionist/sandbox?salonSlug=isla', { method: 'POST', headers: { 'origin': 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ sdp: 'offer-sdp' }) }));

    expect(response.status).toBe(200);
    expect(voiceLiveRequest).toHaveBeenCalledWith(expect.anything(), '', expect.objectContaining({ transport: { type: 'webrtc', sdp: 'offer-sdp' } }));
    expect(await response.json()).toEqual({ callId: '00000000-0000-4000-8000-000000000000', sessionId: 'session_1', sdp: 'answer-sdp' });
  });
});
