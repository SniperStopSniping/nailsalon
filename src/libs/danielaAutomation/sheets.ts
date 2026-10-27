import 'server-only';

import type { DanielaConfig } from './config';
import { googleToken } from './googleAuth';
import { inboundKeyword, normalizePhone, torontoParts } from './policy';
import type { Contact, ImportedContact } from './store';

type SheetDefinition = DanielaConfig['sheets'][number];
export type SheetSnapshot = { definition: SheetDefinition; headers: string[]; rows: string[][] };
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gu, '');
const flag = (value: string) => /^(?:true|yes|1|blocked|opted.?out)$/iu.test(value.trim());
const optOut = (value: string) => /\b(?:STOP|STOPALL|UNSUBSCRIBE|OPT[ _-]?OUT|DO NOT (?:TEXT|CONTACT)|NO SMS)\b/iu.test(value);

/** Timestamp fields require offsets; legacy date-only entries use the end of that Toronto day. */
export function sheetDate(value: string): Date | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    // Conservative end of day; this cannot shorten the existing reply cooldown.
    return new Date(`${text}T23:59:59-05:00`);
  }
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(text)) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const maxDate = (dates: Array<Date | null>) => dates.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;

/** Aggregate ALL rows from BOTH sheets before deciding eligibility. STOP always wins an ambiguous import. */
export function parseSheets(snapshots: SheetSnapshot[]): ImportedContact[] {
  const grouped = new Map<string, ImportedContact>();
  for (const snapshot of snapshots) {
    if (!snapshot.headers.some(header => key(header) === 'phone')) {
      throw new Error('SHEET_PHONE_COLUMN_REQUIRED');
    }
    snapshot.rows.forEach((cells, index) => {
      const values = Object.fromEntries(snapshot.headers.map((header, col) => [key(header), String(cells[col] || '')]));
      const phone = normalizePhone(values.phone || '');
      if (!phone) {
        return;
      }
      const previous = grouped.get(phone);
      const attempted = values.bookingpromoattemptedat || '';
      const accepted = values.bookingpromosentat || '';
      const inbound = sheetDate(values.lastinboundiso || '');
      const newestInbound = maxDate([inbound, previous?.lastInboundAt || null]);
      const message = values.lastmsg || '';
      const blocked = flag(values.blocked || '');
      const optedOut = flag(values.optout || '') || inboundKeyword(message) === 'stop'
        || optOut(`${values.notes || ''} ${values.promo || ''}`);
      const fromPrimary = snapshot.definition.role === 'primary';
      grouped.set(phone, {
        phone,
        blocked: blocked || !!previous?.blocked,
        optedOut: optedOut || !!previous?.optedOut,
        campaignEligible: fromPrimary || !!previous?.campaignEligible,
        rowOrder: Math.min(fromPrimary ? index + 2 : 2147483647, previous?.rowOrder || 2147483647),
        lastBookingAt: maxDate([sheetDate(values.lastbookingtextiso || ''), sheetDate(values.lastautotextiso || ''), sheetDate(values.lastautotextdate || ''), previous?.lastBookingAt || null]),
        promoAttemptedAt: previous?.promoAttemptedAt || (attempted ? sheetDate(attempted) || new Date(0) : null) || (accepted ? sheetDate(accepted) || new Date(0) : null),
        promoAcceptedAt: maxDate([previous?.promoAcceptedAt || null, accepted ? sheetDate(accepted) || new Date(0) : null]),
        lastInboundAt: newestInbound,
        lastMessage: inbound && newestInbound === inbound ? message : previous?.lastMessage || message || null,
        lastInboundSid: inbound && newestInbound === inbound ? values.lastinboundmessagesid || null : previous?.lastInboundSid || null,
      });
    });
  }
  return [...grouped.values()];
}

function tabRange(definition: SheetDefinition): string {
  return `'${definition.tab.replace(/'/gu, '\'\'')}'`;
}

async function api(token: string, definition: SheetDefinition, suffix: string, init?: RequestInit): Promise<{ values?: string[][] }> {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${definition.spreadsheetId}/values${suffix}`, {
    ...init,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('SHEETS_REQUEST_FAILED');
  }
  return response.json();
}

export async function readSheets(config: DanielaConfig): Promise<{ snapshots: SheetSnapshot[]; token: string }> {
  const token = await googleToken();
  const snapshots = await Promise.all(config.sheets.map(async (definition) => {
    const data = await api(token, definition, `/${encodeURIComponent(`${tabRange(definition)}!A1:ZZ10000`)}`);
    const all = data.values || [];
    if (!all.length || all.length >= 10000) {
      throw new Error('SHEET_EMPTY_OR_TRUNCATED');
    }
    return { definition, headers: all[0]!, rows: all.slice(1) };
  }));
  return { token, snapshots };
}

function columnName(index: number): string {
  let col = index + 1;
  let result = '';
  while (col > 0) {
    col -= 1;
    result = String.fromCharCode(65 + col % 26) + result;
    col = Math.floor(col / 26);
  }
  return result;
}

export function contactColumns(contact: Contact): Record<string, string> {
  const local = contact.lastBookingAt ? torontoParts(contact.lastBookingAt) : null;
  return {
    phone: contact.phone,
    lastautotextiso: contact.lastBookingAt?.toISOString() || '',
    lastautotextdate: local?.date || '',
    lastautotexttime: local?.time || '',
    lastbookingtextiso: contact.lastBookingAt?.toISOString() || '',
    lastinboundiso: contact.lastInboundAt?.toISOString() || '',
    lastinboundmessagesid: contact.lastInboundSid || '',
    lastmsg: contact.lastMessage || '',
    ...(contact.lastSource ? { source: contact.lastSource === 'call' ? 'Phone call / missed call' : 'SMS' } : {}),
    bookingpromoattemptedat: contact.promoAttemptedAt?.toISOString() || '',
    bookingpromosentat: contact.promoAcceptedAt?.toISOString() || '',
    optout: contact.providerOptOut ? 'TRUE' : 'FALSE',
    blocked: contact.blocked ? 'TRUE' : 'FALSE',
    status: contact.providerOptOut ? 'opted_out' : contact.lastBookingAt ? 'booking_sent' : 'inbound',
    ...(contact.lastBookingAt
      ? {
          lastoutboundtype: 'booking_link',
          lastoutboundiso: contact.lastBookingAt.toISOString(),
          awaitingreplytype: 'booking_inquiry',
          awaitingreplyuntil: new Date(contact.lastBookingAt.getTime() + 72 * 3600_000).toISOString(),
        }
      : {}),
  };
}

/** Write only known cells, using RAW values; preserve owner notes, formulas and unrelated columns. */
export async function syncContact(contact: Contact, sheets: { token: string; snapshots: SheetSnapshot[] }): Promise<void> {
  const values = contactColumns(contact);
  for (const snapshot of sheets.snapshots) {
    const phoneCol = snapshot.headers.findIndex(header => key(header) === 'phone');
    if (phoneCol < 0) {
      throw new Error('SHEET_PHONE_COLUMN_REQUIRED');
    }
    const matching = snapshot.rows.map((row, index) => ({ row, rowNumber: index + 2 })).filter(item => normalizePhone(item.row[phoneCol] || '') === contact.phone);
    if (!matching.length) {
      const newRow = snapshot.headers.map(header => values[key(header)] || '');
      await api(sheets.token, snapshot.definition, `/${encodeURIComponent(`${tabRange(snapshot.definition)}!A:ZZ`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: [newRow] }),
      });
      snapshot.rows.push(newRow);
      continue;
    }
    const data = matching.flatMap(item => snapshot.headers.flatMap((header, col) => {
      const value = values[key(header)];
      return value === undefined ? [] : [{ range: `${tabRange(snapshot.definition)}!${columnName(col)}${item.rowNumber}`, values: [[value]] }];
    }));
    await api(sheets.token, snapshot.definition, ':batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }
}
