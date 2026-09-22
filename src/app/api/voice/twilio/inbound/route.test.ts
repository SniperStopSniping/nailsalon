import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const {
  getVoiceRuntimeConfig,
  readVoiceForm,
  verifyVoiceTwilio,
  resolveVoiceNumber,
  getSalonById,
  getVoiceSettings,
  createVoiceCall,
} = vi.hoisted(() => ({
  getVoiceRuntimeConfig: vi.fn(),
  readVoiceForm: vi.fn(),
  verifyVoiceTwilio: vi.fn(),
  resolveVoiceNumber: vi.fn(),
  getSalonById: vi.fn(),
  getVoiceSettings: vi.fn(),
  createVoiceCall: vi.fn(),
}));

vi.mock('@/libs/voiceReceptionist/config.server', () => ({ getVoiceRuntimeConfig }));
vi.mock('@/libs/voiceReceptionist/security.server', () => ({ readVoiceForm, verifyVoiceTwilio, voiceRouteToken: vi.fn(() => '00000000-0000-4000-8000-000000000000.signature'), voiceTokenHash: vi.fn(() => 'hash') }));
vi.mock('@/libs/voiceReceptionist/storage.server', () => ({ createVoiceCall, getVoiceSettings, resolveVoiceNumber }));
vi.mock('@/libs/queries', () => ({ getSalonById }));
vi.mock('@/libs/voiceReceptionist/transport.server', () => ({ voiceDialTwiml: vi.fn(() => '<Response/>'), twimlUnavailable: vi.fn(() => new Response(null, { status: 503 })) }));

const config = { signingSecret: 'x'.repeat(32), origin: 'https://voice.test', projectId: 'proj_voice' };
const body = new URLSearchParams({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', Direction: 'inbound', To: '+14165551234', From: '+14165550000' });

describe('/api/voice/twilio/inbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVoiceRuntimeConfig.mockReturnValue(config);
    readVoiceForm.mockResolvedValue(Object.fromEntries(body));
    verifyVoiceTwilio.mockReturnValue(true);
    resolveVoiceNumber.mockResolvedValue({ salonId: 'salon_a' });
    getSalonById.mockResolvedValue({ id: 'salon_a', name: 'Isla', publicationStatus: 'published', onlineBookingEnabled: true, businessHours: null, settings: {} });
    getVoiceSettings.mockResolvedValue({ enabled: true, answerMode: 'always' });
    createVoiceCall.mockResolvedValue({ call: { id: '00000000-0000-4000-8000-000000000000', salonId: 'salon_a', providerCallId: body.get('CallSid'), routeExpiresAt: new Date(), createdAt: new Date() }, created: true });
  });

  it('does not touch routing or call creation when voice config is absent', async () => {
    getVoiceRuntimeConfig.mockReturnValue(null);
    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(response.status).toBe(503);
    expect(resolveVoiceNumber).not.toHaveBeenCalled();
    expect(createVoiceCall).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature before resolving a tenant', async () => {
    verifyVoiceTwilio.mockReturnValue(false);
    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(response.status).toBe(403);
    expect(resolveVoiceNumber).not.toHaveBeenCalled();
    expect(createVoiceCall).not.toHaveBeenCalled();
  });

  it('uses only the verified account and destination route for the salon', async () => {
    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(response.status).toBe(200);
    expect(resolveVoiceNumber).toHaveBeenCalledWith(body.get('AccountSid'), body.get('To'));
    expect(createVoiceCall).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon_a', provider: 'twilio' }));
  });

  it('answers an explicitly closed published weekday in after-hours mode', async () => {
    getSalonById.mockResolvedValue({
      id: 'salon_a',
      name: 'Isla',
      publicationStatus: 'published',
      onlineBookingEnabled: true,
      businessHours: {
        sunday: null,
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      },
      settings: { timezone: 'America/Toronto' },
    });
    getVoiceSettings.mockResolvedValue({ enabled: true, answerMode: 'after_hours' });

    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(response.status).toBe(200);
    expect(createVoiceCall).toHaveBeenCalled();
  });
});
