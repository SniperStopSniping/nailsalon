import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

let db: ReturnType<typeof drizzle<typeof schema>>;
const oldOrigin = process.env.PUBLIC_APP_URL;
const oldSecret = process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;

beforeAll(async () => {
  process.env.PUBLIC_APP_URL = 'https://www.lustergel.app';
  process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = 's'.repeat(40);
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values([
    { id: 'voice-link-a', name: 'Synthetic Isla', slug: 'synthetic-isla' },
    { id: 'voice-link-b', name: 'Other Salon', slug: 'other-salon' },
  ]);
});

afterAll(() => {
  if (oldOrigin === undefined) {
    delete process.env.PUBLIC_APP_URL;
  } else {
    process.env.PUBLIC_APP_URL = oldOrigin;
  }
  if (oldSecret === undefined) {
    delete process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
  } else {
    process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = oldSecret;
  }
});

let sequence = 0;
async function liveCall(phone = '4165550100') {
  sequence += 1;
  const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const pendingId = `pending-${sequence}`;
  await db.insert(schema.voiceCallSchema).values({
    id,
    salonId: 'voice-link-a',
    provider: 'twilio',
    providerCallId: `CAvoice-link-${sequence}`,
    routeTokenHash: `hash-${sequence}`,
    routeExpiresAt: new Date(Date.now() + 60_000),
    liveSessionId: `live-${sequence}`,
    status: 'connected',
    leaseToken: `lease-${sequence}`,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    draft: { booking: { operation: null }, bookingStatus: null, bookingLinkPending: { id: pendingId, phone, afterMs: 100 } },
  });
  return { salonId: 'voice-link-a', callId: id, leaseToken: `lease-${sequence}`, liveSessionId: `live-${sequence}`, pendingId, phone };
}

async function attachPreparedOperation(input: Awaited<ReturnType<typeof liveCall>>) {
  const id = `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const fingerprint = `prepared-request-${sequence}`;
  const expiresAt = new Date(Date.now() + 60_000);
  await db.insert(schema.customerBookingOperationSchema).values({
    id,
    salonId: input.salonId,
    sessionId: input.callId,
    requestHash: fingerprint,
    contactBinding: `prepared-contact-${sequence}`,
    material: {} as never,
    reviewExpiresAt: expiresAt,
    recoveryExpiresAt: new Date(expiresAt.getTime() + 60_000),
  });
  const [call] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, input.callId));
  await db.update(schema.voiceCallSchema).set({
    draft: {
      ...(call!.draft as Record<string, unknown>),
      booking: {
        ...((call!.draft as { booking: Record<string, unknown> }).booking),
        operation: { capability: 'opaque-prepared-operation', revision: 1, fingerprint, expiresAt: expiresAt.toISOString() },
      },
    },
  }).where(eq(schema.voiceCallSchema.id, input.callId));
  return { id, fingerprint };
}

describe('requested voice booking link', () => {
  it('queues one public link directly to the caller ID only for the same leased call', async () => {
    const { queueVoiceBookingLink } = await import('./bookingLink.server');
    const input = await liveCall();
    await db.update(schema.voiceCallSchema).set({
      callerNumber: '+14165550100',
      draft: { booking: { operation: null }, bookingStatus: null, bookingLinkPending: null, bookingLinkAttempted: false },
    }).where(eq(schema.voiceCallSchema.id, input.callId));
    const request = { salonId: input.salonId, callId: input.callId, leaseToken: input.leaseToken, liveSessionId: input.liveSessionId, callerId: true as const, phone: input.phone };

    await expect(queueVoiceBookingLink({ ...request, phone: '4165550101' })).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');
    await expect(queueVoiceBookingLink({ ...request, salonId: 'voice-link-b' })).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    const queued = await queueVoiceBookingLink(request);
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, queued.intentId));

    expect(intent).toMatchObject({ salonId: input.salonId, recipient: input.phone, eventType: 'voice_booking_link' });
    await expect(queueVoiceBookingLink(request)).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');
  });

  it('rolls back an interrupted request even when interruption arrives after the intent insert', async () => {
    const { queueVoiceBookingLink } = await import('./bookingLink.server');
    const input = await liveCall();
    let checks = 0;

    await expect(queueVoiceBookingLink({ ...input, isCurrent: () => ++checks < 3 })).rejects.toThrow('VOICE_BOOKING_LINK_TURN_SUPERSEDED');

    const intents = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.dedupeKey, `voice-booking-link:${input.salonId}:${input.callId}`));
    const [call] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, input.callId));

    expect(intents).toHaveLength(0);
    expect((call?.draft as Record<string, unknown>).bookingLinkAuthority).toBeUndefined();
  });

  it('queues one tenant-owned public URL without creating broad appointment consent', async () => {
    const { queueVoiceBookingLink, hasVoiceBookingLinkAuthority } = await import('./bookingLink.server');
    const input = await liveCall();
    const queued = await queueVoiceBookingLink(input);
    const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, queued.intentId));
    const [call] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, input.callId));
    const consents = await db.select().from(schema.communicationConsentSchema).where(eq(schema.communicationConsentSchema.salonId, input.salonId));

    expect(queued.created).toBe(true);
    expect(intent).toMatchObject({ salonId: input.salonId, eventType: 'voice_booking_link', recipient: input.phone, destinationCountry: 'CA', appointmentId: null, templateKey: 'client_voice_booking_link' });
    expect(intent?.variables.bookingUrl).toBe('https://www.lustergel.app/en/synthetic-isla/book/service');
    expect(consents).toHaveLength(0);
    expect((call?.draft as Record<string, unknown>).bookingLinkPending).toBeNull();
    expect(await hasVoiceBookingLinkAuthority({ salonId: input.salonId, intentId: queued.intentId, callId: input.callId, recipient: input.phone })).toBe(false);

    await db.update(schema.voiceCallSchema).set({ status: 'completed', endedAt: new Date(Date.now() - 60_000) }).where(eq(schema.voiceCallSchema.id, input.callId));

    expect(await hasVoiceBookingLinkAuthority({ salonId: input.salonId, intentId: queued.intentId, callId: input.callId, recipient: input.phone })).toBe(true);
    expect(await hasVoiceBookingLinkAuthority({ salonId: 'voice-link-b', intentId: queued.intentId, callId: input.callId, recipient: input.phone })).toBe(false);
    expect(await hasVoiceBookingLinkAuthority({ salonId: input.salonId, intentId: queued.intentId, callId: input.callId, recipient: '4165550101' })).toBe(false);
    await expect(queueVoiceBookingLink(input)).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    await db.update(schema.voiceCallSchema).set({ draft: { bookingLinkAuthority: queued.authority, bookingStatus: { appointment: { id: 'booked-after-queue' } } } }).where(eq(schema.voiceCallSchema.id, input.callId));

    expect(await hasVoiceBookingLinkAuthority({ salonId: input.salonId, intentId: queued.intentId, callId: input.callId, recipient: input.phone })).toBe(false);

    await db.update(schema.voiceCallSchema).set({ draft: { bookingLinkAuthority: null } }).where(eq(schema.voiceCallSchema.id, input.callId));

    expect(await hasVoiceBookingLinkAuthority({ salonId: input.salonId, intentId: queued.intentId, callId: input.callId, recipient: input.phone })).toBe(false);
  });

  it('falls back only from the matching, unlinked canonical prepared operation', async () => {
    const { queueVoiceBookingLink } = await import('./bookingLink.server');
    const input = await liveCall();
    await attachPreparedOperation(input);

    const queued = await queueVoiceBookingLink(input);

    expect(queued.created).toBe(true);
  });

  it('fails closed when persisted consent or a checkpoint makes the prepared operation unresolved', async () => {
    const { queueVoiceBookingLink, voiceBookingLinkSendState } = await import('./bookingLink.server');
    const pending = await liveCall();
    await attachPreparedOperation(pending);
    const [pendingCall] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, pending.callId));
    await db.update(schema.voiceCallSchema).set({
      draft: {
        ...(pendingCall!.draft as Record<string, unknown>),
        consentHash: 'finalized-consent',
        confirmation: { id: 'checkpoint-pending', revision: 1, fingerprint: 'prepared-request', expiresAt: new Date(Date.now() + 60_000).toISOString(), language: 'en', stage: 'committing' },
      },
    }).where(eq(schema.voiceCallSchema.id, pending.callId));

    await expect(queueVoiceBookingLink(pending)).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    const dispatched = await liveCall();
    await attachPreparedOperation(dispatched);
    const queued = await queueVoiceBookingLink(dispatched);
    const [dispatchedCall] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, dispatched.callId));
    await db.update(schema.voiceCallSchema).set({
      status: 'completed',
      endedAt: new Date(Date.now() - 60_000),
      draft: {
        ...(dispatchedCall!.draft as Record<string, unknown>),
        consentHash: 'finalized-consent',
        confirmation: { id: 'checkpoint-dispatch', revision: 1, fingerprint: 'prepared-request', expiresAt: new Date(Date.now() + 60_000).toISOString(), language: 'en', stage: 'committing' },
      },
    }).where(eq(schema.voiceCallSchema.id, dispatched.callId));

    expect(await voiceBookingLinkSendState({ salonId: dispatched.salonId, intentId: queued.intentId, callId: dispatched.callId, recipient: dispatched.phone })).toBe('invalid');
  });

  it('rejects a stale prepared reference and suppresses a link when its operation later links an appointment', async () => {
    const { queueVoiceBookingLink, voiceBookingLinkSendState } = await import('./bookingLink.server');
    const stale = await liveCall();
    await attachPreparedOperation(stale);
    const [staleCall] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, stale.callId));
    await db.update(schema.voiceCallSchema).set({
      draft: {
        ...(staleCall!.draft as Record<string, unknown>),
        booking: {
          ...((staleCall!.draft as { booking: Record<string, unknown> }).booking),
          operation: { ...((staleCall!.draft as { booking: { operation: Record<string, unknown> } }).booking.operation), fingerprint: 'different-request' },
        },
      },
    }).where(eq(schema.voiceCallSchema.id, stale.callId));

    await expect(queueVoiceBookingLink(stale)).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    const committed = await liveCall();
    const committedOperation = await attachPreparedOperation(committed);
    await db.update(schema.customerBookingOperationSchema).set({ appointmentId: 'booked-before-link-queue', committedAt: new Date() })
      .where(eq(schema.customerBookingOperationSchema.id, committedOperation.id));

    await expect(queueVoiceBookingLink(committed)).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    const input = await liveCall();
    const operation = await attachPreparedOperation(input);
    const queued = await queueVoiceBookingLink(input);
    await db.update(schema.voiceCallSchema).set({ status: 'completed', endedAt: new Date(Date.now() - 60_000) }).where(eq(schema.voiceCallSchema.id, input.callId));
    await db.update(schema.customerBookingOperationSchema).set({ appointmentId: 'booked-after-link-queue', committedAt: new Date() })
      .where(eq(schema.customerBookingOperationSchema.id, operation.id));

    expect(await voiceBookingLinkSendState({ salonId: input.salonId, intentId: queued.intentId, callId: input.callId, recipient: input.phone })).toBe('invalid');
  });

  it('fences a wrong tenant, stale lease, unsupported destination, and completed booking', async () => {
    const { queueVoiceBookingLink } = await import('./bookingLink.server');
    const input = await liveCall();

    await expect(queueVoiceBookingLink({ ...input, salonId: 'voice-link-b' })).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');
    await expect(queueVoiceBookingLink({ ...input, leaseToken: 'stale-lease' })).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');
    await expect(queueVoiceBookingLink({ ...input, liveSessionId: 'old-session' })).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    await db.update(schema.voiceCallSchema).set({ draft: { booking: { operation: null }, bookingStatus: { appointment: { id: 'already-booked' } }, bookingLinkPending: { id: input.pendingId, phone: input.phone, afterMs: 100 } } }).where(eq(schema.voiceCallSchema.id, input.callId));

    await expect(queueVoiceBookingLink(input)).rejects.toThrow('VOICE_BOOKING_LINK_CALL_STALE');

    const unsupported = await liveCall('6465550100');

    await expect(queueVoiceBookingLink(unsupported)).rejects.toThrow('VOICE_BOOKING_LINK_DESTINATION_UNSUPPORTED');
  });
});
