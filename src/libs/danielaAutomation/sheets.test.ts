import { afterEach, expect, it, vi } from 'vitest';

import { syncContact } from './sheets';
import type { Contact } from './store';

vi.mock('server-only', () => ({}));

afterEach(() => vi.unstubAllGlobals());

const contact = {
  phone: '+14165550100',
  lastMessage: '=synthetic text',
  lastInboundSid: 'synthetic-sid',
  lastInboundAt: new Date('2026-10-26T15:00:00Z'),
  lastBookingAt: null,
  lastSource: 'sms',
  promoAttemptedAt: null,
  promoAcceptedAt: null,
  blocked: false,
  providerOptOut: false,
} as Contact;

it('writes RAW values only to recognized cells and preserves owner notes', async () => {
  const fetcher = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  await syncContact(contact, { token: 'synthetic-token', snapshots: [{
    definition: { spreadsheetId: 'synthetic-sheet', tab: 'CRM', role: 'inbound' },
    headers: ['Phone', 'Notes', 'Last_Msg'],
    rows: [['4165550100', 'keep these notes', 'old'], ['+14165550100', 'keep duplicate notes', 'old']],
  }] });
  const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];

  expect(request[0]).toBe('https://sheets.googleapis.com/v4/spreadsheets/synthetic-sheet/values:batchUpdate');

  const body = JSON.parse(String(request[1].body));

  expect(body.valueInputOption).toBe('RAW');
  expect(body.data).toHaveLength(4);
  expect(body.data.map((cell: { range: string }) => cell.range)).toEqual(['\'CRM\'!A2', '\'CRM\'!C2', '\'CRM\'!A3', '\'CRM\'!C3']);
  expect(body.data[1].values).toEqual([['=synthetic text']]);
});

it('adds a missing contact once per snapshot and updates that row on a repeat sync', async () => {
  const fetcher = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  const sheets = { token: 'synthetic-token', snapshots: [{
    definition: { spreadsheetId: 'synthetic-sheet', tab: 'CRM', role: 'inbound' as const },
    headers: ['Phone', 'Last_Msg'],
    rows: [] as string[][],
  }] };
  await syncContact(contact, sheets);
  await syncContact(contact, sheets);

  expect(sheets.snapshots[0]!.rows).toHaveLength(1);

  const requests = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;

  expect(requests.filter(([url]) => url.includes(':append'))).toHaveLength(1);
  expect(requests[1]![0]).toContain(':batchUpdate');
});
