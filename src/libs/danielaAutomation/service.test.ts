import { beforeEach, expect, it, vi } from 'vitest';

import type { DanielaConfig } from './config';
import { dispatchOwnerAlerts, processDaniela } from './service';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  finish: vi.fn(),
  context: vi.fn(),
  telegram: vi.fn(),
  sheets: vi.fn(),
  claimSend: vi.fn(),
  scrub: vi.fn(),
}));
vi.mock('./callerContext.server', () => ({ getCallerContext: mocks.context }));
vi.mock('./providers', () => ({ sendTelegram: mocks.telegram, sendSms: vi.fn() }));
vi.mock('./sheets', () => ({ readSheets: mocks.sheets, parseSheets: vi.fn(), syncContact: vi.fn() }));
vi.mock('./store', () => ({
  claimAlert: mocks.claim,
  finishAlert: mocks.finish,
  claimSend: mocks.claimSend,
  finishSend: vi.fn(),
  dirtyContacts: vi.fn(),
  importContacts: vi.fn(),
  markContactSynced: vi.fn(),
  queueCampaign: vi.fn(),
  scrubOldBodies: mocks.scrub,
}));

const config: DanielaConfig = {
  mode: 'live',
  salonId: 'synthetic-isla',
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'synthetic',
  fromNumber: '+14165550101',
  publicOrigin: 'https://example.test',
  greeting: 'Test',
  bookingMessage: 'Test',
  promoMessage: 'Test',
  blockedPhones: [],
  preferredPhones: [],
  sheets: [{ spreadsheetId: 'main', tab: 'Sheet1', role: 'primary' }, { spreadsheetId: 'inbound', tab: 'CRM', role: 'inbound' }],
  telegramChatId: '1',
  campaignEnabled: false,
};
const event = { id: 'synthetic-event', kind: 'call', phone: '+14165550100', body: null, receivedAt: new Date('2026-11-02T20:05:26Z') };
const target = { kind: 'call' as const, providerSid: `CA${'b'.repeat(32)}` };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue(null);
  mocks.claimSend.mockResolvedValue(null);
  mocks.context.mockResolvedValue({ match: 'matched', name: 'Synthetic Client', nextAppointment: null });
  mocks.telegram.mockResolvedValue(true);
});

it('delivers the specific incoming-call alert without reading Sheets or running campaign admission', async () => {
  mocks.claim.mockResolvedValueOnce(event);

  expect(await dispatchOwnerAlerts(config, target)).toBe(1);
  expect(mocks.claim).toHaveBeenCalledWith(config, expect.any(Date), target);
  expect(mocks.context).toHaveBeenCalledWith(config, event.phone);
  expect(mocks.telegram).toHaveBeenCalledWith(config, expect.stringContaining('📞 Incoming call'));
  expect(mocks.telegram).toHaveBeenCalledWith(config, expect.stringContaining('Name:\nSynthetic Client'));
  expect(mocks.finish).toHaveBeenCalledWith(config, event.id, true);
  expect(mocks.sheets).not.toHaveBeenCalled();
  expect(mocks.claim).toHaveBeenCalledOnce();
});

it('still delivers the phone/date/message alert if optional client enrichment fails', async () => {
  mocks.claim.mockResolvedValueOnce({ ...event, kind: 'sms', body: 'Please call me' });
  mocks.context.mockRejectedValueOnce(new Error('Synthetic client lookup outage'));

  expect(await dispatchOwnerAlerts(config, { ...target, kind: 'sms' })).toBe(1);
  expect(mocks.telegram).toHaveBeenCalledWith(config, expect.stringContaining('Message:\nPlease call me'));
  expect(mocks.telegram).toHaveBeenCalledWith(config, expect.stringContaining('Name:\nTemporarily unavailable'));
});

it('does not claim or send owner alerts in shadow mode', async () => {
  expect(await dispatchOwnerAlerts({ ...config, mode: 'shadow' }, target)).toBe(0);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.telegram).not.toHaveBeenCalled();
});

it('retains uncertain provider outcomes without automatically sending the alert again', async () => {
  mocks.claim.mockResolvedValueOnce(event);
  mocks.telegram.mockResolvedValueOnce(false);

  expect(await dispatchOwnerAlerts(config, target)).toBe(0);
  expect(mocks.finish).toHaveBeenCalledWith(config, event.id, false);
  expect(mocks.telegram).toHaveBeenCalledOnce();
});

it('lets the recovery worker send pending alerts even if its Sheets refresh fails', async () => {
  mocks.sheets.mockRejectedValueOnce(new Error('Synthetic Sheets outage'));
  mocks.claim.mockResolvedValueOnce(event);

  expect(await processDaniela(config)).toMatchObject({ alerts: 1, sheetsFailed: true });
  expect(mocks.telegram).toHaveBeenCalledOnce();
});
