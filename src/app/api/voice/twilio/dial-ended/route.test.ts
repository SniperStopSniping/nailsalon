import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ getVoiceRuntimeConfig: vi.fn(), readVoiceForm: vi.fn(), verifyVoiceTwilio: vi.fn(), getVoiceCallByProvider: vi.fn(), finishVoiceCallFromProvider: vi.fn() }));
vi.mock('@/libs/voiceReceptionist/config.server', () => ({ getVoiceRuntimeConfig: mocks.getVoiceRuntimeConfig }));
vi.mock('@/libs/voiceReceptionist/security.server', () => ({ readVoiceForm: mocks.readVoiceForm, verifyVoiceTwilio: mocks.verifyVoiceTwilio }));
vi.mock('@/libs/voiceReceptionist/storage.server', () => ({ getVoiceCallByProvider: mocks.getVoiceCallByProvider, finishVoiceCallFromProvider: mocks.finishVoiceCallFromProvider }));

describe('/api/voice/twilio/dial-ended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVoiceRuntimeConfig.mockReturnValue({});
    mocks.readVoiceForm.mockResolvedValue({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', Direction: 'inbound', To: '+14165550100', CallStatus: 'completed', DialCallStatus: 'completed' });
    mocks.verifyVoiceTwilio.mockReturnValue(true);
    mocks.getVoiceCallByProvider.mockResolvedValue({ status: 'awaiting_confirmation' });
  });

  it.each(['completed', 'failed', 'no-answer', 'busy', 'canceled'])('returns valid TwiML after %s instead of an empty HTTP response', async (status) => {
    mocks.getVoiceCallByProvider.mockResolvedValue({ status: 'connected' });
    mocks.readVoiceForm.mockResolvedValue({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', DialCallStatus: status, DialCallDuration: '5' });
    const response = await POST(new Request('https://app.test/api/voice/twilio/dial-ended', { method: 'POST' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    expect(mocks.finishVoiceCallFromProvider).toHaveBeenCalledWith('AC11111111111111111111111111111111', 'CA11111111111111111111111111111111', 5);
  });

  it('rejects invalid signatures without reading or changing call state', async () => {
    mocks.verifyVoiceTwilio.mockReturnValue(false);
    const response = await POST(new Request('https://app.test/api/voice/twilio/dial-ended', { method: 'POST' }));

    expect(response.status).toBe(403);
    expect(mocks.getVoiceCallByProvider).not.toHaveBeenCalled();
    expect(mocks.finishVoiceCallFromProvider).not.toHaveBeenCalled();
  });

  it('does not finalize the checkpoint when only the SIP leg ends', async () => {
    const body = new URLSearchParams({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', DialCallStatus: 'completed' });
    const response = await POST(new Request('https://app.test/api/voice/twilio/dial-ended', { method: 'POST', body }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    expect(await response.text()).toContain('<Response/>');
    expect(mocks.finishVoiceCallFromProvider).not.toHaveBeenCalled();
  });
});
