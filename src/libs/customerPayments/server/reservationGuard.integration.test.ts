import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as recordPayment } from '@/app/api/appointments/[id]/payments/route';
import { runAppointmentManageMutation } from '@/libs/appointmentManage';
import { createDurableCheckoutFixture } from '@/libs/customerPayments/inactiveStripe/durableCheckoutTestSupport';
import { updateAppointmentStatus } from '@/libs/queries';
import * as schema from '@/models/Schema';

import { assertCustomerPaymentLifecycleMutable, assertCustomerPaymentServiceProgressionAllowed } from './lifecycleGuard';
import { assertCustomerPaymentReservationMutable, CustomerPaymentReservationBlockedError, customerPaymentReservationBlockedResponse, isCustomerPaymentReservationBlocked } from './reservationGuard';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ database: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.database;
} }));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess: vi.fn(async (appointmentId: string) => {
  const database = holder.database as ReturnType<typeof drizzle<typeof schema>>;
  const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId));
  return { ok: true, actorRole: 'admin', admin: { id: 'closed_guard_owner', name: 'Closed owner' }, appointment };
}) }));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
type Fixture = Awaited<ReturnType<typeof createDurableCheckoutFixture>>;
const sourceKeys = (f: Fixture) => [`salon:${f.salonId}`, `policy:${f.salonId}`, `capability:${f.tokenId}`, `binding:${f.bindingId}`, `binding_set:${f.salonId}`];
async function snapshot(f: Fixture) {
  return (await client.query<{ revisions: Record<string, number> }>('SELECT customer_payment_checkout_source_snapshot($1::text[]) AS revisions', [sourceKeys(f)])).rows[0]!.revisions;
}
async function reserve(f: Fixture, kind: 'sdk_closed_http_v1' | 'static_fixture_v1' = 'sdk_closed_http_v1') {
  const m = f.operation.material;
  await database.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE customer_payment_closed_checkout_operation IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    await tx.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId)).for('update');
    const revisions = (await tx.execute<{ revisions: Record<string, number> }>(sql`SELECT customer_payment_checkout_source_snapshot(ARRAY[${sql.join(sourceKeys(f).map(key => sql`${key}`), sql`, `)}]::text[]) AS revisions`)).rows[0]!.revisions;
    await tx.insert(schema.closedCheckoutOperationSchema).values({
      id: m.operationId,
      requestId: m.requestId,
      salonId: m.salonId,
      appointmentId: m.appointmentId,
      quoteId: m.quoteId,
      contextHash: m.contextHash,
      identityHash: f.operation.identityHash,
      parameterHash: f.operation.parameterHash,
      platformAccountId: f.operation.binding.platformAccountId,
      connectedAccountId: f.operation.binding.connectedAccountId,
      operationCreatedAt: new Date(m.createdAt),
      quoteExpiresAt: new Date(m.quoteExpiresAt),
      sessionExpiresAt: new Date(m.sessionExpiresAt),
      executionKind: kind,
      ...(kind === 'sdk_closed_http_v1' ? { capabilityId: f.tokenId, bindingId: f.bindingId, financialContextHash: 'f'.repeat(64), sourceRevisions: revisions, reconstruction: { version: 1 as const, returnTemplate: 'closed_invalid_v1' as const } } : {}),
    });
    await tx.insert(schema.closedCheckoutStateSchema).values({ operationId: m.operationId });
  });
}
async function fixture() {
  return createDurableCheckoutFixture(database as never);
}
async function blocked(query: Promise<unknown>) {
  try {
    await query;
    throw new Error('Expected reservation guard');
  } catch (error) {
    expect(isCustomerPaymentReservationBlocked(error)).toBe(true);
  }
}

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.database = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await client?.close();
});

describe('SDK financial reservation backstop', () => {
  it('leaves legacy static rows and unreserved appointments mutable', async () => {
    const f = await fixture();
    await reserve(f, 'static_fixture_v1');
    await database.update(schema.appointmentSchema).set({ totalPrice: 12000 }).where(eq(schema.appointmentSchema.id, f.appointmentId));

    await expect(assertCustomerPaymentReservationMutable(database, f.salonId, f.appointmentId)).resolves.toBeUndefined();
  });

  it('permits notes, delivery, display, calendar and arrival changes without changing source pins', async () => {
    const f = await fixture();
    await reserve(f);
    const before = await snapshot(f);
    await database.update(schema.appointmentSchema).set({ notes: 'Administrative note', techNotes: 'Internal note', clientName: 'Display', clientEmail: 'display@example.invalid', arrivedAt: new Date(), wasLate: true, googleCalendarSyncStatus: 'synced', dayBeforeReminderSentAt: new Date(), reviewFollowupAction: 'skipped', updatedAt: new Date() }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    await database.update(schema.salonStripeAccountSchema).set({ updatedAt: new Date(), lastSyncedAt: new Date() }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));

    expect(await snapshot(f)).toEqual(before);
  });

  it.each([
    'status=\'cancelled\'',
    'canvas_state=\'working\'',
    'cancel_reason=\'rescheduled\'',
    'deleted_at=clock_timestamp()',
    'client_phone=\'4165550199\'',
    'technician_id=NULL',
    'location_id=\'other\'',
    'start_time=start_time+interval \'1 minute\'',
    'end_time=end_time+interval \'1 minute\'',
    'started_at=clock_timestamp()',
    'completed_at=clock_timestamp()',
    'locked_at=clock_timestamp()',
    'locked_by=\'other\'',
    'actual_start_at=clock_timestamp()',
    'actual_end_at=clock_timestamp()',
    'selection_mode_snapshot=\'other\'',
    'confirmation_mode_snapshot=\'other\'',
    'request_expires_at=clock_timestamp()',
    'deposit_hold_expires_at=clock_timestamp()',
    'total_duration_minutes=61',
    'base_duration_minutes=61',
    'add_ons_duration_minutes=1',
    'buffer_minutes=1',
    'blocked_duration_minutes=61',
    'total_price=10001',
    'base_price_cents=10001',
    'add_ons_price_cents=1',
    'subtotal_before_discount_cents=10001',
    'discount_amount_cents=1',
    'discount_type=\'manual\'',
    'discount_label=\'label\'',
    'discount_percent=1',
    'discount_applied_at=clock_timestamp()',
    'final_price_cents=10000',
    'final_subtotal_cents=10000',
    'final_discount_cents=1',
    'final_discount_reason=\'reason\'',
    'tip_cents=1',
    'amount_paid_cents=1',
    'payment_status=\'paid\'',
    'payment_method=\'cash\'',
    'invoice_currency=\'USD\'',
    'tax_enabled_snapshot=true',
    'tax_name_snapshot=\'HST\'',
    'tax_rate_bps=1300',
    'tax_inclusive=true',
    'taxable_subtotal_cents=10000',
    'tax_amount_cents=1300',
    'tax_exempt=true',
    'tax_exempt_reason=\'reason\'',
    'final_tax_snapshot=\'{}\'::jsonb',
    'reschedule_tax_snapshot=\'{}\'::jsonb',
    'booking_tax_snapshot=\'{}\'::jsonb',
  ])('blocks financial/lifecycle mutation %s', async (assignment) => {
    const f = await fixture();
    await reserve(f);
    await blocked(client.query(`UPDATE appointment SET ${assignment} WHERE id=$1`, [f.appointmentId]));
  });

  it('retains reservation in review with disabled flags and blocks delete / indirect status writer', async () => {
    const f = await fixture();
    await reserve(f);
    await database.update(schema.closedCheckoutStateSchema).set({ version: 1, state: 'review', reason: 'source_context_changed' }).where(eq(schema.closedCheckoutStateSchema.operationId, f.operation.material.operationId));
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false');
    await blocked(client.query('DELETE FROM appointment WHERE id=$1', [f.appointmentId]));

    await expect(updateAppointmentStatus(f.appointmentId, f.salonId, 'cancelled')).rejects.toBeInstanceOf(CustomerPaymentReservationBlockedError);
    await expect(assertCustomerPaymentLifecycleMutable(database, f.salonId, f.appointmentId)).rejects.toBeInstanceOf(CustomerPaymentReservationBlockedError);

    const [a] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));

    await expect(assertCustomerPaymentServiceProgressionAllowed(database, a!)).rejects.toBeInstanceOf(CustomerPaymentReservationBlockedError);
  });

  it('blocks every child insert and protects both source and destination of a service move', async () => {
    const f = await fixture();
    const ordinary = await fixture();
    await reserve(f);
    const [service] = await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.id, f.itemId));
    await blocked(database.insert(schema.appointmentServicesSchema).values({ ...service!, id: randomUUID() }));
    await blocked(database.insert(schema.appointmentAddOnSchema).values({ id: randomUUID(), appointmentId: f.appointmentId, nameSnapshot: 'Extra', categorySnapshot: 'addon', pricingTypeSnapshot: 'fixed', unitPriceCentsSnapshot: 1, durationMinutesSnapshot: 1, lineTotalCentsSnapshot: 1, lineDurationMinutesSnapshot: 1 }));
    await blocked(database.insert(schema.appointmentFinalItemSchema).values({ id: randomUUID(), appointmentId: f.appointmentId, salonId: f.salonId, kind: 'custom', name: 'Final', unitPriceCents: 1, lineTotalCents: 1 }));
    await blocked(database.insert(schema.appointmentPaymentSchema).values({ id: 'cpay_no_bypass', appointmentId: f.appointmentId, salonId: f.salonId, amountCents: 1, recordedByType: 'system', method: 'cash' }));
    await blocked(database.insert(schema.appointmentDepositSchema).values({ id: randomUUID(), appointmentId: f.appointmentId, salonId: f.salonId, amountCents: 1, status: 'creating', stripeAccountId: f.operation.binding.connectedAccountId }));
    await blocked(database.update(schema.appointmentServicesSchema).set({ appointmentId: ordinary.appointmentId }).where(eq(schema.appointmentServicesSchema.id, f.itemId)));
    await blocked(database.update(schema.appointmentServicesSchema).set({ appointmentId: f.appointmentId }).where(eq(schema.appointmentServicesSchema.id, ordinary.itemId)));
    await blocked(database.delete(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.id, f.itemId)));
  });

  it('returns typed 409 at the canonical new tender seam before money writes', async () => {
    const f = await fixture();
    await reserve(f);
    const response = await recordPayment(new Request('https://closed.invalid/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents: 1, method: 'cash', idempotencyKey: randomUUID() }) }), { params: Promise.resolve({ id: f.appointmentId }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED' } });
    expect((await client.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
    expect(customerPaymentReservationBlockedResponse().status).toBe(409);
  });

  it('rejects canonical service/move engine before changing items or enqueueing calendar work', async () => {
    const f = await fixture();
    await reserve(f);

    await expect(runAppointmentManageMutation({ appointmentId: f.appointmentId, salonId: f.salonId, operation: 'move', startTime: new Date(f.operation.material.createdAt + 172800000), canReassignTechnician: true })).rejects.toMatchObject({ code: 'CUSTOMER_PAYMENT_RESERVATION_RECONCILIATION_REQUIRED', status: 409 });
    expect((await client.query('SELECT id FROM integration_outbox WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([]);
    expect((await client.query('SELECT id FROM appointment_services WHERE appointment_id=$1', [f.appointmentId])).rows).toEqual([{ id: f.itemId }]);
  });

  it('retains irreversible source facts without storing tokens, even before reservation and after pruning', async () => {
    const f = await fixture();
    const before = await snapshot(f);
    await database.update(schema.appointmentAccessTokenSchema).set({ tokenHash: 'rotated-in-memory-only' }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    const changed = await snapshot(f);

    expect(changed[`capability:${f.tokenId}`]).toBe(before[`capability:${f.tokenId}`]! + 1);

    await reserve(f);
    await database.delete(schema.appointmentAccessTokenSchema).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    expect((await snapshot(f))[`capability:${f.tokenId}`]).toBe(changed[`capability:${f.tokenId}`]! + 1);

    await blocked(client.query('UPDATE appointment SET status=\'cancelled\' WHERE id=$1', [f.appointmentId]));
    const facts = (await client.query('SELECT * FROM customer_payment_checkout_source_fact WHERE source_key=$1', [`capability:${f.tokenId}`])).rows;

    expect(facts).toHaveLength(3);
    expect(JSON.stringify(facts)).not.toContain('rotated-in-memory-only');
    await expect(client.query('DELETE FROM customer_payment_checkout_source_fact WHERE source_key=$1', [`capability:${f.tokenId}`])).rejects.toThrow('CLOSED_CHECKOUT_IMMUTABLE');
  });

  it('invalidates exact binding and binding set, owner policy and salon lifecycle without blocking them', async () => {
    const f = await fixture();
    await reserve(f);
    const before = await snapshot(f);
    await database.update(schema.salonStripeAccountSchema).set({ chargesEnabled: false }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    const changed = await snapshot(f);

    expect(changed[`binding:${f.bindingId}`]).toBe(before[`binding:${f.bindingId}`]! + 1);
    expect(changed[`binding_set:${f.salonId}`]).toBe(before[`binding_set:${f.salonId}`]! + 1);

    await database.insert(schema.salonStripeAccountSchema).values({ id: randomUUID(), salonId: f.salonId, stripeAccountId: `acct_${randomUUID().replaceAll('-', '')}`, livemode: false, revokedAt: new Date(), revocationCause: 'revoked_local' });

    expect((await snapshot(f))[`binding_set:${f.salonId}`]).toBe(changed[`binding_set:${f.salonId}`]);

    await client.query('UPDATE customer_payment_policy SET revision=revision+1 WHERE salon_id=$1', [f.salonId]);
    await database.update(schema.salonSchema).set({ status: 'inactive' }).where(eq(schema.salonSchema.id, f.salonId));
    const final = await snapshot(f);

    expect(final[`policy:${f.salonId}`]).toBe(before[`policy:${f.salonId}`]! + 1);
    expect(final[`salon:${f.salonId}`]).toBe(before[`salon:${f.salonId}`]! + 1);

    await blocked(client.query('UPDATE appointment SET total_price=1 WHERE id=$1', [f.appointmentId]));
  });
});
