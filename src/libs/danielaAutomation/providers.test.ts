import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { DanielaConfig } from './config';
import { sendSms, sendTelegram } from './providers';
import type { Send } from './store';

vi.mock('server-only', () => ({}));
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('twilio', () => ({ default: vi.fn(() => ({ messages: { create: provider.create } })) }));
const config = { mode: 'live', accountSid: `AC${'a'.repeat(32)}`, authToken: 'synthetic', fromNumber: '+14165550101', publicOrigin: 'https://example.test', telegramChatId: '1' } as DanielaConfig;
const item = { id: 'synthetic-intent', phone: '+14165550100', body: 'Synthetic SMS' } as Send;

beforeEach(() => {
  provider.create.mockReset();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('DANIELA_N8N_CUTOVER_CONFIRMED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('sends only through the configured dedicated number and includes callback identity', async () => {
  const sid = `SM${'c'.repeat(32)}`;
  provider.create.mockResolvedValue({ sid });

  expect(await sendSms(config, item)).toEqual({ sid });
  expect(provider.create).toHaveBeenCalledWith({ from: config.fromNumber, to: item.phone, body: item.body, statusCallback: 'https://example.test/api/private/daniela/status?id=synthetic-intent' });
});

it('keeps a provider timeout unknown and never automatically retries it', async () => {
  provider.create.mockRejectedValue(new Error('synthetic timeout'));

  expect(await sendSms(config, item)).toEqual({ unknown: true, errorCode: 'PROVIDER_OUTCOME_UNKNOWN' });
  expect(provider.create).toHaveBeenCalledOnce();
});

it('records a definite Twilio rejection separately from an unknown outcome', async () => {
  provider.create.mockRejectedValue({ code: 21211, status: 400 });

  expect(await sendSms(config, item)).toEqual({ errorCode: '21211' });
});

it('does not claim rejection for a server error', async () => {
  provider.create.mockRejectedValue({ code: 20500, status: 500 });

  expect(await sendSms(config, item)).toMatchObject({ unknown: true });
});

it('treats a missing provider SID as unknown', async () => {
  provider.create.mockResolvedValue({ sid: '' });

  expect(await sendSms(config, item)).toMatchObject({ unknown: true });
});

it('does not make provider calls in shadow or preview', async () => {
  expect(await sendSms({ ...config, mode: 'shadow' }, item)).toEqual({ errorCode: 'NOT_LIVE' });

  vi.stubEnv('VERCEL_ENV', 'preview');

  expect(await sendSms(config, item)).toEqual({ errorCode: 'NOT_LIVE' });
  expect(provider.create).not.toHaveBeenCalled();
});

it('requires Telegram to confirm ok rather than treating HTTP 200 as success', async () => {
  vi.stubEnv('DANIELA_TELEGRAM_BOT_TOKEN', 'synthetic');
  const fetcher = vi.fn(async () => Response.json({ ok: false }));
  vi.stubGlobal('fetch', fetcher);

  expect(await sendTelegram(config, 'Synthetic alert')).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});
