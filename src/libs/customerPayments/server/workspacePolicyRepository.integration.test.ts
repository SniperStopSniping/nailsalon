import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { customerPaymentPolicySchema } from '@/models/customerPaymentSchema';
import * as schema from '@/models/Schema';

import { createWorkspacePolicyRepository, readWorkspaceBinding } from './workspacePolicyRepository';
import { createPaymentWorkspaceRepository } from './workspaceRepository';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
const runtime = { executionEnabled: true, platformAccountId: 'acct_platform', livemode: false, returnOrigin: 'https://example.invalid' };
const sourceHash = 'a'.repeat(64);

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

afterAll(async () => client?.close());

async function fixture() {
  const id = randomUUID();
  const salonId = `policy_salon_${id}`;
  const actorId = `owner_${id}`;
  const bindingId = `binding_${id}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Policy fixture' });
  await database.insert(schema.adminUserSchema).values({ id: actorId });
  await database.insert(schema.adminSalonMembershipSchema).values({ salonId, adminId: actorId, role: 'owner' });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: `acct_${id.replaceAll('-', '')}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
  const repository = createWorkspacePolicyRepository(database);
  const input = { requestId: randomUUID(), expectedRevision: 0, enabled: true, cancellationPolicy: 'Contact the salon to change or cancel your appointment.' };
  const readBinding = () => database.transaction(tx => readWorkspaceBinding(tx, salonId, runtime));
  return { salonId, actorId, bindingId, repository, input, readBinding };
}

describe('explicit owner activation and dispatch authorization', () => {
  it('stays off with an enabled test draft and a ready Stripe account', async () => {
    const f = await fixture();
    await database.insert(customerPaymentPolicySchema).values({ salonId: f.salonId, settings: { enabled: true, mode: 'optional_full', feePayer: 'salon', platformFeeCents: 100, cancellationPolicy: 'Draft' } });

    expect(await f.repository.read(f.salonId)).toMatchObject({ enabled: false, revision: 0 });
    expect(await f.readBinding()).toBeNull();
  });

  it('preserves immutable owner consent, stable retries, and optimistic revisions', async () => {
    const f = await fixture();
    const first = await f.repository.write(f.salonId, f.actorId, f.input, runtime);
    await f.repository.write(f.salonId, f.actorId, { ...f.input, requestId: randomUUID(), expectedRevision: 1, enabled: false }, runtime);

    expect(await f.repository.write(f.salonId, f.actorId, f.input, runtime)).toEqual(first);
    expect(await f.readBinding()).toBeNull();
    await expect(f.repository.write(f.salonId, f.actorId, { ...f.input, enabled: false }, runtime)).rejects.toThrow('REQUEST_CONFLICT');
    await expect(f.repository.write(f.salonId, f.actorId, { ...f.input, requestId: randomUUID() }, runtime)).rejects.toThrow('POLICY_STALE');
    await expect(database.delete(schema.customerPaymentWorkspacePolicyAuditSchema).where(eq(schema.customerPaymentWorkspacePolicyAuditSchema.salonId, f.salonId))).rejects.toThrow();
    expect((await database.select().from(schema.customerPaymentWorkspacePolicyAuditSchema).where(eq(schema.customerPaymentWorkspacePolicyAuditSchema.salonId, f.salonId)))).toHaveLength(2);
  });

  it('requires an owner and server-ready matching mode before activation', async () => {
    const f = await fixture();

    await expect(f.repository.write(f.salonId, 'foreign-owner', f.input, runtime)).rejects.toThrow('OWNER_REQUIRED');
    await expect(f.repository.write(f.salonId, f.actorId, f.input, { ...runtime, executionEnabled: false })).rejects.toThrow('CONNECT_SETUP_REQUIRED');
    await expect(f.repository.write(f.salonId, f.actorId, f.input, { ...runtime, livemode: true })).rejects.toThrow('CONNECT_SETUP_REQUIRED');

    await database.update(schema.salonStripeAccountSchema).set({ payoutsEnabled: false }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));

    await expect(f.repository.write(f.salonId, f.actorId, f.input, runtime)).rejects.toThrow('CONNECT_SETUP_REQUIRED');

    expect(await f.repository.read(f.salonId)).toMatchObject({ revision: 0, enabled: false });
  });

  it('does not transfer opt-in to another platform, runtime mode, or reconnected account', async () => {
    const f = await fixture();
    await f.repository.write(f.salonId, f.actorId, f.input, runtime);

    expect(await f.readBinding()).toMatchObject({ bindingId: f.bindingId, policyRevision: 1 });
    expect(await database.transaction(tx => readWorkspaceBinding(tx, f.salonId, { ...runtime, platformAccountId: 'acct_other' }))).toBeNull();
    expect(await database.transaction(tx => readWorkspaceBinding(tx, f.salonId, { ...runtime, livemode: true }))).toBeNull();

    await database.update(schema.salonStripeAccountSchema).set({ revokedAt: new Date(), revocationCause: 'revoked_local' }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    await database.insert(schema.salonStripeAccountSchema).values({ id: `${f.bindingId}_new`, salonId: f.salonId, stripeAccountId: `acct_new${randomUUID().replaceAll('-', '')}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });

    expect(await f.readBinding()).toBeNull();
  });

  it('rechecks policy and invoice before committing a dispatch lease', async () => {
    const f = await fixture();
    await f.repository.write(f.salonId, f.actorId, f.input, runtime);
    const appointmentId = randomUUID();
    await database.insert(schema.technicianSchema).values({ id: appointmentId, salonId: f.salonId, name: 'Assigned technician' });
    await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId: f.salonId, technicianId: appointmentId, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: new Date(), endTime: new Date(Date.now() + 3600000), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
    const actor = { id: f.actorId, salonId: f.salonId, appointmentId, role: 'owner' as const, impersonating: false, canEditItems: true, canRecordPayment: true };
    const workspace = createPaymentWorkspaceRepository(database);
    await workspace.initialize(actor, randomUUID(), async () => ({ bill: { salonId: f.salonId, appointmentId, revision: 0, serviceCents: 10000, taxCents: 0, tipCents: 0 }, billSourceHash: sourceHash, payments: [] }));
    const reader = async (tx: Parameters<typeof readWorkspaceBinding>[0]) => ({ binding: await readWorkspaceBinding(tx, f.salonId, runtime), billSourceHash: sourceHash });
    const saved = await workspace.command(actor, { kind: 'request_payment', requestId: randomUUID(), expectedRevision: 0 }, reader);
    const id = saved.state.operations[0]!.id;

    await expect(workspace.claimDispatch(actor, id, async tx => ({ ...await reader(tx), billSourceHash: 'b'.repeat(64) }))).rejects.toThrow('BILL_CHANGED');

    await f.repository.write(f.salonId, f.actorId, { ...f.input, requestId: randomUUID(), expectedRevision: 1, enabled: false }, runtime);

    await expect(workspace.claimDispatch(actor, id, reader)).rejects.toThrow('ACTIVATION_CHANGED');
    expect((await workspace.read(actor))?.operations[0]).toMatchObject({ state: 'prepared', firstDispatchAt: null, dispatchToken: null });

    const cancellation = { requestId: randomUUID(), expectedRevision: saved.state.revision, operationId: id };
    const canceled = await workspace.cancelUndispatched(actor, cancellation);

    expect(canceled.state.operations[0]?.state).toBe('canceled');
    expect(await workspace.cancelUndispatched(actor, cancellation)).toEqual({ state: canceled.state, replayed: true });

    await database.delete(schema.adminSalonMembershipSchema).where(and(eq(schema.adminSalonMembershipSchema.salonId, f.salonId), eq(schema.adminSalonMembershipSchema.adminId, f.actorId)));

    await expect(workspace.read(actor)).rejects.toThrow('ACCESS_REQUIRED');
    await expect(workspace.claimDispatch(actor, id, reader)).rejects.toThrow('ACCESS_REQUIRED');
  });
});
