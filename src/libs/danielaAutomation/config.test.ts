import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getDanielaConfig } from './config';

vi.mock('server-only', () => ({}));
const definition = {
  salonId: 'synthetic-isla',
  accountSid: `AC${'a'.repeat(32)}`,
  fromNumber: '+14165550101',
  publicOrigin: 'https://example.test',
  greeting: 'Synthetic greeting',
  bookingMessage: 'Synthetic booking link',
  promoMessage: 'Synthetic promotion',
  blockedPhones: [],
  preferredPhones: [],
  telegramChatId: '1',
  sheets: [{ spreadsheetId: 'main', tab: 'Sheet1', role: 'primary' }, { spreadsheetId: 'copy', tab: 'CRM', role: 'inbound' }],
};

beforeEach(() => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', '');
  vi.stubEnv('DANIELA_AUTOMATION_CONFIG', JSON.stringify(definition));
  vi.stubEnv('DANIELA_TWILIO_AUTH_TOKEN', 'synthetic');
  vi.stubEnv('DANIELA_N8N_CUTOVER_CONFIRMED', '');
  vi.stubEnv('DANIELA_CAMPAIGN_ENABLED', '');
  vi.stubEnv('DANIELA_CAMPAIGN_RESEND_PHONES', '');
  vi.stubEnv('DANIELA_CAMPAIGN_INCLUDE_NEW_CONTACTS', '');
});

afterEach(() => vi.unstubAllEnvs());

it('is off by default', () => expect(getDanielaConfig()).toBeNull());

it('allows shadow mode without enabling production sends', () => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'shadow');

  expect(getDanielaConfig()?.mode).toBe('shadow');
});

it('requires a full explicit cutover and all integration credentials for live mode', () => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'live');
  vi.stubEnv('VERCEL_ENV', 'production');

  expect(getDanielaConfig()).toBeNull();

  vi.stubEnv('DANIELA_N8N_CUTOVER_CONFIRMED', 'true');
  vi.stubEnv('DANIELA_GOOGLE_CLIENT_ID', 'synthetic');
  vi.stubEnv('DANIELA_GOOGLE_CLIENT_SECRET', 'synthetic');
  vi.stubEnv('DANIELA_GOOGLE_REFRESH_TOKEN', 'synthetic');
  vi.stubEnv('DANIELA_TELEGRAM_BOT_TOKEN', 'synthetic');

  expect(getDanielaConfig()?.mode).toBe('live');

  vi.stubEnv('VERCEL_ENV', 'preview');

  expect(getDanielaConfig()).toBeNull();
});

it('requires real business copy and receiving identity rather than assuming them', () => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'shadow');
  vi.stubEnv('DANIELA_AUTOMATION_CONFIG', JSON.stringify({ ...definition, bookingMessage: '' }));

  expect(getDanielaConfig()).toBeNull();
});

it('fails closed on corrupt configuration', () => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'live');
  vi.stubEnv('DANIELA_AUTOMATION_CONFIG', 'bad json');

  expect(getDanielaConfig()).toBeNull();
});

it('accepts an explicit ordered one-time resend scope', () => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'shadow');
  vi.stubEnv('DANIELA_CAMPAIGN_ENABLED', 'true');
  vi.stubEnv('DANIELA_CAMPAIGN_RESEND_PHONES', JSON.stringify(['+14165550102', '+14165550103']));

  expect(getDanielaConfig()).toMatchObject({
    campaignEnabled: true,
    campaignResendPhones: ['+14165550102', '+14165550103'],
  });
});

it.each(['', 'false', 'invalid'])('keeps new-contact campaign enrollment off without an explicit true setting: %s', (value) => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'shadow');
  vi.stubEnv('DANIELA_CAMPAIGN_ENABLED', 'true');
  vi.stubEnv('DANIELA_CAMPAIGN_INCLUDE_NEW_CONTACTS', value);

  expect(getDanielaConfig()).toMatchObject({ campaignEnabled: true, campaignIncludeNewContacts: false });
});

it('allows explicitly authorized new-contact enrollment without creating a resend scope', () => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'shadow');
  vi.stubEnv('DANIELA_CAMPAIGN_ENABLED', 'true');
  vi.stubEnv('DANIELA_CAMPAIGN_INCLUDE_NEW_CONTACTS', 'true');

  expect(getDanielaConfig()).toMatchObject({ campaignEnabled: true, campaignIncludeNewContacts: true });
  expect(getDanielaConfig()?.campaignResendPhones).toBeUndefined();
});

it.each(['bad json', '[]', '["not-a-phone"]', '["+14165550102","+14165550102"]', JSON.stringify(Array.from({ length: 11 }, (_, i) => `+141655501${String(i).padStart(2, '0')}`))])('pauses only the campaign for an invalid resend scope: %s', (value) => {
  vi.stubEnv('DANIELA_AUTOMATION_MODE', 'shadow');
  vi.stubEnv('DANIELA_CAMPAIGN_ENABLED', 'true');
  vi.stubEnv('DANIELA_CAMPAIGN_RESEND_PHONES', value);

  expect(getDanielaConfig()).toMatchObject({ mode: 'shadow', campaignEnabled: false, campaignResendPhones: [] });
});
