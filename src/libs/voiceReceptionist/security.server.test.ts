import { createHmac } from 'node:crypto';

import twilio from 'twilio';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { readVoiceBody, readVoiceForm, verifyVoiceOpenAiWebhook, verifyVoiceTwilio, voiceRouteFromSipHeaders, voiceRouteToken } = await import('./security.server');

const config = { apiKey: 'synthetic', signingSecret: 's'.repeat(32), webhookSecret: '', projectId: 'proj_synthetic', origin: 'https://voice.example.test', twilioAccountSid: `AC${'a'.repeat(32)}`, twilioAuthToken: 'synthetic-auth' };

describe('voice provider authentication', () => {
  it('authenticates the exact OpenAI body within five minutes and rejects stale/tampered bodies', () => {
    const now = Date.parse('2026-09-22T12:00:00Z');
    const body = '{"type":"live.transport.incoming"}';
    const key = Buffer.alloc(32, 7);
    const timestamp = String(now / 1000);
    const signature = createHmac('sha256', key).update(`event-a.${timestamp}.${body}`).digest('base64');
    const headers = new Headers({ 'webhook-id': 'event-a', 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` });
    const secret = ['whsec', key.toString('base64')].join('_');

    expect(verifyVoiceOpenAiWebhook(body, headers, secret, now)).toBe(true);
    expect(verifyVoiceOpenAiWebhook(`${body} `, headers, secret, now)).toBe(false);
    expect(verifyVoiceOpenAiWebhook(body, headers, secret, now + 301_000)).toBe(false);
    expect(verifyVoiceOpenAiWebhook(body, headers, 'invalid', now)).toBe(false);
  });

  it('binds Twilio signatures to the configured origin, query, and account', () => {
    const path = '/api/voice/twilio/confirm?call=a&token=b';
    const params = { AccountSid: config.twilioAccountSid, CallSid: 'CAcall', SpeechResult: 'yes, book it' };
    const signature = twilio.getExpectedTwilioSignature(config.twilioAuthToken, `${config.origin}${path}`, params);
    const request = new Request(`http://internal.invalid${path}`, { headers: { 'x-twilio-signature': signature, 'x-forwarded-host': 'attacker.invalid' } });

    expect(verifyVoiceTwilio(request, params, config)).toBe(true);
    expect(verifyVoiceTwilio(request, { ...params, AccountSid: `AC${'b'.repeat(32)}` }, config)).toBe(false);
    expect(verifyVoiceTwilio(new Request(`${config.origin}/api/voice/twilio/confirm?call=a&token=c`, { headers: request.headers }), params, config)).toBe(false);
  });

  it('rejects duplicate SIP capabilities and rotates them with the trusted routing deadline', () => {
    const call = { id: 'b883cdd1-f08e-41c4-a9f0-90fa5c946630', salonId: 'salon-a', providerCallId: 'CAcall', routeExpiresAt: new Date('2026-09-22T12:03:00Z') };
    const token = voiceRouteToken(call, config.signingSecret);

    expect(voiceRouteFromSipHeaders([{ name: 'X-Luster-Route', value: token }])).toBe(token);
    expect(voiceRouteFromSipHeaders([{ name: 'X-Luster-Route', value: token }, { name: 'x-luster-route', value: token }])).toBeNull();
    expect(voiceRouteToken({ ...call, salonId: 'salon-b' }, config.signingSecret)).not.toBe(token);
    expect(voiceRouteToken({ ...call, routeExpiresAt: new Date('2026-09-22T12:04:00Z') }, config.signingSecret)).not.toBe(token);
  });

  it('bounds raw webhook bodies even without a content-length header', async () => {
    await expect(readVoiceBody(new Request('https://voice.example.test', { method: 'POST', body: 'x'.repeat(20) }), 10)).resolves.toBeNull();
    await expect(readVoiceBody(new Request('https://voice.example.test', { method: 'POST', body: 'safe' }), 10)).resolves.toBe('safe');
  });

  it('rejects ambiguous Twilio form keys before signature verification', async () => {
    await expect(readVoiceForm(new Request('https://voice.example.test', { method: 'POST', body: 'CallSid=CAone&CallSid=CAtwo' }))).resolves.toBeNull();
    await expect(readVoiceForm(new Request('https://voice.example.test', { method: 'POST', body: 'CallSid=CAone&AccountSid=ACone' }))).resolves.toEqual({ CallSid: 'CAone', AccountSid: 'ACone' });
  });
});
