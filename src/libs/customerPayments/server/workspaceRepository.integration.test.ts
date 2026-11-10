import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { verifyStripeCustomerPaymentReceipt } from '../liveProvider/stripeReceipt';
import type { PaymentProviderBinding, PaymentWorkspaceActor, PaymentWorkspaceState } from './workspaceContract';
import { createPaymentWorkspaceRepository } from './workspaceRepository';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createPaymentWorkspaceRepository>;
const binding: PaymentProviderBinding = { platformAccountId: 'acct_platform', connectedAccountId: 'acct_salon', bindingId: 'binding-one', livemode: false, currency: 'cad', returnOrigin: 'https://example.invalid' };
const sourceHash = createHash('sha256').update('fixed invoice fixture').digest('hex');

const dispatchBinding = async (_tx: unknown, _appointment: unknown, state: PaymentWorkspaceState) => ({ binding, billSourceHash: state.billSourceHash });

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  repository = createPaymentWorkspaceRepository(database);
}, 60000);

afterAll(async () => {
  await client?.close();
});

async function fixture() {
  const id = randomUUID();
  const scope = { salonId: `ws_salon_${id}`, appointmentId: `ws_appt_${id}` };
  await database.insert(schema.salonSchema).values({ id: scope.salonId, slug: scope.salonId, name: 'Workspace fixture' });
  await database.insert(schema.technicianSchema).values({ id: `tech_${id}`, salonId: scope.salonId, name: 'Fixture tech' });
  await database.insert(schema.appointmentSchema).values({ id: scope.appointmentId, salonId: scope.salonId, technicianId: `tech_${id}`, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 12000, totalDurationMinutes: 60, status: 'confirmed' });
  const actor: PaymentWorkspaceActor = { ...scope, id: 'owner-fixture', role: 'owner', impersonating: false, canEditItems: true, canRecordPayment: true };
  await database.insert(schema.adminUserSchema).values({ id: actor.id }).onConflictDoNothing();
  await database.insert(schema.adminSalonMembershipSchema).values({ salonId: scope.salonId, adminId: actor.id, role: 'owner' });
  const initial = { bill: { ...scope, revision: 0, serviceCents: 12000, taxCents: 0, tipCents: 0 }, billSourceHash: sourceHash, payments: [] };
  const initialize = (requestId = randomUUID()) => repository.initialize(actor, requestId, async () => initial);
  const request = (expectedRevision = 0) => ({ kind: 'request_payment' as const, requestId: randomUUID(), expectedRevision });
  return { scope, actor, initial, initialize, request, technicianId: `tech_${id}` };
}

describe('durable appointment payment workspace', () => {
  it('rechecks staff assignment under the appointment lock before reads and commands', async () => {
    const f = await fixture();
    await f.initialize();
    const staff = { ...f.actor, role: 'staff' as const, id: f.technicianId };

    expect((await repository.read(staff))?.revision).toBe(0);

    const replacement = randomUUID();
    await database.insert(schema.technicianSchema).values({ id: replacement, salonId: f.scope.salonId, name: 'Replacement tech' });
    await database.update(schema.appointmentSchema).set({ technicianId: replacement }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));

    await expect(repository.read(staff)).rejects.toThrow('ACCESS_REQUIRED');
    await expect(repository.command(staff, f.request(), async () => ({ binding, billSourceHash: sourceHash }))).rejects.toThrow('ACCESS_REQUIRED');
    expect((await repository.read(f.actor))?.revision).toBe(0);
  });

  it('persists reservations and immutable original retries across repository instances', async () => {
    const f = await fixture();
    await f.initialize();
    const command = f.request();
    const first = await repository.command(f.actor, command, async () => ({ binding, billSourceHash: sourceHash }));
    const restarted = createPaymentWorkspaceRepository(database);
    const replay = await restarted.command(f.actor, command, async () => {
      throw new Error('must not create again');
    });

    expect(first.state.requests).toHaveLength(1);
    expect(first.state.requests[0]).toMatchObject({ principalCents: 12000, tipCents: 0, state: 'reserved' });
    expect(replay).toEqual({ state: first.state, replayed: true });
    expect(await restarted.read(f.actor)).toEqual(first.state);

    const events = await database.select().from(schema.customerPaymentWorkspaceAuditSchema).where(eq(schema.customerPaymentWorkspaceAuditSchema.appointmentId, f.scope.appointmentId));

    expect(events.map(event => event.revision)).toEqual([0, 1]);
    await expect(restarted.command(f.actor, { ...command, expectedRevision: 1 }, async () => ({ binding, billSourceHash: sourceHash }))).rejects.toThrow('REQUEST_CONFLICT');
  });

  it('rejects stale concurrent commands rather than reserving the bill twice', async () => {
    const f = await fixture();
    await f.initialize();
    const outcomes = await Promise.allSettled([repository.command(f.actor, f.request(), async () => ({ binding, billSourceHash: sourceHash })), repository.command(f.actor, f.request(), async () => ({ binding, billSourceHash: sourceHash }))]);

    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.read(f.actor))!.operations).toHaveLength(1);
    await expect(repository.command(f.actor, f.request(1), async () => ({ binding, billSourceHash: sourceHash }))).rejects.toThrow('BALANCE_HELD');
  });

  it('reuses a saved dispatch identity after uncertainty and fences late workers', async () => {
    const f = await fixture();
    await f.initialize();
    const saved = await repository.command(f.actor, f.request(), async () => ({ binding, billSourceHash: sourceHash }));
    const id = saved.state.operations[0]!.id;
    const first = await repository.claimDispatch(f.actor, id, dispatchBinding);

    await expect(repository.claimDispatch(f.actor, id, dispatchBinding)).rejects.toThrow('DISPATCH_HELD');

    await repository.recordUncertain(f.scope, id, first.dispatchToken);
    const retry = await repository.claimDispatch(f.actor, id, dispatchBinding);

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.operation.firstDispatchAt).toBe(first.operation.firstDispatchAt);
    expect(retry.operation.sessionExpiresAt).toBe(first.operation.sessionExpiresAt);
    expect(retry.dispatchToken).not.toBe(first.dispatchToken);
    await expect(repository.recordUncertain(f.scope, id, first.dispatchToken)).rejects.toThrow('DISPATCH_FENCED');
    expect((await repository.read(f.actor))!.requests[0]!.state).toBe('processing');
  });

  it('retains the hold beyond the provider retry window', async () => {
    const f = await fixture();
    await f.initialize();
    const saved = await repository.command(f.actor, f.request(), async () => ({ binding, billSourceHash: sourceHash }));
    const id = saved.state.operations[0]!.id;
    // Seed a historical dispatch before its first timestamp has been recorded.
    // Once set, the database rejects changing that timestamp.
    await client.query(`UPDATE customer_payment_workspace SET revision=revision+1,
      state=jsonb_set(jsonb_set(state,'{revision}',to_jsonb(revision+1)),'{operations,0,firstDispatchAt}',to_jsonb(0::bigint)),
      request_id=$2,request_hash=repeat('e',64),actor_id='system:fixture',action='fixture_old_dispatch' WHERE appointment_id=$1`, [f.scope.appointmentId, randomUUID()]);

    await expect(repository.claimDispatch(f.actor, id, dispatchBinding)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect((await repository.read(f.actor))!.requests[0]!.state).toBe('reserved');
  });

  it('enforces server actor permissions, appointment scope and immutable audit history', async () => {
    const f = await fixture();
    await f.initialize();

    await expect(repository.command({ ...f.actor, impersonating: true }, f.request(), async () => ({ binding, billSourceHash: sourceHash }))).rejects.toThrow('ACCESS_REQUIRED');
    await expect(repository.command({ ...f.actor, canRecordPayment: false }, f.request(), async () => ({ binding, billSourceHash: sourceHash }))).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(repository.read({ ...f.actor, salonId: 'foreign-salon' })).rejects.toThrow('NOT_FOUND');
    await expect(client.query('DELETE FROM customer_payment_workspace_audit WHERE appointment_id=$1', [f.scope.appointmentId])).rejects.toThrow('HISTORY_IMMUTABLE');
    await expect(client.query('DELETE FROM customer_payment_workspace WHERE appointment_id=$1', [f.scope.appointmentId])).rejects.toThrow('HISTORY_IMMUTABLE');
    await expect(client.query('DELETE FROM appointment WHERE id=$1', [f.scope.appointmentId])).rejects.toThrow('HISTORY_IMMUTABLE');
    await expect(client.query('UPDATE customer_payment_workspace SET revision=revision+2 WHERE appointment_id=$1', [f.scope.appointmentId])).rejects.toThrow('REVISION_MISMATCH');
    await expect(client.query('INSERT INTO customer_payment_workspace_audit SELECT appointment_id,salon_id,999,state,$2,request_hash,actor_id,action,created_at FROM customer_payment_workspace_audit WHERE appointment_id=$1 LIMIT 1', [f.scope.appointmentId, randomUUID()])).rejects.toThrow('AUDIT_SOURCE_REQUIRED');
  });

  it('blocks legacy financial writes while a request can still collect', async () => {
    const f = await fixture();
    await f.initialize();
    await repository.command(f.actor, f.request(), async () => ({ binding, billSourceHash: sourceHash }));

    await expect(client.query('UPDATE appointment SET total_price=1 WHERE id=$1', [f.scope.appointmentId])).rejects.toThrow('BALANCE_HELD');
    await expect(client.query('UPDATE appointment SET status=\'canceled\' WHERE id=$1', [f.scope.appointmentId])).rejects.toThrow('BALANCE_HELD');
    await expect(database.insert(schema.appointmentPaymentSchema).values({ id: randomUUID(), salonId: f.scope.salonId, appointmentId: f.scope.appointmentId, amountCents: 100, method: 'cash', recordedByType: 'admin', recordedById: f.actor.id, idempotencyKey: randomUUID() })).rejects.toThrow();
    await expect(client.query('UPDATE appointment SET tech_notes=\'Administrative note\' WHERE id=$1', [f.scope.appointmentId])).resolves.toBeDefined();
  });

  it('cannot import synthetic online money as an initial real balance', async () => {
    const f = await fixture();

    await expect(repository.initialize(f.actor, randomUUID(), async () => ({ ...f.initial, payments: [{ ...f.scope, id: 'synthetic', movementId: 'synthetic', kind: 'online', principalCents: 1000, tipCents: 0, state: 'confirmed' }] }))).rejects.toThrow('VERIFIED_IMPORT_REQUIRED');
  });

  it('records canonical manual tender once and rejects a callback that writes different money', async () => {
    const f = await fixture();
    await f.initialize();
    const command = { requestId: randomUUID(), expectedRevision: 0, amountCents: 1000, method: 'cash' as const };
    const write = vi.fn(async (tx: Parameters<Parameters<typeof repository.recordManualPayment>[3]>[0], _appointment: unknown, allocation: { amountCents: number; method: string; requestId: string }) => {
      const paymentId = randomUUID();
      await tx.insert(schema.appointmentPaymentSchema).values({ id: paymentId, ...f.scope, amountCents: allocation.amountCents, method: allocation.method, idempotencyKey: allocation.requestId, recordedByType: 'admin', recordedById: f.actor.id });
      return { paymentId, billSourceHash: sourceHash };
    });
    const recorded = await repository.recordManualPayment(f.actor, command, async () => sourceHash, write);

    expect(recorded.state.payments[0]).toMatchObject({ kind: 'manual', principalCents: 1000, tipCents: 0 });

    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));

    expect(appointment).toMatchObject({ amountPaidCents: 1000, paymentStatus: 'partially_paid' });
    expect((await repository.recordManualPayment(f.actor, command, async () => sourceHash, write)).replayed).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);

    const wrong = { ...command, requestId: randomUUID(), expectedRevision: 1 };

    await expect(repository.recordManualPayment(f.actor, wrong, async () => sourceHash, (tx, appointment, allocation) => write(tx, appointment, { ...allocation, amountCents: 999 }))).rejects.toThrow('MANUAL_TENDER_MISMATCH');
    expect(await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.scope.appointmentId))).toHaveLength(1);
    expect((await repository.read(f.actor))!.revision).toBe(1);
  });

  it('requires fresh totals and preserves the reason for bill changes', async () => {
    const f = await fixture();
    await f.initialize();
    const change = { requestId: randomUUID(), expectedRevision: 0, changeFingerprint: 'b'.repeat(64), reason: 'Added nail art' };
    const writer = vi.fn(async () => ({ bill: { ...f.initial.bill, serviceCents: 15000 }, billSourceHash: 'b'.repeat(64) }));
    const revised = await repository.reviseBill(f.actor, change, writer);

    expect(revised.state.bill).toMatchObject({ revision: 1, serviceCents: 15000 });
    expect(revised.state.billChanges[0]).toMatchObject({ revision: 1, reason: 'Added nail art', actorId: f.actor.id });
    expect((await repository.reviseBill(f.actor, change, writer)).replayed).toBe(true);
    expect(writer).toHaveBeenCalledTimes(1);
    await expect(repository.command(f.actor, f.request(1), async () => ({ binding, billSourceHash: sourceHash }))).rejects.toThrow('BILL_CHANGED');

    const reserved = await repository.command(f.actor, f.request(1), async () => ({ binding, billSourceHash: 'b'.repeat(64) }));

    expect(reserved.state.requests[0]!.principalCents).toBe(15000);
    await expect(repository.reviseBill(f.actor, { ...change, requestId: randomUUID(), expectedRevision: reserved.state.revision }, writer)).rejects.toThrow('BALANCE_HELD');
  });

  it('durably deduplicates verified deliveries and retains conflicting signed facts', async () => {
    const secret = `whsec_${'signedfixture'.repeat(3)}`;
    const signed = (amount: number) => {
      const payload = JSON.stringify({ id: 'evt_workspace', object: 'event', account: 'acct_salon', api_version: '2024-06-20', livemode: false, type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), data: { object: { id: 'pi_workspace', object: 'payment_intent', amount, currency: 'cad', status: 'succeeded', customer: { name: 'PRIVATE_NAME' } } } });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
      return verifyStripeCustomerPaymentReceipt(Buffer.from(payload), signature, { endpointId: 'we_workspace', platformAccountId: 'acct_platform', livemode: false, apiVersion: '2024-06-20', signingSecret: secret });
    };
    const receipt = signed(1000);
    const first = await repository.retainReceipt(receipt);

    expect(await repository.retainReceipt(receipt)).toEqual(first);
    await expect(repository.retainReceipt(JSON.parse(JSON.stringify(receipt)))).rejects.toThrow('PROVENANCE_REQUIRED');
    expect(await repository.retainReceipt(signed(2000))).toMatchObject({ collision: true });

    const rows = await database.select().from(schema.customerPaymentLiveReceiptSchema);

    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_NAME');
    expect(JSON.stringify(rows)).not.toContain(secret);
    await expect(client.query('DELETE FROM customer_payment_live_receipt')).rejects.toThrow('HISTORY_IMMUTABLE');
  });
});
