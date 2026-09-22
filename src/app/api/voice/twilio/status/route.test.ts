import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ getVoiceRuntimeConfig: vi.fn(), readVoiceForm: vi.fn(), verifyVoiceTwilio: vi.fn(), getVoiceCallByProvider: vi.fn(), finishVoiceCallFromProvider: vi.fn() }));
vi.mock('@/libs/voiceReceptionist/config.server', () => ({ getVoiceRuntimeConfig: mocks.getVoiceRuntimeConfig }));
vi.mock('@/libs/voiceReceptionist/security.server', () => ({ readVoiceForm: mocks.readVoiceForm, verifyVoiceTwilio: mocks.verifyVoiceTwilio }));
vi.mock('@/libs/voiceReceptionist/storage.server', () => ({ getVoiceCallByProvider: mocks.getVoiceCallByProvider, finishVoiceCallFromProvider: mocks.finishVoiceCallFromProvider }));

const body = (status: string) => new URLSearchParams({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', CallStatus: status });

describe('/api/voice/twilio/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVoiceRuntimeConfig.mockReturnValue({});
    mocks.readVoiceForm.mockResolvedValue({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', Direction: 'inbound', To: '+14165550100', CallStatus: 'completed', DialCallStatus: 'completed' });
    mocks.verifyVoiceTwilio.mockReturnValue(true);
    mocks.getVoiceCallByProvider.mockResolvedValue({ status: 'awaiting_confirmation' });
  });

  it('ends an awaiting-confirmation checkpoint on a terminal parent-call status', async () => {
    const response = await POST(new Request('https://app.test/api/voice/twilio/status', { method: 'POST', body: body('completed') }));

    expect(response.status).toBe(204);
    expect(mocks.finishVoiceCallFromProvider).toHaveBeenCalled();
  });

  it('ignores authenticated non-terminal status without finalizing', async () => {
    mocks.readVoiceForm.mockResolvedValueOnce({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', CallStatus: 'in-progress' });
    const response = await POST(new Request('https://app.test/api/voice/twilio/status', { method: 'POST', body: body('in-progress') }));

    expect(response.status).toBe(204);
    expect(mocks.finishVoiceCallFromProvider).not.toHaveBeenCalled();
  });
});
