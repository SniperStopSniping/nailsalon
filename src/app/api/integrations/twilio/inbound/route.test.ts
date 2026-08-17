/**
 * B3 inbound webhook — shared/BYO discrimination, global STOP/START,
 * CANCEL-never-cancels, no-body retention, deterministic attribution,
 * signature-first, provider-SID idempotency.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  TWILIO_AUTH_TOKEN: 'platform-token' as string | undefined,
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111' as string | undefined,
  LUSTER_SMS_SENDER_IDENTITY: undefined as string | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const signatureHolder = vi.hoisted(() => ({ valid: true }));

vi.mock('twilio', () => ({
  default: { validateRequest: vi.fn(() => signatureHolder.valid) },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

const SHARED_MS = 'MG11111111111111111111111111111111';
let sidSeq = 0;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values([
    { id: 'ib1', name: 'Inbound One', slug: 'inbound-one' },
    { id: 'ib2', name: 'Inbound Two', slug: 'inbound-two' },
  ]);
  await db.insert(schema.salonTwilioConnectionSchema).values({
    salonId: 'ib1',
    connectAccountSid: 'AC00000000000000000000000000000001',
    phoneNumber: '+14165559999',
    status: 'active',
  });
});

beforeEach(() => {
  signatureHolder.valid = true;
  envHolder.TWILIO_MESSAGING_SERVICE_SID = SHARED_MS;
});

function inboundRequest(fields: Record<string, string>) {
  sidSeq += 1;
  const body = new URLSearchParams({
    MessageSid: `SM_ib_${sidSeq}`,
    From: '+14165553000',
    To: '+14165550001',
    ...fields,
  });
  return new Request('https://x.test/api/integrations/twilio/inbound', {
    method: 'POST',
    headers: {
      'x-twilio-signature': 'sig',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

async function count(table: string, where = 'TRUE'): Promise<number> {
  const rows = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`));
  return Number((rows.rows[0] as Record<string, unknown>).n);
}

async function seedSentIntent(salonId: string, recipient: string): Promise<void> {
  await db.insert(schema.communicationIntentSchema).values({
    id: `ci_attr_${salonId}_${crypto.randomUUID().slice(0, 8)}`,
    salonId,
    channel: 'sms',
    eventType: 'booking_confirmation',
    audience: 'client',
    dedupeKey: `attr:${salonId}:${crypto.randomUUID()}`,
    recipient,
    templateKey: 'client_booking_confirmation_shortlink',
    templateVersion: 'v1',
    variables: {},
    schedulingRevision: 'rev1',
    status: 'sent',
    scheduledFor: new Date(Date.now() - 60 * 60 * 1000),
    availableAt: new Date(Date.now() - 60 * 60 * 1000),
    notAfter: new Date(Date.now() + 60 * 60 * 1000),
  });
}

describe('inbound webhook — shared/BYO split', () => {
  it('invalid signature: 403 and ZERO mutation on either branch', async () => {
    signatureHolder.valid = false;
    const { POST } = await import('./route');
    const response = await POST(inboundRequest({ Body: 'STOP', MessagingServiceSid: SHARED_MS }));

    expect(response.status).toBe(403);
    expect(await count('sms_global_consent_event')).toBe(0);
    expect(await count('sms_inbound_event')).toBe(0);
    expect(await count('communication_consent')).toBe(0);
  });

  it('BYO branch stays byte-identical: STOP writes the per-salon revoked row with metadata, nothing global', async () => {
    const { POST } = await import('./route');
    // No MessagingServiceSid → BYO path via account-SID connection lookup.
    const response = await POST(inboundRequest({
      Body: 'STOP',
      AccountSid: 'AC00000000000000000000000000000001',
      From: '+14165553001',
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    const rows = await db.execute(sql`
      SELECT salon_id, recipient, status, metadata FROM communication_consent WHERE recipient = '4165553001'
    `);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ salon_id: 'ib1', status: 'revoked' });
    expect((rows.rows[0] as { metadata: Record<string, unknown> }).metadata).toEqual({ keyword: 'STOP', optOutType: null });

    expect(await count('sms_global_consent_event')).toBe(0);
    expect(await count('sms_inbound_event')).toBe(0);
  });

  it('BYO branch also serves shared-shaped traffic when the platform SID is UNSET (discriminator is env-first)', async () => {
    envHolder.TWILIO_MESSAGING_SERVICE_SID = undefined;
    const { POST } = await import('./route');
    await POST(inboundRequest({
      Body: 'STOP',
      MessagingServiceSid: SHARED_MS,
      AccountSid: 'AC00000000000000000000000000000001',
      From: '+14165553002',
    }));

    expect(await count('sms_global_consent_event')).toBe(0);
    expect(await count('communication_consent', `recipient = '4165553002'`)).toBe(1);
  });

  it('shared STOP: appends a GLOBAL suppression + evidence row and NEVER touches per-salon consent', async () => {
    const { POST } = await import('./route');
    await POST(inboundRequest({ Body: 'stop', MessagingServiceSid: SHARED_MS, From: '+14165553003' }));

    const events = await db.execute(sql`
      SELECT sender_identity, recipient, state FROM sms_global_consent_event WHERE recipient = '4165553003'
    `);

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      sender_identity: 'luster_shared_v1',
      state: 'suppressed',
    });
    expect(await count('communication_consent', `recipient = '4165553003'`)).toBe(0);

    const evidence = await db.execute(sql`
      SELECT keyword_classification, body_present FROM sms_inbound_event WHERE from_recipient = '4165553003'
    `);

    expect(evidence.rows[0]).toMatchObject({ keyword_classification: 'stop', body_present: true });
  });

  it('shared CANCEL: opts out globally and the appointment row is BYTE-IDENTICAL', async () => {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(schema.appointmentSchema).values({
      id: 'apt_cancel_probe',
      salonId: 'ib1',
      clientName: 'Cancel Probe',
      clientPhone: '4165553004',
      startTime: start,
      endTime: new Date(start.getTime() + 3600000),
      status: 'confirmed',
      totalPrice: 80,
      totalDurationMinutes: 60,
    });
    const before = await db.execute(sql`SELECT * FROM appointment WHERE id = 'apt_cancel_probe'`);
    const { POST } = await import('./route');
    await POST(inboundRequest({ Body: 'CANCEL', MessagingServiceSid: SHARED_MS, From: '+14165553004' }));
    const after = await db.execute(sql`SELECT * FROM appointment WHERE id = 'apt_cancel_probe'`);

    expect(after.rows).toEqual(before.rows);

    const events = await db.execute(sql`
      SELECT state FROM sms_global_consent_event WHERE recipient = '4165553004'
    `);

    expect(events.rows[0]).toMatchObject({ state: 'suppressed' });

    const evidence = await db.execute(sql`
      SELECT keyword_classification FROM sms_inbound_event WHERE from_recipient = '4165553004'
    `);

    expect(evidence.rows[0]).toMatchObject({ keyword_classification: 'cancel' });
  });

  it('shared START: restores GLOBAL eligibility only — no per-salon consent is granted', async () => {
    const { POST } = await import('./route');
    await POST(inboundRequest({ Body: 'STOP', MessagingServiceSid: SHARED_MS, From: '+14165553005' }));
    await POST(inboundRequest({ Body: 'START', MessagingServiceSid: SHARED_MS, From: '+14165553005' }));

    const events = await db.execute(sql`
      SELECT state FROM sms_global_consent_event WHERE recipient = '4165553005' ORDER BY seq
    `);

    expect(events.rows.map(row => (row as Record<string, unknown>).state)).toEqual(['suppressed', 'restored']);
    expect(await count('communication_consent', `recipient = '4165553005'`)).toBe(0);

    const { hasGlobalSuppression } = await import('@/libs/smsConsentShared');

    expect(await hasGlobalSuppression('luster_shared_v1', '4165553005')).toBe(false);
  });

  it('shared HELP and ordinary replies: evidence row only, zero consent mutation, NO body stored anywhere', async () => {
    const { POST } = await import('./route');
    await POST(inboundRequest({ Body: 'HELP', MessagingServiceSid: SHARED_MS, From: '+14165553006' }));
    const secret = 'my toe surgery is on thursday';
    await POST(inboundRequest({ Body: secret, MessagingServiceSid: SHARED_MS, From: '+14165553007' }));

    expect(await count('sms_global_consent_event', `recipient IN ('4165553006','4165553007')`)).toBe(0);
    expect(await count('communication_consent', `recipient IN ('4165553006','4165553007')`)).toBe(0);

    const help = await db.execute(sql`
      SELECT keyword_classification FROM sms_inbound_event WHERE from_recipient = '4165553006'
    `);

    expect(help.rows[0]).toMatchObject({ keyword_classification: 'help' });

    const ordinary = await db.execute(sql`
      SELECT to_jsonb(sms_inbound_event.*) AS row FROM sms_inbound_event WHERE from_recipient = '4165553007'
    `);

    expect(ordinary.rows).toHaveLength(1);

    const serialized = JSON.stringify((ordinary.rows[0] as { row: unknown }).row);

    expect(serialized).not.toContain('toe surgery');
    expect((ordinary.rows[0] as { row: { keyword_classification: string; body_present: boolean } }).row)
      .toMatchObject({ keyword_classification: 'other', body_present: true });
  });

  it('attribution: 0 recent senders → unattributed; 1 → attributed; 2 → ambiguous (never a guess)', async () => {
    const { POST } = await import('./route');
    await POST(inboundRequest({ Body: 'thanks', MessagingServiceSid: SHARED_MS, From: '+14165553008' }));

    await seedSentIntent('ib1', '4165553009');
    await POST(inboundRequest({ Body: 'thanks', MessagingServiceSid: SHARED_MS, From: '+14165553009' }));

    await seedSentIntent('ib1', '4165553010');
    await seedSentIntent('ib2', '4165553010');
    await POST(inboundRequest({ Body: 'thanks', MessagingServiceSid: SHARED_MS, From: '+14165553010' }));

    const rows = await db.execute(sql`
      SELECT from_recipient, attribution_state, attributed_salon_id FROM sms_inbound_event
      WHERE from_recipient IN ('4165553008','4165553009','4165553010') ORDER BY from_recipient
    `);

    expect(rows.rows).toEqual([
      expect.objectContaining({ from_recipient: '4165553008', attribution_state: 'unattributed', attributed_salon_id: null }),
      expect.objectContaining({ from_recipient: '4165553009', attribution_state: 'attributed', attributed_salon_id: 'ib1' }),
      expect.objectContaining({ from_recipient: '4165553010', attribution_state: 'ambiguous', attributed_salon_id: null }),
    ]);
  });

  it('replayed provider SID: exactly one evidence row (idempotent)', async () => {
    const { POST } = await import('./route');
    const fields = { Body: 'ok', MessagingServiceSid: SHARED_MS, From: '+14165553011', MessageSid: 'SM_ib_replay' };
    await POST(inboundRequest(fields));
    await POST(inboundRequest(fields));

    expect(await count('sms_inbound_event', `provider_sid = 'SM_ib_replay'`)).toBe(1);
  });
});
