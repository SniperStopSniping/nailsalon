import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values([
    { id: 'voice-a', name: 'Voice A', slug: 'voice-a' },
    { id: 'voice-b', name: 'Voice B', slug: 'voice-b' },
  ]);
});

function input(salonId: string, sequence: string) {
  return {
    id: `00000000-0000-4000-8000-${sequence.padStart(12, '0')}`,
    salonId,
    provider: 'twilio' as const,
    providerCallId: `CA${sequence.padStart(32, '0')}`,
    providerAccountSid: 'AC11111111111111111111111111111111',
    routeTokenHash: `hash-${sequence}`,
    routeExpiresAt: new Date(Date.now() + 180_000),
  };
}

describe('voice receptionist storage', () => {
  it('resolves only an operator-listed forwarding number on the assigned Twilio destination', async () => {
    const { resolveVoiceNumber } = await import('./storage.server');
    const accountSid = 'AC11111111111111111111111111111111';
    const destination = '+14165559444';
    const forwardedFrom = '+14165550123';
    await db.insert(schema.voiceNumberRouteSchema).values({ accountSid, phoneNumber: destination, forwardedFrom, salonId: 'voice-a' });

    await expect(resolveVoiceNumber(accountSid, destination, forwardedFrom)).resolves.toMatchObject({ salonId: 'voice-a' });
    await expect(resolveVoiceNumber(accountSid, destination, '+14165550999')).resolves.toBeNull();
    await expect(resolveVoiceNumber(accountSid, '+14165559999', forwardedFrom)).resolves.toBeNull();
    await expect(resolveVoiceNumber('AC22222222222222222222222222222222', destination, forwardedFrom)).resolves.toBeNull();
    await expect(db.insert(schema.voiceNumberRouteSchema).values({ accountSid, phoneNumber: destination, forwardedFrom: '+14165550999', salonId: 'voice-b' })).rejects.toThrow();
  });

  it('scopes calls by salon and makes a provider retry idempotent', async () => {
    const { createVoiceCall, getVoiceCall } = await import('./storage.server');
    const first = await createVoiceCall(input('voice-a', '1'));
    const retry = await createVoiceCall(input('voice-a', '1'));

    expect(first.created).toBe(true);
    expect(retry).toMatchObject({ created: false, call: { id: first.call.id, salonId: 'voice-a' } });
    expect(await getVoiceCall(first.call.id, 'voice-b')).toBeNull();
  });

  it('enforces a per-salon active admission cap without blocking another salon', async () => {
    const { createVoiceCall } = await import('./storage.server');
    await createVoiceCall(input('voice-a', '2'));

    await expect(createVoiceCall(input('voice-a', '3'))).rejects.toThrow('VOICE_ACTIVE_CALL_LIMIT');
    await expect(createVoiceCall(input('voice-b', '4'))).resolves.toMatchObject({ created: true, call: { salonId: 'voice-b' } });
  });

  it('fences writes to the scoped current lease', async () => {
    const { claimVoiceLease, createVoiceCall, releaseVoiceLease, renewVoiceLease, saveVoiceCall } = await import('./storage.server');
    const call = await createVoiceCall(input('voice-b', '5'));

    expect(await claimVoiceLease(call.call.id, 'lease-a')).not.toBeNull();
    expect(await saveVoiceCall(call.call.id, 'voice-a', 'lease-a', { summary: 'wrong tenant' })).toBeNull();
    expect(await saveVoiceCall(call.call.id, 'voice-b', 'wrong-lease', { summary: 'wrong lease' })).toBeNull();
    expect(await saveVoiceCall(call.call.id, 'voice-b', 'lease-a', { summary: 'saved' })).toMatchObject({ summary: 'saved' });
    expect(await releaseVoiceLease(call.call.id, 'voice-b', 'lease-a')).not.toBeNull();
    expect(await renewVoiceLease(call.call.id, 'voice-b', 'lease-a', 90_000, { liveSessionId: 'live-a' })).toBeNull();

    await db.update(schema.voiceCallSchema).set({
      status: 'connected',
      liveSessionId: 'live-a',
      leaseToken: 'lease-b',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }).where(eq(schema.voiceCallSchema.id, call.call.id));

    expect(await renewVoiceLease(call.call.id, 'voice-b', 'lease-b', 90_000, { liveSessionId: 'live-a' })).not.toBeNull();

    await db.update(schema.voiceCallSchema).set({ liveSessionId: 'live-b' }).where(eq(schema.voiceCallSchema.id, call.call.id));

    expect(await renewVoiceLease(call.call.id, 'voice-b', 'lease-b', 90_000, { liveSessionId: 'live-a' })).toBeNull();

    await db.update(schema.voiceCallSchema).set({
      status: 'awaiting_confirmation',
      draft: { confirmation: { id: 'checkpoint-a', stage: 'pending' } },
    }).where(eq(schema.voiceCallSchema.id, call.call.id));

    expect(await renewVoiceLease(call.call.id, 'voice-b', 'lease-b', 90_000, { checkpointId: 'checkpoint-a' })).toBeNull();
  });

  it('terminalizes the locked latest draft without losing the recovery operation reference', async () => {
    const { finishVoiceCallFromProvider } = await import('./storage.server');
    await db.insert(schema.voiceCallSchema).values({
      ...input('voice-b', '7'),
      draft: {
        messages: ['raw conversation'],
        contact: { email: 'private@example.test' },
        consentHash: 'consent',
        booking: { operation: { capability: 'canonical-operation' } },
        confirmation: { id: 'checkpoint-b', stage: 'committing' },
      },
    });

    const finished = await finishVoiceCallFromProvider('AC11111111111111111111111111111111', `CA${'7'.padStart(32, '0')}`, 24);

    expect(finished).toMatchObject({ status: 'completed', durationSeconds: 24, draft: { consentHash: 'consent', booking: { operation: { capability: 'canonical-operation' } } } });
    expect(JSON.stringify(finished?.draft)).not.toContain('raw conversation');
    expect(JSON.stringify(finished?.draft)).not.toContain('private@example.test');
  });

  it('retains only the redacted recovery reference at deadline and clears it after retention', async () => {
    const { cleanupExpiredVoiceCallData, expireOverdueVoiceCalls } = await import('./storage.server');
    const createdAt = new Date(Date.now() - 13 * 60_000);
    await db.insert(schema.voiceCallSchema).values({
      ...input('voice-b', '6'),
      createdAt,
      updatedAt: createdAt,
      status: 'accepting',
      draft: { messages: ['raw'], contact: { email: 'private@example.test' }, consentHash: 'consent', booking: { operation: { capability: 'cap' } }, confirmation: { stage: 'committing' } },
    });
    const [expired] = await expireOverdueVoiceCalls(new Date());

    expect(expired).toMatchObject({ status: 'dropped' });
    expect(expired?.draft).toMatchObject({ consentHash: 'consent', confirmation: { stage: 'committing' } });
    expect(JSON.stringify(expired?.draft)).not.toContain('private@example.test');
    expect(JSON.stringify(expired?.draft)).not.toContain('raw');

    const afterRetention = new Date(Date.now() + 31 * 24 * 60 * 60_000);
    await cleanupExpiredVoiceCallData(afterRetention);
    const [stored] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, expired!.id));

    expect(stored?.draft).toBeNull();
  });
});
