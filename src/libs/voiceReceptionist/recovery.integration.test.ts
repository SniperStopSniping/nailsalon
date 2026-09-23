import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const mocks = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), status: vi.fn() }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({ readCustomerBookingOperation: mocks.read }));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
vi.mock('./storage.server', () => ({ getVoiceCall: mocks.get, redactVoiceDraft: (state: unknown) => state }));

const { reconcileUnresolvedVoiceBookings } = await import('./recovery.server');

const salonId = 'recovery-salon';
const otherSalonId = 'recovery-other-salon';
const now = new Date('2026-09-22T12:00:00.000Z');
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const callById = new Map<string, Record<string, unknown>>();

function id(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function draft(callId: string) {
  return {
    consentHash: 'confirmed',
    booking: { operation: { capability: `cap-${callId}` } },
    confirmation: { id: `checkpoint-${callId}`, stage: 'committing' },
  };
}

async function seedCall(args: { callId: string; salonId: string }) {
  const value = {
    id: args.callId,
    salonId: args.salonId,
    provider: 'twilio' as const,
    providerCallId: `CA${args.callId.replaceAll('-', '')}`,
    providerAccountSid: 'AC11111111111111111111111111111111',
    routeTokenHash: `route-${args.callId}`,
    routeExpiresAt: new Date(now.getTime() + 60_000),
    status: 'awaiting_confirmation',
    draft: draft(args.callId),
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.voiceCallSchema).values(value);
  callById.set(args.callId, { ...value, endedAt: null, leaseExpiresAt: null });
}

async function seedOperation(args: { operationId: string; salonId: string; sessionId: string; appointmentId: string | null }) {
  await db.insert(schema.customerBookingOperationSchema).values({
    id: args.operationId,
    salonId: args.salonId,
    sessionId: args.sessionId,
    requestHash: `request-${args.operationId}`,
    contactBinding: `contact-${args.operationId}`,
    material: {} as never,
    appointmentId: args.appointmentId,
    committedAt: args.appointmentId ? now : null,
    reviewExpiresAt: new Date(now.getTime() + 60_000),
    recoveryExpiresAt: new Date(now.getTime() + 120_000),
    createdAt: now,
    updatedAt: now,
  });
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await db.insert(schema.salonSchema).values([
    { id: salonId, name: 'Recovery Salon', slug: salonId },
    { id: otherSalonId, name: 'Recovery Other', slug: otherSalonId },
  ]);
  await db.insert(schema.appointmentSchema).values({
    id: 'appointment-linked',
    salonId,
    clientPhone: '+14165550100',
    startTime: new Date('2026-09-23T16:00:00.000Z'),
    endTime: new Date('2026-09-23T17:00:00.000Z'),
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
});

afterAll(async () => client?.close());

describe('voice recovery maintenance selection', () => {
  it('selects and completes a later tenant-linked booking after more than fifty unresolved rows', async () => {
    vi.clearAllMocks();
    callById.clear();
    const unlinked = Array.from({ length: 51 }, (_, index) => id(index + 1));
    const linked = id(100);
    const wrongTenant = id(101);

    for (const [index, callId] of unlinked.entries()) {
      await seedCall({ callId, salonId });
      await seedOperation({ operationId: id(index + 200), salonId, sessionId: callId, appointmentId: null });
    }
    await seedCall({ callId: linked, salonId });
    await seedOperation({ operationId: id(400), salonId, sessionId: linked, appointmentId: 'appointment-linked' });
    await seedCall({ callId: wrongTenant, salonId });
    await seedOperation({ operationId: id(401), salonId: otherSalonId, sessionId: wrongTenant, appointmentId: 'appointment-wrong-tenant' });

    mocks.get.mockImplementation(async (callId: string, scopedSalonId: string) => {
      const call = callById.get(callId);
      return call?.salonId === scopedSalonId ? call : null;
    });
    mocks.read.mockImplementation(async ({ capability }: { capability: string }) => {
      const callId = capability.slice('cap-'.length);
      return { sessionId: callId, appointmentId: 'appointment-linked' };
    });
    mocks.status.mockResolvedValue({ status: 'confirmed', appointment: { id: 'appointment-linked' } });

    await reconcileUnresolvedVoiceBookings('voice-secret');

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(linked, salonId);
    expect(mocks.read).toHaveBeenCalledWith({ salonId, capability: `cap-${linked}`, secret: 'voice-secret' });

    const [completed] = await db.select().from(schema.voiceCallSchema).where(eq(schema.voiceCallSchema.id, linked));

    expect(completed).toMatchObject({ salonId, status: 'completed', appointmentId: 'appointment-linked', outcome: 'booked' });

    const unresolved = await db.select({ id: schema.voiceCallSchema.id, status: schema.voiceCallSchema.status })
      .from(schema.voiceCallSchema)
      .where(and(eq(schema.voiceCallSchema.salonId, salonId), eq(schema.voiceCallSchema.status, 'awaiting_confirmation')));

    expect(unresolved).toHaveLength(52);
    expect(unresolved.map(row => row.id)).toContain(wrongTenant);
  });
});
