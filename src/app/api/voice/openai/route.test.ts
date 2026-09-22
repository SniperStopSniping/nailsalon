import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getVoiceRuntimeConfig: vi.fn(),
  readVoiceBody: vi.fn(),
  verifyVoiceOpenAiWebhook: vi.fn(),
  voiceRouteFromSipHeaders: vi.fn(),
  voiceTokenHash: vi.fn(),
  getVoiceCall: vi.fn(),
  getSalonById: vi.fn(),
  getVoiceSettings: vi.fn(),
  bindLiveSession: vi.fn(),
  claimVoiceLease: vi.fn(),
  setVoiceCallTransportState: vi.fn(),
  voiceLiveRequest: vi.fn(),
  buildVoiceSession: vi.fn(),
  coordinateVoiceCall: vi.fn(),
  after: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/libs/voiceReceptionist/config.server', () => ({ getVoiceRuntimeConfig: mocks.getVoiceRuntimeConfig }));
vi.mock('@/libs/voiceReceptionist/security.server', () => ({ readVoiceBody: mocks.readVoiceBody, verifyVoiceOpenAiWebhook: mocks.verifyVoiceOpenAiWebhook, voiceRouteFromSipHeaders: mocks.voiceRouteFromSipHeaders, voiceTokenHash: mocks.voiceTokenHash }));
vi.mock('@/libs/voiceReceptionist/storage.server', () => ({ getVoiceCall: mocks.getVoiceCall, getVoiceSettings: mocks.getVoiceSettings, bindLiveSession: mocks.bindLiveSession, claimVoiceLease: mocks.claimVoiceLease, setVoiceCallTransportState: mocks.setVoiceCallTransportState }));
vi.mock('@/libs/queries', () => ({ getSalonById: mocks.getSalonById }));
vi.mock('@/libs/voiceReceptionist/live.server', () => ({ voiceLiveRequest: mocks.voiceLiveRequest, buildVoiceSession: mocks.buildVoiceSession, liveSessionPath: (id: string) => `/${id}` }));
vi.mock('@/libs/voiceReceptionist/coordinator.server', () => ({ coordinateVoiceCall: mocks.coordinateVoiceCall }));

const raw = JSON.stringify({ type: 'live.transport.incoming', data: { type: 'sip', session_id: 'live_1', sip_headers: [] } });
const call = { id: '00000000-0000-4000-8000-000000000000', salonId: 'salon_a', provider: 'twilio', routeTokenHash: 'hash', liveSessionId: null, status: 'created' };

describe('/api/voice/openai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVoiceRuntimeConfig.mockReturnValue({ webhookSecret: 'secret' });
    mocks.readVoiceBody.mockResolvedValue(raw);
    mocks.verifyVoiceOpenAiWebhook.mockReturnValue(true);
    mocks.voiceRouteFromSipHeaders.mockReturnValue(`${call.id}.signature`);
    mocks.voiceTokenHash.mockReturnValue('hash');
    mocks.getVoiceCall.mockResolvedValue(call);
    mocks.getSalonById.mockResolvedValue({ id: 'salon_a', name: 'Isla', publicationStatus: 'published', onlineBookingEnabled: true });
    mocks.getVoiceSettings.mockResolvedValue({ enabled: true, bookingEnabled: true });
    mocks.bindLiveSession.mockResolvedValue({ ...call, liveSessionId: 'live_1', status: 'accepting' });
    mocks.claimVoiceLease.mockResolvedValue({ id: call.id });
    mocks.setVoiceCallTransportState.mockResolvedValue({ ...call, status: 'connected' });
    mocks.voiceLiveRequest.mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('rejects a signed webhook with an unmatched route token before tenant lookup or acceptance', async () => {
    mocks.voiceTokenHash.mockReturnValue('wrong');
    const response = await POST(new Request('https://app.test/api/voice/openai', { method: 'POST' }));

    expect(response.status).toBe(403);
    expect(mocks.getSalonById).not.toHaveBeenCalled();
    expect(mocks.voiceLiveRequest).not.toHaveBeenCalled();
  });

  it('rejects an expired or otherwise unbindable capability before accepting SIP', async () => {
    mocks.bindLiveSession.mockResolvedValue(null);
    const response = await POST(new Request('https://app.test/api/voice/openai', { method: 'POST' }));

    expect(response.status).toBe(403);
    expect(mocks.voiceLiveRequest).not.toHaveBeenCalled();
  });

  it('does not accept or attach a duplicate already-connected session', async () => {
    mocks.getVoiceCall.mockResolvedValue({ ...call, liveSessionId: 'live_1', status: 'connected' });
    const response = await POST(new Request('https://app.test/api/voice/openai', { method: 'POST' }));

    expect(response.status).toBe(204);
    expect(mocks.bindLiveSession).not.toHaveBeenCalled();
    expect(mocks.voiceLiveRequest).not.toHaveBeenCalled();
  });

  it('retries acceptance for the same session while its first acceptance is still unresolved', async () => {
    mocks.getVoiceCall.mockResolvedValue({ ...call, liveSessionId: 'live_1', status: 'accepting' });
    const response = await POST(new Request('https://app.test/api/voice/openai', { method: 'POST' }));

    expect(response.status).toBe(204);
    expect(mocks.bindLiveSession).toHaveBeenCalledWith(call.id, call.salonId, 'hash', 'live_1');
    expect(mocks.voiceLiveRequest).toHaveBeenCalledWith(expect.anything(), '/live_1/accept', expect.anything());
    expect(mocks.setVoiceCallTransportState).toHaveBeenCalledWith(call.id, call.salonId, 'live_1', 'connected');
  });

  it('retries acceptance for the same accepting session and terminalizes a failed acceptance', async () => {
    mocks.getVoiceCall.mockResolvedValue({ ...call, liveSessionId: 'live_1', status: 'accepting' });
    mocks.voiceLiveRequest.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const response = await POST(new Request('https://app.test/api/voice/openai', { method: 'POST' }));

    expect(response.status).toBe(503);
    expect(mocks.voiceLiveRequest).toHaveBeenNthCalledWith(1, expect.anything(), '/live_1/accept', expect.anything());
    expect(mocks.voiceLiveRequest).toHaveBeenNthCalledWith(2, expect.anything(), '/live_1/hangup');
    expect(mocks.setVoiceCallTransportState).toHaveBeenCalledWith(call.id, call.salonId, 'live_1', 'dropped');
  });
});
