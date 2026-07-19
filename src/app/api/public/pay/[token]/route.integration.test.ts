/**
 * Payment-link + public pay page integration (PGlite, real SQL, real routes).
 * Pins the security contract: 256-bit token, hashed at rest, revoked on full
 * payment; the public payload never contains client PII.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { POST as mintPaymentLink } from '../../../appointments/[id]/payment-link/route';
import { POST as recordPayment } from '../../../appointments/[id]/payments/route';
import { GET as getPayPage } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  access: { actorRole: 'admin' as const, salonId: 'salon_pay' },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: vi.fn(async (appointmentId: string) => {
    const db = holder.db as ReturnType<typeof drizzle<typeof schema>>;
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, appointmentId))
      .limit(1);
    if (!appointment) {
      return {
        ok: false,
        response: Response.json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'not found' } }, { status: 404 }),
      };
    }
    return {
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_pay', name: 'Pay Admin' },
      appointment,
    };
  }),
}));

vi.mock('@/libs/fraudDetection', () => ({
  evaluateAndFlagIfNeeded: vi.fn(async () => undefined),
}));

const SALON_ID = 'salon_pay';
const APPT_ID = 'appt_pay_1';
const OTHER_APPT_ID = 'appt_pay_2';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Pay Salon',
    slug: 'pay-salon',
    settings: {
      payments: {
        etransfer: {
          enabled: true,
          recipient: 'pay@paysalon.ca',
          recipientName: 'Pay Salon',
          qrPageEnabled: true,
          requireReference: true,
          instructions: 'Include the reference.',
        },
      },
    },
  });
  await db.insert(schema.appointmentSchema).values([
    {
      id: APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550177',
      clientName: 'Private Client Name',
      startTime: new Date('2026-07-10T14:00:00Z'),
      endTime: new Date('2026-07-10T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-10T15:00:00Z'),
      totalPrice: 10000,
      totalDurationMinutes: 60,
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: 0,
    },
    {
      id: OTHER_APPT_ID,
      salonId: SALON_ID,
      clientPhone: '4165550178',
      startTime: new Date('2026-07-11T14:00:00Z'),
      endTime: new Date('2026-07-11T15:00:00Z'),
      status: 'completed',
      completedAt: new Date('2026-07-11T15:00:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      tipCents: 0,
      paymentStatus: 'pending',
      amountPaidCents: 0,
    },
  ]);
}, 60_000);

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(async () => {
  await client.close();
});

async function mintToken(appointmentId: string): Promise<string> {
  const response = await mintPaymentLink(
    new Request('http://localhost/api/appointments/x/payment-link', { method: 'POST' }),
    { params: { id: appointmentId } },
  );

  expect(response.status).toBe(200);

  const { data } = await response.json();
  return String(data.url).split('/pay/')[1]!;
}

describe('payment link + public pay page', () => {
  it('serves salon-side payment facts only — never client PII', async () => {
    const token = await mintToken(APPT_ID);

    const response = await getPayPage(
      new Request(`http://localhost/api/public/pay/${token}`),
      { params: { token } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      salonName: 'Pay Salon',
      amountDueCents: 11300, // 10000 + 1300 tax, nothing paid
      isFinalized: true,
      recipient: 'pay@paysalon.ca',
    });
    expect(body.data.reference).toMatch(/^LSTR-/);

    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('Private Client Name');
    expect(serialized).not.toContain('4165550177');
  });

  it('stores only the token hash, and a token cannot reach another appointment', async () => {
    const token = await mintToken(APPT_ID);

    const [link] = await db
      .select()
      .from(schema.appointmentPaymentLinkSchema)
      .where(eq(schema.appointmentPaymentLinkSchema.appointmentId, APPT_ID));

    expect(link!.tokenHash).not.toContain(token);

    // A token for appointment 1 resolves ONLY appointment 1's amounts — mint a
    // token for appointment 2 and confirm the payloads differ; garbage 404s.
    const otherToken = await mintToken(OTHER_APPT_ID);
    const otherResponse = await getPayPage(
      new Request(`http://localhost/api/public/pay/${otherToken}`),
      { params: { token: otherToken } },
    );

    expect((await otherResponse.json()).data.amountDueCents).toBe(5000);

    const garbage = await getPayPage(
      new Request('http://localhost/api/public/pay/not-a-token'),
      { params: { token: 'not-a-token' } },
    );

    expect(garbage.status).toBe(404);
  });

  it('revokes the link once the balance is fully paid', async () => {
    const token = await mintToken(APPT_ID);

    const paymentResponse = await recordPayment(
      new Request('http://localhost/api/appointments/x/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: 11300, method: 'e_transfer' }),
      }),
      { params: { id: APPT_ID } },
    );

    expect(paymentResponse.status).toBe(200);
    expect((await paymentResponse.json()).data.paymentStatus).toBe('paid');

    const afterPaid = await getPayPage(
      new Request(`http://localhost/api/public/pay/${token}`),
      { params: { token } },
    );

    expect(afterPaid.status).toBe(404);
  });

  it('minting again supersedes the previous link', async () => {
    const first = await mintToken(OTHER_APPT_ID);
    const second = await mintToken(OTHER_APPT_ID);

    const firstResponse = await getPayPage(
      new Request(`http://localhost/api/public/pay/${first}`),
      { params: { token: first } },
    );
    const secondResponse = await getPayPage(
      new Request(`http://localhost/api/public/pay/${second}`),
      { params: { token: second } },
    );

    expect(firstResponse.status).toBe(404);
    expect(secondResponse.status).toBe(200);
  });
});
