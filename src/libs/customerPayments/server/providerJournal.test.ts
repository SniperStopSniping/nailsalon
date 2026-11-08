import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { customerPaymentProviderOperationSchema } from '@/models/customerPaymentProviderSchema';
import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { dispatchProviderFixture, reconcileProviderFixture } from '../provider/dispatchFixture';
import { applyOperationCommand, createOfflineOperationTransport, createOperationIdentity } from '../provider/operations';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from './preparationRepository';
import { createProviderJournal } from './providerJournal';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

async function operationFixture() {
  const suffix = randomUUID();
  const salonId = `boundary_salon_${suffix}`;
  const appointmentId = `boundary_appt_${suffix}`;
  const technicianId = `boundary_tech_${suffix}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Offline fixture' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Offline technician' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Offline customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const repository = createCustomerPaymentPreparationRepository(database);
  await repository.saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 0, tipCents: 0, discountCents: 0 });
  const quote = await repository.prepareCustomerPaymentQuote({ salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ fixture: suffix }) }, async () => ({ snapshot, stripeAccountId: 'acct_fixtureconnected', expiresAt: new Date(Date.now() + 600000), context: { fixture: suffix } }));
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: 'acct_fixtureplatform', accountScope: 'connected', accountId: 'acct_fixtureconnected', mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
  const journal = createProviderJournal(database);
  return { identity, journal, appointmentId };
}

describe('durable offline operation journal', () => {
  it.each(['NODE_ENV', 'APP_ENV', 'VERCEL_ENV', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED'])('gates %s before database access', async (key) => {
    vi.stubEnv(key, key.endsWith('ENABLED') ? 'false' : 'production');
    const fake = { select: vi.fn(), transaction: vi.fn() };
    const journal = createProviderJournal(fake as never);

    await expect(journal.databaseNow()).rejects.toThrow('FIXTURE_DISABLED');
    await expect(journal.getOperation(randomUUID())).rejects.toThrow('FIXTURE_DISABLED');
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it('replays exact operation and persists begin before offline result without financial writes', async () => {
    const { identity, journal, appointmentId } = await operationFixture();
    const initial = await journal.prepareOperation(identity);

    expect(await journal.prepareOperation(identity)).toEqual(initial);

    const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: 'cs_fixture' }, reconciliation: { type: 'exists', objectId: 'cs_fixture' } }]);
    const result = await dispatchProviderFixture(journal, transport, identity.id, { workerId: 'fixture', leaseMs: 60000 });

    expect(result.outcome).toBe('recorded');
    expect((await journal.getOperation(identity.id))?.state).toBe('succeeded');

    const audit = await client.query<{ snapshot: { state: { state: string }; command: { type: string } } }>('SELECT snapshot FROM customer_payment_provider_audit WHERE entity_type=\'operation\' AND entity_id=$1 ORDER BY version', [identity.id]);

    expect(audit.rows.map(row => row.snapshot.state.state)).toEqual(['queued', 'claimed', 'dispatching', 'succeeded']);
    expect(audit.rows.map(row => row.snapshot.command.type)).toEqual(['prepare', 'claim', 'begin_dispatch', 'observe_dispatch']);
    expect((await client.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [appointmentId])).rows).toHaveLength(0);
    expect((await client.query('SELECT id FROM customer_payment_capture WHERE appointment_id=$1', [appointmentId])).rows).toHaveLength(0);
  });

  it('retains uncertainty and requires branded exact-operation reconciliation before any safe retry', async () => {
    const { identity, journal } = await operationFixture();
    await journal.prepareOperation(identity);
    const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'authoritatively_absent' } }]);
    await dispatchProviderFixture(journal, transport, identity.id, { workerId: 'fixture', leaseMs: 60000 });
    const uncertain = await journal.getOperation(identity.id);

    expect(uncertain?.state).toBe('uncertain');
    await expect(journal.claimOperation(identity.id, { workerId: 'bad_retry', leaseMs: 60000, purpose: 'dispatch' })).rejects.toThrow('RECONCILIATION_REQUIRED');

    const claim = await journal.claimOperation(identity.id, { workerId: 'reconcile', leaseMs: 60000, purpose: 'reconcile' });

    await expect(journal.advanceOperation(identity.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, command: { type: 'reconcile', observation: { type: 'authoritatively_absent' } as never } })).rejects.toThrow();

    const observation = await transport.reconcile(claim, await journal.databaseNow());
    const queued = await journal.advanceOperation(identity.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, command: { type: 'reconcile', observation } });

    expect(queued.state).toBe('queued');
    expect(queued.identity).toEqual(identity);
    expect(queued.firstDispatchedAt).toBe(uncertain?.firstDispatchedAt);
    expect(queued.idempotencyExpiresAt).toBe(uncertain?.idempotencyExpiresAt);
  });

  it('full-journal recovery reconciles successful fake execution without duplicate dispatch', async () => {
    const { identity, journal } = await operationFixture();
    await journal.prepareOperation(identity);
    const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'exists', objectId: 'cs_recovered' } }]);
    await dispatchProviderFixture(journal, transport, identity.id, { workerId: 'fixture', leaseMs: 60000 });
    await reconcileProviderFixture(journal, transport, identity.id, { workerId: 'recovery', leaseMs: 60000 });

    expect((await journal.getOperation(identity.id))?.result).toEqual({ provenance: 'offline_fixture', objectId: 'cs_recovered' });
    expect((await dispatchProviderFixture(journal, transport, identity.id, { workerId: 'again', leaseMs: 60000 })).outcome).toBe('unchanged');
  });

  it('refuses lost lease and malformed SQL transitions without changing persisted identity', async () => {
    const { identity, journal } = await operationFixture();
    await journal.prepareOperation(identity);
    const claim = await journal.claimOperation(identity.id, { workerId: 'fixture', leaseMs: 60000, purpose: 'dispatch' });

    await expect(journal.advanceOperation(identity.id, { expectedVersion: claim.version, leaseToken: randomUUID(), command: { type: 'begin_dispatch' } })).rejects.toThrow('LEASE_LOST');
    await expect(client.query('UPDATE customer_payment_provider_operation_state SET version=version+1,state=jsonb_set(state,\'{state}\',\'null\'::jsonb) WHERE operation_id=$1', [identity.id])).rejects.toThrow();
    await expect(client.query('UPDATE customer_payment_provider_operation SET request_id=$1 WHERE id=$2', [randomUUID(), identity.id])).rejects.toThrow();
    await expect(client.query('DELETE FROM customer_payment_provider_audit WHERE entity_id=$1', [identity.id])).rejects.toThrow();
    expect((await journal.getOperation(identity.id))?.state).toBe('claimed');
  });

  it('rejects misleading SQL command history and null observation types', async () => {
    const { identity, journal } = await operationFixture();
    await journal.prepareOperation(identity);
    const claim = await journal.claimOperation(identity.id, { workerId: 'fixture', leaseMs: 60000, purpose: 'dispatch' });
    const dispatchTime = await journal.databaseNow();
    const next = applyOperationCommand(claim, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, now: dispatchTime }, { type: 'begin_dispatch' });
    const badCommand = { type: 'reconcile', observation: { type: 'exists', objectId: 'cs_fake' }, previousVersion: claim.version, leaseToken: claim.leaseToken, acceptedAt: dispatchTime };

    await expect(client.query('UPDATE customer_payment_provider_operation_state SET version=$2,state=$3::jsonb,command=$4::jsonb WHERE operation_id=$1', [identity.id, next.version, JSON.stringify(next), JSON.stringify(badCommand)])).rejects.toThrow('COMMAND_INVALID');

    const dispatched = await journal.advanceOperation(identity.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, command: { type: 'begin_dispatch' } });
    const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: 'cs_fixture' }, reconciliation: { type: 'exists', objectId: 'cs_fixture' } }]);
    const observation = await transport.execute(dispatched, await journal.databaseNow());
    const time = await journal.databaseNow();
    const finished = applyOperationCommand(dispatched, { expectedVersion: dispatched.version, leaseToken: dispatched.leaseToken!, now: time }, { type: 'observe_dispatch', observation });
    for (const bad of [{ type: 'reconcile', observation: { type: 'exists', objectId: 'cs_fixture' } }, { type: 'observe_dispatch', observation: { objectId: 'cs_fixture' } }]) {
      const command = { ...bad, previousVersion: dispatched.version, leaseToken: dispatched.leaseToken, acceptedAt: time };

      await expect(client.query('UPDATE customer_payment_provider_operation_state SET version=$2,state=$3::jsonb,command=$4::jsonb WHERE operation_id=$1', [identity.id, finished.version, JSON.stringify(finished), JSON.stringify(command)])).rejects.toThrow('COMMAND_INVALID');
    }

    expect((await journal.getOperation(identity.id))?.state).toBe('dispatching');
  });

  it('fails prepare and transition if a trigger suppresses durable state, without claiming dispatch', async () => {
    const first = await operationFixture();
    await client.exec('CREATE FUNCTION fixture_provider_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER fixture_provider_suppress BEFORE INSERT ON customer_payment_provider_operation_state FOR EACH ROW EXECUTE FUNCTION fixture_provider_suppress();');
    try {
      await expect(first.journal.prepareOperation(first.identity)).rejects.toThrow('WRITE_FAILED');
    } finally {
      await client.exec('DROP TRIGGER fixture_provider_suppress ON customer_payment_provider_operation_state;');
    }

    expect(await first.journal.getOperation(first.identity.id)).toBeNull();

    await first.journal.prepareOperation(first.identity);
    const claim = await first.journal.claimOperation(first.identity.id, { workerId: 'fixture', leaseMs: 60000, purpose: 'dispatch' });
    await client.exec('CREATE TRIGGER fixture_provider_suppress BEFORE UPDATE ON customer_payment_provider_operation_state FOR EACH ROW EXECUTE FUNCTION fixture_provider_suppress();');
    try {
      await expect(first.journal.advanceOperation(first.identity.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, command: { type: 'begin_dispatch' } })).rejects.toThrow('WRITE_FAILED');
    } finally {
      await client.exec('DROP TRIGGER fixture_provider_suppress ON customer_payment_provider_operation_state; DROP FUNCTION fixture_provider_suppress();');
    }

    expect((await first.journal.getOperation(first.identity.id))?.state).toBe('claimed');
  });

  it('binds checkout money to the actual quote even for direct SQL identities with valid hashes', async () => {
    const { identity, journal } = await operationFixture();
    if (identity.kind !== 'checkout_create') {
      throw new Error('fixture kind');
    }
    const { parameterHash: _hash, idempotencyKey: _key, ...input } = identity;
    const wrong = createOperationIdentity({ ...input, parameters: { ...input.parameters, line_items: [{ ...input.parameters.line_items[0], price_data: { ...input.parameters.line_items[0].price_data, unit_amount: 99999 } }] } });

    await expect(journal.prepareOperation(wrong)).rejects.toThrow('QUOTE_MISMATCH');
    await expect(database.insert(customerPaymentProviderOperationSchema).values({ id: wrong.id, salonId: wrong.salonId, appointmentId: wrong.appointmentId, quoteId: wrong.quoteId, requestId: wrong.requestId, fingerprint: customerPaymentFingerprint(wrong), identity: wrong })).rejects.toThrow();
    expect(await journal.getOperation(identity.id)).toBeNull();
  });
});
