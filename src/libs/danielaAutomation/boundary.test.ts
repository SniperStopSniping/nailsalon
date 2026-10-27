import twilio from 'twilio';
import { beforeEach, expect, it, vi } from 'vitest';

import { POST as inbound } from '@/app/api/private/daniela/inbound/route';
import { GET as processRoute } from '@/app/api/private/daniela/process/route';
import { POST as status } from '@/app/api/private/daniela/status/route';

import type { DanielaConfig } from './config';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ config: null as DanielaConfig | null, record: vi.fn(async () => 'queued'), status: vi.fn(async () => true), after: vi.fn(), dispatch: vi.fn() }));
vi.mock('./config', () => ({ getDanielaConfig: () => state.config }));
vi.mock('./store', () => ({ recordInbound: state.record, recordStatus: state.status, acquireWorker: vi.fn(), releaseWorker: vi.fn() }));
vi.mock('./service', () => ({ dispatchPending: state.dispatch, processDaniela: vi.fn() }));
vi.mock('next/server', () => ({ after: state.after }));

const config: DanielaConfig = {
  mode: 'shadow',
  salonId: 'isla',
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'synthetic-auth',
  fromNumber: '+14165550101',
  publicOrigin: 'https://example.test',
  greeting: 'Synthetic <greeting>',
  bookingMessage: 'Synthetic booking',
  promoMessage: 'Synthetic promo',
  blockedPhones: [],
  preferredPhones: [],
  telegramChatId: '1',
  campaignEnabled: false,
  sheets: [{ spreadsheetId: 'main', tab: 'Sheet1', role: 'primary' }, { spreadsheetId: 'copy', tab: 'CRM', role: 'inbound' }],
};
const sid = `SM${'b'.repeat(32)}`;
function signed(path: string, data: Record<string, string>, override: Record<string, string> = {}) {
  const url = `${config.publicOrigin}/api/private/daniela/${path}`;
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilio.getExpectedTwilioSignature(config.authToken, url, data), ...override }, body: new URLSearchParams(data) });
}
const params = () => ({ AccountSid: config.accountSid, To: config.fromNumber, From: '+14165550100', MessageSid: sid, Body: 'Hello' });

beforeEach(() => {
  state.config = config;
  state.record.mockReset().mockResolvedValue('queued');
  state.status.mockReset().mockResolvedValue(true);
  state.after.mockClear();
});

it('returns 404 before reading the payload while disabled', async () => {
  state.config = null;

  expect((await inbound(new Request('https://example.test/api/private/daniela/inbound', { method: 'POST' }))).status).toBe(404);
  expect(state.record).not.toHaveBeenCalled();
});

it('requires a real Twilio signature and never trusts a supplied salon id', async () => {
  const request = signed('inbound', params(), { 'x-twilio-signature': 'invalid' });

  expect((await inbound(request)).status).toBe(403);
  expect(state.record).not.toHaveBeenCalled();
});

it.each([
  { AccountSid: `AC${'c'.repeat(32)}` },
  { To: '+14165550199' },
])('rejects a signed event for another receiving identity', async (changes) => {
  expect((await inbound(signed('inbound', { ...params(), ...changes }))).status).toBe(403);
  expect(state.record).not.toHaveBeenCalled();
});

it('durably queues a signed text before acknowledging and schedules prompt dispatch', async () => {
  const response = await inbound(signed('inbound', params()));

  expect(response.status).toBe(200);
  expect(await response.text()).toContain('<Response></Response>');
  expect(state.record).toHaveBeenCalledWith(config, expect.objectContaining({ kind: 'sms', providerSid: sid }));
  expect(state.after).toHaveBeenCalledOnce();
});

it('plays the configured greeting and hangs up for a signed call', async () => {
  const data = { AccountSid: config.accountSid, To: config.fromNumber, From: '+14165550100', CallSid: `CA${'d'.repeat(32)}` };
  const response = await inbound(signed('inbound', data));

  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Synthetic &lt;greeting&gt;</Say><Hangup/>');
});

it('returns a retryable failure rather than a false success when persistence fails', async () => {
  state.record.mockRejectedValueOnce(new Error('synthetic outage'));

  expect((await inbound(signed('inbound', params()))).status).toBe(503);
  expect(state.after).not.toHaveBeenCalled();
});

it('rejects a malformed provider sid', async () => {
  expect((await inbound(signed('inbound', { ...params(), MessageSid: 'wrong' }))).status).toBe(400);
});

it('binds a signed delivery callback to its delivery id', async () => {
  const response = await status(signed('status?id=synthetic', { ...params(), MessageStatus: 'delivered' }));

  expect(response.status).toBe(204);
  expect(state.status).toHaveBeenCalledWith(config, 'synthetic', expect.objectContaining({ MessageStatus: 'delivered' }));
});

it('requires the machine secret for the scheduled worker', async () => {
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');

  expect((await processRoute(new Request('https://example.test/api/private/daniela/process'))).status).toBe(401);

  vi.unstubAllEnvs();
});
