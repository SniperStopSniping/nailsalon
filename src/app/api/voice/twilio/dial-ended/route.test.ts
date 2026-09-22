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

  it('does not finalize the checkpoint when only the SIP leg ends', async () => {
    const body = new URLSearchParams({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', DialCallStatus: 'completed' });
    const response = await POST(new Request('https://app.test/api/voice/twilio/dial-ended', { method: 'POST', body }));

    expect(response.status).toBe(204);
    expect(mocks.finishVoiceCallFromProvider).not.toHaveBeenCalled();
  });
});
