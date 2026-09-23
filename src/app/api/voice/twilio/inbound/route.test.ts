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
vi.mock('@/libs/voiceReceptionist/transport.server', () => ({ voiceDialTwiml: vi.fn(() => '<Response/>'), twimlRejected: vi.fn(() => new Response('<Response><Reject reason="rejected"/></Response>', { status: 200 })), twimlUnavailable: vi.fn(() => new Response(null, { status: 503 })) }));

const config = { signingSecret: 'x'.repeat(32), origin: 'https://voice.test', projectId: 'proj_voice' };
const body = new URLSearchParams({ AccountSid: 'AC11111111111111111111111111111111', CallSid: 'CA11111111111111111111111111111111', Direction: 'inbound', To: '+14165551234', From: '+14165550000', ForwardedFrom: '+14165550123' });

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

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<Reject');
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

  it('uses the verified account, destination, and listed forwarding number for Isla', async () => {
    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(response.status).toBe(200);
    expect(resolveVoiceNumber).toHaveBeenCalledWith(body.get('AccountSid'), body.get('To'), body.get('ForwardedFrom'));
    expect(createVoiceCall).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon_a', provider: 'twilio' }));
  });

  it.each([null, '+14165550999', '4165550123', '+14165550123,+14165550999'])(
    'rejects unlisted or unusable forwarding metadata %s before creating a call',
    async (forwardedFrom) => {
      const form = Object.fromEntries(body);
      if (forwardedFrom === null) {
        delete form.ForwardedFrom;
      } else {
        form.ForwardedFrom = forwardedFrom;
      }
      readVoiceForm.mockResolvedValue(form);
      if (forwardedFrom === '+14165550999') {
        resolveVoiceNumber.mockResolvedValue(null);
      }
      const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<Reject');
      expect(createVoiceCall).not.toHaveBeenCalled();

      if (forwardedFrom !== '+14165550999') {
        expect(resolveVoiceNumber).not.toHaveBeenCalled();
      }
    },
  );

  it('does not use caller ID as a forwarding fallback', async () => {
    const form = Object.fromEntries(body);
    form.From = '+14165550123';
    delete form.ForwardedFrom;
    readVoiceForm.mockResolvedValue(form);

    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(await response.text()).toContain('<Reject');
    expect(resolveVoiceNumber).not.toHaveBeenCalled();
  });

  it('rejects a listed forwarding number when the destination route is absent', async () => {
    resolveVoiceNumber.mockResolvedValue(null);

    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(await response.text()).toContain('<Reject');
    expect(createVoiceCall).not.toHaveBeenCalled();
  });

  it('rejects when Daniela turns phone answering off', async () => {
    getVoiceSettings.mockResolvedValue({ enabled: false, answerMode: 'always' });

    const response = await POST(new Request('https://voice.test/api/voice/twilio/inbound', { method: 'POST', body }));

    expect(await response.text()).toContain('<Reject');
    expect(createVoiceCall).not.toHaveBeenCalled();
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
