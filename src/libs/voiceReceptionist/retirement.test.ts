import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getVoiceRuntimeConfig, getVoiceBookingSigningSecret } = await import('./config.server');
const { voiceLiveRequest } = await import('./live.server');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('AI receptionist retirement', () => {
  it('cannot be reactivated by legacy phone or browser environment switches', () => {
    vi.stubEnv('VOICE_RECEPTIONIST_ENABLED', 'true');
    vi.stubEnv('VOICE_RECEPTIONIST_SANDBOX_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY_VOICE', 'synthetic-not-a-credential');
    vi.stubEnv('VOICE_RECEPTIONIST_SIGNING_SECRET', 's'.repeat(32));
    vi.stubEnv('VOICE_RECEPTIONIST_WEBHOOK_ORIGIN', 'https://voice.example.test');

    expect(getVoiceRuntimeConfig('phone')).toBeNull();
    expect(getVoiceRuntimeConfig('browser')).toBeNull();
    // Existing pending booking reconciliation remains deterministic and signed.
    expect(getVoiceBookingSigningSecret()).toBe('s'.repeat(32));
  });

  it('blocks direct provider calls even with a stale runtime config', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const config = { apiKey: 'synthetic', signingSecret: 's'.repeat(32), webhookSecret: 'synthetic', projectId: 'proj_synthetic', origin: 'https://voice.example.test', twilioAccountSid: 'synthetic', twilioAuthToken: 'synthetic' };

    await expect(voiceLiveRequest(config, '', { instructions: 'SYNTHETIC_CALENDAR_CANARY' })).rejects.toMatchObject({ status: 410 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
