import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as readCheckout } from '@/app/api/appointments/[id]/checkout/route';
import { PATCH as completeAppointment } from '@/app/api/appointments/[id]/complete/route';
import { GET as readCompletedBill, POST as reviseCompletedBill } from '@/app/api/appointments/[id]/payment-workspace/bill/route';
import { POST as voidPayment } from '@/app/api/appointments/[id]/payments/[paymentId]/void/route';
import { POST as recordPayment } from '@/app/api/appointments/[id]/payments/route';
import { GET as customerRead, POST as customerPay } from '@/app/api/public/appointments/manage/[token]/payments/route';
import { listPayments } from '@/libs/appointmentCheckoutServer';
import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { applyRefundObservation } from '@/libs/deposits/depositLifecycle';
import { purgeSalonGroups, SalonPurgeBlockedError } from '@/libs/salonPurge';
import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { netWorkspaceDepositCredit, resolveAdjustmentBalance } from '../adjustments';
import { customerPaymentTenderSummary, hasVerifiedCustomerPaymentTender } from '../provenance';
import { createPaymentReturnUrl } from '../server/paymentReturnToken';
import type { PaymentProviderBinding, PaymentWorkspaceActor, PaymentWorkspaceState } from '../server/workspaceContract';
import { cancelWorkspacePayment, dispatchWorkspacePayment, reconcileWorkspacePayment } from '../server/workspaceDispatcher';
import { prepareWorkspaceInvoice, readWorkspaceInvoice } from '../server/workspaceInvoice';
import { createWorkspacePolicyRepository } from '../server/workspacePolicyRepository';
import { beginCanonicalWorkspaceChange, createPaymentWorkspaceRepository } from '../server/workspaceRepository';
import { workspaceRuntime } from '../server/workspaceRuntime';
import { verifyStripeCustomerPaymentReceipt } from './stripeReceipt';
import { createWorkspaceStripeProvider } from './workspaceStripe';

const sdk = vi.hoisted(() => ({ accounts: vi.fn(), balance: vi.fn(), createSession: vi.fn(), retrieveSession: vi.fn(), expireSession: vi.fn(), retrieveIntent: vi.fn(), retrieveCharge: vi.fn(), refund: vi.fn(), retrieveRefund: vi.fn(), listRefunds: vi.fn() }));
const holder = vi.hoisted(() => ({ database: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.database;
} }));
vi.mock('@/libs/adminImpersonation', () => ({ getAdminImpersonationSession: async () => null }));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: async (appointmentId: string) => {
    const db = holder.database as typeof database;
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId));
    return { ok: true, appointment, actorRole: 'admin', admin: { id: 'owner', name: 'Owner', salons: [{ salonId: appointment!.salonId, role: 'owner' }] } };
  },
}));
vi.mock('stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stripe')>();
  return {
    default: class {
      static webhooks = actual.default.webhooks;
      accounts = { retrieve: sdk.accounts };
      balance = { retrieve: sdk.balance };
      checkout = { sessions: { create: sdk.createSession, retrieve: sdk.retrieveSession, expire: sdk.expireSession } };
      paymentIntents = { retrieve: sdk.retrieveIntent };
      charges = { retrieve: sdk.retrieveCharge };
      refunds = { create: sdk.refund, retrieve: sdk.retrieveRefund, list: sdk.listRefunds };
    },
  };
});

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createPaymentWorkspaceRepository>;
const binding: PaymentProviderBinding = { platformAccountId: 'acct_platform', connectedAccountId: 'acct_connected', bindingId: 'binding', livemode: false, currency: 'cad', returnOrigin: 'https://example.invalid' };
const secret = ['sk', 'test', 'not-a-provider-credential'].join('_');
const response = { lastResponse: { statusCode: 200, apiVersion: '2024-06-20' } };

const dispatchBinding = async (_tx: unknown, _appointment: unknown, state: PaymentWorkspaceState) => ({ binding, billSourceHash: state.billSourceHash });

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.database = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  repository = createPaymentWorkspaceRepository(database);
}, 60000);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET', 'synthetic-return-status-fixture-'.repeat(2));
  vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  sdk.accounts.mockImplementation(async (id: unknown) => ({
    ...response,
    id: typeof id === 'string' ? binding.connectedAccountId : binding.platformAccountId,
    object: 'account',
    country: 'CA',
    default_currency: 'cad',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: 'active' },
    requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: [] },
    controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' },
  }));
  sdk.balance.mockResolvedValue({ ...response, object: 'balance', livemode: false });
  sdk.listRefunds.mockResolvedValue({ ...response, data: [], has_more: false });
  sdk.createSession.mockImplementation(async (params: Record<string, any>) => ({
    ...response,
    id: `cs_test_${params.client_reference_id.replaceAll('-', '')}`,
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    currency: 'cad',
    amount_total: params.line_items[0].price_data.unit_amount,
    amount_subtotal: params.line_items[0].price_data.unit_amount,
    metadata: params.metadata,
    client_reference_id: params.client_reference_id,
    expires_at: params.expires_at,
    automatic_tax: { enabled: false },
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    status: 'open',
    payment_status: 'unpaid',
    url: `https://checkout.stripe.com/c/pay/cs_test_${params.client_reference_id.replaceAll('-', '')}#private-capability`,
  }));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await client?.close();
});

const settings = { payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } } };
const taxConfig = resolveTaxConfig(settings, new Date());

async function fixture(canonicalInvoice = false, depositCents = 0, initialize = true) {
  const id = randomUUID();
  const scope = { salonId: `driver_salon_${id}`, appointmentId: `driver_appt_${id}` };
  await database.insert(schema.salonSchema).values({ id: scope.salonId, slug: scope.salonId, name: 'Provider fixture', settings });
  await database.insert(schema.technicianSchema).values({ id, salonId: scope.salonId, name: 'Fixture tech' });
  await database.insert(schema.appointmentSchema).values({ id: scope.appointmentId, salonId: scope.salonId, technicianId: id, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const actor: PaymentWorkspaceActor = { ...scope, id: 'owner', role: 'owner', impersonating: false, canEditItems: true, canRecordPayment: true };
  await database.insert(schema.adminUserSchema).values({ id: actor.id }).onConflictDoNothing();
  await database.insert(schema.adminSalonMembershipSchema).values({ salonId: scope.salonId, adminId: actor.id, role: 'owner' });
  if (canonicalInvoice) {
    const totals = computeCheckoutTotals({ items: [{ lineTotalCents: 10000, taxable: true }], taxConfig, tipCents: 2000 });
    await database.update(schema.appointmentSchema).set({ invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig, totals, currency: 'CAD', capturedAt: new Date() }), subtotalBeforeDiscountCents: 10000, tipCents: 2000 }).where(eq(schema.appointmentSchema.id, scope.appointmentId));
    await database.insert(schema.serviceSchema).values({ id, salonId: scope.salonId, name: 'Manicure', price: 10000, durationMinutes: 60, category: 'manicure' });
    await database.insert(schema.appointmentServicesSchema).values({ id, appointmentId: scope.appointmentId, serviceId: id, priceAtBooking: 10000, nameSnapshot: 'Original manicure', durationAtBooking: 60 });
  }
  if (depositCents) {
    await database.insert(schema.appointmentDepositSchema).values({ id: randomUUID(), ...scope, stripeAccountId: 'acct_deposit', stripePaymentIntentId: `pi_${id.replaceAll('-', '')}`, status: 'paid', amountCents: depositCents, currency: 'cad', collectedAt: new Date() });
  }
  if (!initialize) {
    return { scope, actor, technicianId: id, operationId: '' };
  }
  const initial = await repository.initialize(actor, randomUUID(), canonicalInvoice ? prepareWorkspaceInvoice : async () => ({ bill: { ...scope, revision: 0, serviceCents: 10000, taxCents: 1300, tipCents: 2000 }, billSourceHash: 'a'.repeat(64), payments: [] }));
  const saved = await repository.command(actor, { kind: 'request_payment', requestId: randomUUID(), expectedRevision: 0 }, async () => ({ binding, billSourceHash: initial.state.billSourceHash }));
  return { scope, actor, technicianId: id, operationId: saved.state.operations[0]!.id };
}

async function capturedFixture(canonicalInvoice = false, depositCents = 0) {
  const f = await fixture(canonicalInvoice, depositCents);
  const dispatched = await dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding);
  const params = sdk.createSession.mock.calls.at(-1)![0];
  const session = await sdk.createSession.getMockImplementation()!(params);
  const capturedAmount = params.line_items[0].price_data.unit_amount;
  const suffix = f.operationId.replaceAll('-', '');
  const paymentIntentId = `pi_${suffix}`;
  const chargeId = `ch_${suffix}`;
  sdk.retrieveSession.mockResolvedValue({ ...session, status: 'complete', payment_status: 'paid', payment_intent: paymentIntentId, url: null });
  sdk.retrieveIntent.mockResolvedValue({ ...response, id: paymentIntentId, object: 'payment_intent', livemode: false, currency: 'cad', amount: capturedAmount, amount_received: capturedAmount, status: 'succeeded', capture_method: 'automatic', latest_charge: chargeId, metadata: { luster_payment_operation: f.operationId }, application_fee_amount: null, transfer_data: null, on_behalf_of: null });
  const charge = { ...response, id: chargeId, object: 'charge', payment_intent: paymentIntentId, livemode: false, currency: 'cad', amount: capturedAmount, amount_captured: capturedAmount, amount_refunded: 0, paid: true, captured: true, status: 'succeeded', disputed: false, review: null, application_fee: null, application_fee_amount: null, transfer_data: null, on_behalf_of: null, metadata: { luster_payment_operation: f.operationId } };
  sdk.retrieveCharge.mockResolvedValue(charge);
  return { ...f, dispatched, charge, paymentIntentId, chargeId };
}

describe('independently retrieved payment and refund accounting', () => {
  it.each([false, true])('reconciles a full deposit refund without subtracting other tender; earlier online refund=%s', async (refundOnline) => {
    const f = await capturedFixture(true, 2000);
    await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);
    const serviceAmount = refundOnline ? 8000 : 10000;
    const completed = await completeAppointment(new Request('http://localhost/api/appointments/fixture/complete', { method: 'PATCH', body: JSON.stringify({ finalItems: [{ kind: 'custom', name: 'Final service', quantity: 1, unitPriceCents: serviceAmount, taxable: true }], payments: [], skipPhotoValidation: true }) }), { params: Promise.resolve({ id: f.scope.appointmentId }) });

    expect(completed.status).toBe(200);

    if (refundOnline) {
      const state = (await repository.read(f.actor))!;
      const requested = await repository.command(f.actor, { kind: 'request_refund', requestId: randomUUID(), expectedRevision: state.revision, paymentId: `lpay_${f.operationId}`, principalCents: 2260, tipCents: 0, reason: 'Removed service' }, dispatchBinding);
      const operation = requested.state.operations.at(-1)!;
      const refund = { ...response, id: `re_${operation.id.replaceAll('-', '')}`, object: 'refund', currency: 'cad', amount: 2260, charge: f.chargeId, payment_intent: f.paymentIntentId, status: 'succeeded', metadata: { luster_payment_operation: operation.id } };
      sdk.refund.mockResolvedValue(refund);
      await dispatchWorkspacePayment(repository, f.actor, operation.id, secret, dispatchBinding);
      sdk.retrieveRefund.mockResolvedValue(refund);
      sdk.listRefunds.mockResolvedValue({ ...response, data: [refund], has_more: false });
      sdk.retrieveCharge.mockResolvedValue({ ...f.charge, amount_refunded: 2260 });
      await reconcileWorkspacePayment(repository, f.scope, operation.id, secret);
    }
    const [deposit] = await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.appointmentId, f.scope.appointmentId));
    const before = (await repository.read(f.actor))!;
    // Disabling new payment creation must never restore gross refunded money.
    vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'false');
    const refund = { id: `re_${randomUUID().replaceAll('-', '')}`, status: 'pending' as const, amount: 2000, currency: 'cad', payment_intent: deposit!.stripePaymentIntentId, metadata: { luster_deposit_id: deposit!.id } };
    const pending = await applyRefundObservation({ deposit: deposit!, refund, origin: 'webhook', eventMetadataDepositId: deposit!.id });

    expect(pending.applied).toBe(true);
    expect(await repository.reconcileDeposits(f.scope, f.actor)).toEqual({ changed: false, held: true });
    expect((await repository.read(f.actor))!.revision).toBe(before.revision);

    const pendingAppointment = (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId)))[0]!;

    expect(pendingAppointment).toMatchObject({ amountPaidCents: refundOnline ? 9040 : 11300, paymentStatus: 'partially_paid' });

    const succeeded = await applyRefundObservation({ deposit: pending.deposit!, refund: { ...refund, status: 'succeeded' }, origin: 'webhook', eventMetadataDepositId: deposit!.id });

    expect(succeeded.applied).toBe(true);
    expect(await repository.reconcileDeposits(f.scope, f.actor)).toEqual({ changed: true, held: false });

    const state = (await repository.read(f.actor))!;
    const balance = resolveAdjustmentBalance({ revision: state.revision, bill: state.bill, payments: state.payments, refunds: state.refunds, requests: state.requests });
    const appointment = (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId)))[0]!;

    expect(state.payments).toEqual(before.payments);
    expect(state.refunds).toContainEqual(expect.objectContaining({ paymentId: deposit!.id, kind: 'deposit_refund', principalCents: 2000, tipCents: 0, state: 'succeeded' }));
    expect(state.depositCreditHistory).toContainEqual(expect.objectContaining({ depositId: deposit!.id, disposition: 'refunded', amountCents: 2000 }));
    expect(balance).toMatchObject({ balanceDueCents: 2000, principalDueCents: 2000, tipDueCents: 0, canReservePayment: true });
    expect(netWorkspaceDepositCredit(state.payments, state.refunds)).toBe(0);
    expect(appointment).toMatchObject({ amountPaidCents: refundOnline ? 9040 : 11300, paymentStatus: 'partially_paid' });
    expect(await repository.reconcileDeposits(f.scope, f.actor)).toEqual({ changed: false, held: false });
    expect((await repository.read(f.actor))!.revision).toBe(state.revision);

    const jobs = await database.select().from(schema.integrationOutboxSchema).where(eq(schema.integrationOutboxSchema.appointmentId, f.scope.appointmentId));

    expect(jobs.filter(job => job.dedupeKey === `payment-workspace:${f.scope.appointmentId}:client-stats:${state.revision}`)).toHaveLength(1);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
    expect(sdk.refund).toHaveBeenCalledTimes(refundOnline ? 1 : 0);

    const request = await repository.command(f.actor, { kind: 'request_payment', requestId: randomUUID(), expectedRevision: state.revision }, dispatchBinding);

    expect(request.state.operations.at(-1)).toMatchObject({ principalCents: 2000, tipCents: 0 });
  });

  it('uses the actual customer API to pay only the deposit-adjusted balance with pinned policy and invoice consent', async () => {
    const f = await fixture(true, 2000, false);
    const tokenId = randomUUID();
    const capability = `${randomUUID()}${randomUUID()}`;
    await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, ...f.scope, tokenHash: createHash('sha256').update(capability).digest('hex'), expiresAt: new Date(Date.now() + 86400000) });
    await database.insert(schema.salonStripeAccountSchema).values({ id: randomUUID(), salonId: f.scope.salonId, stripeAccountId: binding.connectedAccountId, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    vi.stubEnv('STRIPE_SECRET_KEY', secret);
    vi.stubEnv('STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET', 'synthetic-webhook-placeholder');
    vi.stubEnv('CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID', 'we_fixture');
    vi.stubEnv('CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID', binding.platformAccountId);
    vi.stubEnv('PUBLIC_APP_URL', binding.returnOrigin);
    const policies = createWorkspacePolicyRepository(database);
    await policies.write(f.scope.salonId, f.actor.id, { requestId: randomUUID(), expectedRevision: 0, enabled: true, cancellationPolicy: 'Contact the salon before changing your appointment.' }, workspaceRuntime());
    const params = { params: Promise.resolve({ token: capability }) };
    const url = `${binding.returnOrigin}/api/public/appointments/manage/${capability}/payments`;
    const read = await customerRead(new Request(url), params);
    const view = (await read.json()).data;

    expect(read.status).toBe(200);
    expect(view).toMatchObject({ initialized: false, canPay: true, totalCents: 13300, paidCents: 2000, depositCreditCents: 2000, balanceCents: 11300, policy: { revision: 1 } });
    expect(JSON.stringify(view)).not.toMatch(/Synthetic customer|4165550111|acct_connected|tokenHash/);

    const command = { kind: 'request_payment', requestId: randomUUID(), initializationId: randomUUID(), expectedRevision: view.revision, expectedInvoiceHash: view.invoiceHash, acceptedPolicyRevision: view.policy.revision };
    const post = (body: unknown) => customerPay(new Request(url, { method: 'POST', headers: { 'origin': binding.returnOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), params);

    expect((await post({ ...command, amountCents: 1 })).status).toBe(400);
    expect((await post({ ...command, kind: 'request_refund' })).status).toBe(400);
    expect((await post({ ...command, expectedInvoiceHash: 'f'.repeat(64) })).status).toBe(409);
    expect((await post({ ...command, acceptedPolicyRevision: 2 })).status).toBe(409);
    expect(await repository.read(f.actor)).toBeNull();
    expect(sdk.createSession).not.toHaveBeenCalled();

    const opened = await post(command);

    expect(opened.status).toBe(200);
    expect((await opened.json()).checkoutUrl).toContain('https://checkout.stripe.com/');
    expect(sdk.createSession.mock.calls[0]![0].line_items[0].price_data.unit_amount).toBe(11300);

    const state = (await repository.read(f.actor))!;

    expect(state.operations[0]).toMatchObject({ principalCents: 9300, tipCents: 2000, customerAcceptance: { policyRevision: 1, accessTokenId: tokenId } });
    expect(JSON.stringify(state)).not.toContain(capability);

    sdk.retrieveSession.mockResolvedValue({ ...await sdk.createSession.getMockImplementation()!(sdk.createSession.mock.calls[0]![0]), payment_intent: null });

    expect((await post(command)).status).toBe(200);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
    expect((await repository.read(f.actor))!.operations).toHaveLength(1);

    await policies.write(f.scope.salonId, f.actor.id, { requestId: randomUUID(), expectedRevision: 1, enabled: false, cancellationPolicy: 'Changed policy after request' }, workspaceRuntime());
    const retained = (await (await customerRead(new Request(url), params)).json()).data;

    expect(retained.canPay).toBe(false);
    expect(retained.policy).toEqual({ revision: 1, cancellationPolicy: 'Contact the salon before changing your appointment.' });

    await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, tokenId));

    expect((await post(command)).status).toBe(403);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
  });

  it('shows pending after dispatch and received only after independent settlement; status reads never write', async () => {
    const f = await capturedFixture();
    const parameters = sdk.createSession.mock.calls[0]![0];
    const returnUrl = new URL(parameters.success_url);
    const token = new URLSearchParams(returnUrl.hash.slice(1)).get('status')!;
    const before = await repository.read(f.actor);

    expect(parameters.cancel_url).toBe(parameters.success_url);
    expect(returnUrl.search).toBe('');
    expect(await repository.readReturnStatus(token, binding.returnOrigin)).toEqual({ status: 'pending', currency: 'CAD', amountCents: 13300, refundedCents: 0 });
    expect(await repository.read(f.actor)).toEqual(before);
    expect(await repository.readReturnStatus(token, 'https://another.example.invalid')).toBeNull();
    expect(sdk.retrieveCharge).not.toHaveBeenCalled();

    await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);

    expect(await repository.readReturnStatus(token, binding.returnOrigin)).toEqual({ status: 'received', currency: 'CAD', amountCents: 13300, refundedCents: 0 });

    const state = (await repository.read(f.actor))!;
    const wrongScope = new URL(createPaymentReturnUrl({ ...f.scope, appointmentId: randomUUID() }, state.operations[0]!));

    expect(await repository.readReturnStatus(new URLSearchParams(wrongScope.hash.slice(1)).get('status')!, binding.returnOrigin)).toBeNull();
  });

  it('refuses a changed status signing key before creating a provider Session', async () => {
    const f = await fixture();
    vi.stubEnv('CUSTOMER_PAYMENTS_STATUS_SIGNING_SECRET', 'different-synthetic-return-status-key-'.repeat(2));

    await expect(dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding)).rejects.toThrow('RETURN_CONFIGURATION_CHANGED');
    expect(sdk.createSession).not.toHaveBeenCalled();
    expect((await repository.read(f.actor))!.operations[0]!.state).toBe('uncertain');
  });

  it('preserves payment history after owner opt-out while keeping unrelated salon checkout unchanged', async () => {
    const f = await fixture(true);
    const history = await readCheckout(new Request('http://localhost/api/appointments/fixture/checkout'), { params: Promise.resolve({ id: f.scope.appointmentId }) });

    expect(history.status).toBe(200);
    expect((await history.json()).data.paymentWorkspace).toMatchObject({ enabled: true, initialized: true });

    const [original] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
    const id = randomUUID();
    await database.insert(schema.appointmentSchema).values({ ...original!, id, startTime: new Date('2030-01-02T12:00:00Z'), endTime: new Date('2030-01-02T13:00:00Z') });
    const plain = await readCheckout(new Request('http://localhost/api/appointments/fixture/checkout'), { params: Promise.resolve({ id }) });

    expect(plain.status).toBe(200);
    expect((await plain.json()).data.paymentWorkspace).toEqual({ enabled: false, initialized: false, refundableOnlinePrincipalCents: 0 });
  });

  it.each([8000, 12000])('completes the real checkout route at %i cents after an online payment and preserves retries', async (amount) => {
    const f = await capturedFixture(true);
    await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);
    const payload = { finalItems: [{ kind: 'custom', name: 'Changed service', quantity: 1, unitPriceCents: amount, taxable: true }], payments: [], skipPhotoValidation: true };
    const request = () => new Request('http://localhost/api/appointments/fixture/complete', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const response = await completeAppointment(request(), { params: Promise.resolve({ id: f.scope.appointmentId }) });
    const data = await response.json();

    expect(response.status, JSON.stringify(data)).toBe(200);

    const saved = (await repository.read(f.actor))!;

    expect(saved.bill).toMatchObject({ revision: 1, serviceCents: amount, taxCents: amount * 0.13, tipCents: 2000 });
    expect(saved.payments).toHaveLength(1);
    expect(saved.invoice?.items[0]?.name).toBe('Changed service');

    const retry = await completeAppointment(request(), { params: Promise.resolve({ id: f.scope.appointmentId }) });

    expect(retry.status).toBe(200);
    expect((await repository.read(f.actor))?.revision).toBe(saved.revision);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
    expect(sdk.refund).not.toHaveBeenCalled();

    if (amount > 10000) {
      const input = { amountCents: 1000, method: 'cash', idempotencyKey: randomUUID() };
      const manualRequest = () => new Request('http://localhost/api/appointments/fixture/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const manual = await recordPayment(manualRequest(), { params: Promise.resolve({ id: f.scope.appointmentId }) });

      expect(manual.status, JSON.stringify(await manual.json())).toBe(200);

      const recorded = (await repository.read(f.actor))!;
      const payment = recorded.payments.find(payment => payment.kind === 'manual')!;

      expect(payment.principalCents).toBe(1000);
      expect(recorded.bill.revision).toBe(1);
      expect((await recordPayment(manualRequest(), { params: Promise.resolve({ id: f.scope.appointmentId }) })).status).toBe(200);
      expect((await repository.read(f.actor))?.revision).toBe(recorded.revision);

      const voided = await voidPayment(new Request('http://localhost/api/appointments/fixture/payments/void', { method: 'POST' }), { params: Promise.resolve({ id: f.scope.appointmentId, paymentId: payment.id }) });

      expect(voided.status, JSON.stringify(await voided.json())).toBe(200);
      expect((await repository.read(f.actor))?.refunds).toMatchObject([{ paymentId: payment.id, kind: 'manual_void', principalCents: 1000 }]);
      expect(sdk.refund).not.toHaveBeenCalled();
    }
  });

  it.each([8000, 12000])('revises an already completed invoice to %i cents without moving money or completion time', async (amount) => {
    const f = await capturedFixture(true);
    await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);
    const params = { params: Promise.resolve({ id: f.scope.appointmentId }) };
    const completed = await completeAppointment(new Request('http://localhost/api/appointments/fixture/complete', { method: 'PATCH', body: JSON.stringify({ finalItems: [{ kind: 'custom', name: 'Original completed service', quantity: 1, unitPriceCents: 10000, taxable: true }], payments: [], skipPhotoValidation: true }) }), params);

    expect(completed.status).toBe(200);

    const [original] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
    // A later owner tax change must not alter an existing invoice revision.
    await database.update(schema.salonSchema).set({ settings: { payments: { tax: { enabled: true, rateBps: 500 } } } }).where(eq(schema.salonSchema.id, f.scope.salonId));
    const read = await readCompletedBill(new Request('http://localhost/api/appointments/fixture/payment-workspace/bill'), params);
    const view = (await read.json()).data;

    expect(read.status).toBe(200);
    expect(view).toMatchObject({ canEdit: true, taxConfig: { rateBps: 1300 }, paidCents: 13300, tipCents: 2000 });

    const payload = { requestId: randomUUID(), initializationId: randomUUID(), expectedRevision: view.revision, expectedInvoiceHash: view.invoiceHash, expectedTotalDueCents: amount + amount * 0.13 + 2000, finalItems: [{ kind: 'custom', name: 'Revised completed service', quantity: 1, unitPriceCents: amount, taxable: true }], discountCents: 0, discountReason: '', reason: 'Customer changed the service' };
    const request = (body = payload, origin = 'http://localhost') => new Request('http://localhost/api/appointments/fixture/payment-workspace/bill', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    expect((await reviseCompletedBill(request(payload, 'https://other.invalid'), params)).status).toBe(403);
    expect((await reviseCompletedBill(request({ ...payload, expectedInvoiceHash: '0'.repeat(64) }), params)).status).toBe(409);
    expect((await reviseCompletedBill(request({ ...payload, expectedTotalDueCents: 1 }), params)).status).toBe(409);

    const saved = await reviseCompletedBill(request(), params);

    expect(saved.status, JSON.stringify(await saved.json())).toBe(200);
    expect((await reviseCompletedBill(request(), params)).status).toBe(200);
    expect((await reviseCompletedBill(request({ ...payload, reason: 'Changed retry body' }), params)).status).toBe(409);
    expect((await reviseCompletedBill(request({ ...payload, requestId: randomUUID() }), params)).status).toBe(409);

    const [after] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
    const state = (await repository.read(f.actor))!;
    const audit = await database.select().from(schema.appointmentAuditLogSchema).where(eq(schema.appointmentAuditLogSchema.appointmentId, f.scope.appointmentId));
    const revision = audit.find(row => row.reason === payload.reason)!;

    expect(after).toMatchObject({ status: 'completed', completedAt: original!.completedAt, totalPrice: 10000, amountPaidCents: 13300, finalPriceCents: amount, taxAmountCents: amount * 0.13, tipCents: 2000, paymentStatus: amount > 10000 ? 'partially_paid' : 'paid' });
    expect(after!.finalTaxSnapshot?.configuration).toEqual(original!.finalTaxSnapshot?.configuration);
    expect(after!.finalTaxSnapshot?.capturedAt).toBe(original!.finalTaxSnapshot?.capturedAt);
    expect(state.bill).toMatchObject({ revision: 2, serviceCents: amount, taxCents: amount * 0.13, tipCents: 2000 });
    expect(state.payments).toHaveLength(1);
    expect(state.refunds).toHaveLength(0);
    expect(revision.previousValue).toMatchObject({ invoice: { items: [{ name: 'Original completed service' }] } });
    expect(revision.newValue).toMatchObject({ invoice: { items: [{ name: 'Revised completed service' }] } });
    expect(audit.filter(row => row.reason === payload.reason)).toHaveLength(1);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
    expect(sdk.refund).not.toHaveBeenCalled();

    if (amount > 10000) {
      const requested = await repository.command(f.actor, { kind: 'request_payment', requestId: randomUUID(), expectedRevision: state.revision }, dispatchBinding);
      const held = await readCompletedBill(new Request('http://localhost/api/appointments/fixture/payment-workspace/bill'), params);
      const heldView = (await held.json()).data;

      expect(heldView.canEdit).toBe(false);
      expect(requested.state.operations.at(-1)).toMatchObject({ principalCents: 2260, tipCents: 0 });
      expect((await reviseCompletedBill(request({ ...payload, requestId: randomUUID(), expectedRevision: heldView.revision, expectedInvoiceHash: heldView.invoiceHash }), params)).status).toBe(409);
    }
  });

  it.each([8000, 12000])('retains the original payment and tip when actual checkout services change to %i cents', async (amount) => {
    const f = await capturedFixture(true);
    await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);
    const original = await repository.read(f.actor);
    const result = await database.transaction(async (tx) => {
      const [appointment] = await tx.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId)).for('update');
      const change = await beginCanonicalWorkspaceChange(tx, appointment!, async () => f.actor, 'Customer changed services');

      expect(change?.onlineRefundablePrincipalCents).toBe(11300);

      const totals = computeCheckoutTotals({ items: [{ lineTotalCents: amount, taxable: true }], taxConfig, tipCents: 2000 });
      const finalTaxSnapshot = buildFinalTaxSnapshot({ taxConfig, totals, currency: 'CAD', capturedAt: new Date(), taxExempt: false, taxExemptReason: null });
      await tx.update(schema.appointmentSchema).set({ status: 'completed', completedAt: new Date(finalTaxSnapshot.capturedAt), finalPriceCents: totals.finalPriceCents, finalSubtotalCents: amount, finalDiscountCents: 0, finalTaxSnapshot, taxableSubtotalCents: totals.taxableSubtotalCents, taxAmountCents: totals.taxAmountCents, taxExempt: false, taxExemptReason: null }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
      await tx.insert(schema.appointmentFinalItemSchema).values({ id: randomUUID(), ...f.scope, kind: 'service', name: 'Changed service', quantity: 1, unitPriceCents: amount, lineTotalCents: amount });
      await change?.finish();
      const [updated] = await tx.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
      return readWorkspaceInvoice(tx, updated!);
    });
    const current = (await repository.read(f.actor))!;

    expect(current.billSourceHash).toBe(result.billSourceHash);
    expect(current.payments).toEqual(original!.payments);
    expect(current.invoice?.tipCents).toBe(2000);
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
    expect(sdk.refund).not.toHaveBeenCalled();

    const next = amount > 10000
      ? { kind: 'request_payment' as const, requestId: randomUUID(), expectedRevision: current.revision }
      : { kind: 'request_refund' as const, requestId: randomUUID(), expectedRevision: current.revision, paymentId: current.payments[0]!.id, principalCents: 2260, tipCents: 0, reason: 'Removed service' };
    const reserved = await repository.command(f.actor, next, async () => ({ binding, billSourceHash: result.billSourceHash }));

    expect(reserved.state.operations.at(-1)).toMatchObject({ principalCents: 2260, tipCents: 0, kind: amount > 10000 ? 'payment' : 'refund' });
  });

  it('expires the old payment link and independently verifies it before releasing the bill', async () => {
    const f = await capturedFixture();
    const session = await sdk.retrieveSession();
    const expired = { ...session, status: 'expired', payment_status: 'unpaid', payment_intent: null };
    sdk.expireSession.mockResolvedValue(expired);
    sdk.retrieveSession.mockResolvedValue(expired);
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'false');
    const result = await cancelWorkspacePayment(repository, f.actor, f.dispatched.state.revision, f.operationId, secret);

    expect(result.state.operations[0]!.state).toBe('canceled');
    expect(result.state.requests[0]!.state).toBe('expired');
    expect(result.state.payments).toEqual([]);
    expect(sdk.expireSession).toHaveBeenCalledWith(session.id, {}, expect.objectContaining({ stripeAccount: binding.connectedAccountId, idempotencyKey: `luster_cp_expire_v1_${f.operationId}` }));
    expect((await repository.reviseBill(f.actor, { requestId: randomUUID(), expectedRevision: result.state.revision, changeFingerprint: 'b'.repeat(64), reason: 'Add service after closing old request' }, async () => ({ bill: { ...result.state.bill, serviceCents: 11000 }, billSourceHash: 'b'.repeat(64) }))).state.bill.serviceCents).toBe(11000);
  });

  it('records a payment that wins the expiration race instead of releasing its balance', async () => {
    const f = await capturedFixture();
    sdk.expireSession.mockRejectedValue(new Error('Session was already completed'));
    const result = await cancelWorkspacePayment(repository, f.actor, f.dispatched.state.revision, f.operationId, secret);

    expect(result.state.operations[0]!.state).toBe('succeeded');
    expect(result.state.payments[0]).toMatchObject({ principalCents: 11300, tipCents: 2000 });
    expect((await listPayments(database, f.scope.appointmentId))).toHaveLength(1);
  });

  it('retains the reservation when both expiration and verification are uncertain', async () => {
    const f = await capturedFixture();
    const claim = await repository.claimCancellation(f.actor, f.dispatched.state.revision, f.operationId);

    await expect(createWorkspaceStripeProvider(secret).dispatch(claim)).rejects.toThrow('CREATE_PERMIT_REQUIRED');

    sdk.expireSession.mockRejectedValue(new Error('timeout'));
    sdk.retrieveSession.mockRejectedValue(new Error('unavailable'));

    await expect(createWorkspaceStripeProvider(secret).expire(claim)).rejects.toThrow('timeout');
    await expect(reconcileWorkspacePayment(repository, f.scope, f.operationId, secret)).rejects.toThrow('unavailable');

    const held = await repository.read(f.actor);

    expect(held!.requests[0]!.state).toBe('processing');
    await expect(repository.command(f.actor, { kind: 'request_payment', requestId: randomUUID(), expectedRevision: held!.revision }, async () => ({ binding, billSourceHash: 'a'.repeat(64) }))).rejects.toThrow('BALANCE_HELD');
  });

  it('recovers a missing Session identity from signed ingress without trusting its paid label', async () => {
    const f = await fixture();
    sdk.createSession.mockRejectedValueOnce(new Error('response lost after request'));

    await expect(dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding)).rejects.toThrow('response lost');

    const session = await sdk.createSession.getMockImplementation()!(sdk.createSession.mock.calls.at(-1)![0]);
    const signingSecret = `whsec_${'recoveryfixture'.repeat(3)}`;
    const payload = JSON.stringify({ id: `evt_${f.operationId.replaceAll('-', '')}`, object: 'event', account: binding.connectedAccountId, api_version: '2024-06-20', livemode: false, type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { ...session, payment_status: 'paid' } } });
    const receipt = verifyStripeCustomerPaymentReceipt(Buffer.from(payload), Stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret }), { endpointId: 'we_recovery', platformAccountId: binding.platformAccountId, livemode: false, apiVersion: '2024-06-20', signingSecret });
    const saved = await repository.retainReceipt(receipt);
    const association = await repository.associateReceipt(saved.receiptId);

    expect(association).toMatchObject({ scope: f.scope, operationId: f.operationId, held: false });
    expect((await repository.read(f.actor))!.payments).toEqual([]);

    sdk.retrieveSession.mockResolvedValue({ ...session, payment_intent: null });
    const reconciled = await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);

    expect(reconciled.state.operations[0]!.state).toBe('open');
    expect(reconciled.state.payments).toEqual([]);
    expect(reconciled.checkoutUrl).toContain('https://checkout.stripe.com/');
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
  });

  it('posts one canonical tender and keeps historical money readable with collection disabled', async () => {
    const f = await capturedFixture();
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'false');
    const settled = await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);

    expect(settled.state.operations[0]!.state).toBe('succeeded');
    expect(settled.state.payments).toHaveLength(1);
    expect((await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret)).replayed).toBe(true);

    const tenders = await listPayments(database, f.scope.appointmentId);

    expect(tenders).toHaveLength(1);
    expect(hasVerifiedCustomerPaymentTender(tenders[0]!)).toBe(true);
    expect(customerPaymentTenderSummary(tenders[0]!)).toMatchObject({ grossCents: 13300, grossTipCents: 2000, netCents: 13300, collectionHold: false });
    expect((await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId)))[0]).toMatchObject({ amountPaidCents: 13300, paymentStatus: 'paid', tipCents: 2000 });
    await expect(client.query('DELETE FROM customer_payment_live_settlement WHERE operation_id=$1', [f.operationId])).rejects.toThrow('HISTORY_IMMUTABLE');
    await expect(client.query('UPDATE appointment_payment SET amount_cents=1 WHERE id=$1', [`lpay_${f.operationId}`])).rejects.toThrow('HISTORY_IMMUTABLE');
    await expect(database.transaction(tx => purgeSalonGroups(tx, f.scope.salonId, ['appointments']))).rejects.toBeInstanceOf(SalonPurgeBlockedError);
    expect(await listPayments(database, f.scope.appointmentId)).toHaveLength(1);
  });

  it('rejects forged or stale reads and leaves disputed/externally refunded charges held', async () => {
    const f = await capturedFixture();
    const provider = createWorkspaceStripeProvider(secret);
    const claim = await repository.claimReconciliation(f.scope, f.operationId);

    await expect(provider.reconcile(JSON.parse(JSON.stringify(claim)))).rejects.toThrow('RECONCILIATION_CLAIM_REQUIRED');

    const outcome = await provider.reconcile(claim);

    await expect(repository.applyVerifiedOutcome(JSON.parse(JSON.stringify(outcome)))).rejects.toThrow('VERIFIED_OUTCOME_REQUIRED');

    sdk.retrieveCharge.mockResolvedValue({ ...f.charge, amount_refunded: 100 });
    const held = await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);

    expect(held.state.operations[0]!.state).toBe('review');
    expect(held.state.payments).toEqual([]);
    await expect(repository.applyVerifiedOutcome(outcome)).rejects.toThrow('RECONCILIATION_STALE');
    expect(await listPayments(database, f.scope.appointmentId)).toEqual([]);
  });

  it('preserves a paid invoice, revises services, and refunds only after owner approval', async () => {
    const f = await capturedFixture();
    const settled = await reconcileWorkspacePayment(repository, f.scope, f.operationId, secret);
    const changed = await repository.reviseBill(f.actor, { requestId: randomUUID(), expectedRevision: settled.state.revision, changeFingerprint: 'b'.repeat(64), reason: 'Removed nail art and corrected tip' }, async (tx) => {
      await tx.update(schema.appointmentSchema).set({ totalPrice: 8000 }).where(eq(schema.appointmentSchema.id, f.scope.appointmentId));
      return { bill: { ...settled.state.bill, serviceCents: 8000, tipCents: 1000 }, billSourceHash: 'b'.repeat(64) };
    });
    const staff = { ...f.actor, role: 'staff' as const, id: f.technicianId };
    const requested = await repository.command(staff, { kind: 'request_refund', requestId: randomUUID(), expectedRevision: changed.state.revision, paymentId: `lpay_${f.operationId}`, principalCents: 2000, tipCents: 1000, reason: 'Customer approved service removal' }, async () => ({ binding: null, billSourceHash: 'b'.repeat(64) }));
    const refundOp = requested.state.operations[1]!;

    expect(refundOp.state).toBe('awaiting_approval');
    await expect(repository.claimDispatch(f.actor, refundOp.id, dispatchBinding)).rejects.toThrow('DISPATCH_HELD');
    await expect(repository.command(staff, { kind: 'approve_refund', requestId: randomUUID(), expectedRevision: requested.state.revision, operationId: refundOp.id }, async () => ({ binding: null, billSourceHash: 'b'.repeat(64) }))).rejects.toThrow('ACTION_FORBIDDEN');

    await repository.command(f.actor, { kind: 'approve_refund', requestId: randomUUID(), expectedRevision: requested.state.revision, operationId: refundOp.id }, async () => ({ binding: null, billSourceHash: 'b'.repeat(64) }));
    const refund = { ...response, id: `re_${refundOp.id.replaceAll('-', '')}`, object: 'refund', currency: 'cad', amount: 3000, charge: f.chargeId, payment_intent: f.paymentIntentId, status: 'succeeded', metadata: { luster_payment_operation: refundOp.id } };
    sdk.refund.mockResolvedValue(refund);
    const dispatched = await dispatchWorkspacePayment(repository, f.actor, refundOp.id, secret, dispatchBinding);

    expect(dispatched.state.refunds[0]!.state).toBe('pending');
    expect(customerPaymentTenderSummary((await listPayments(database, f.scope.appointmentId))[0]!).netCents).toBe(13300);

    sdk.retrieveRefund.mockResolvedValue(refund);
    sdk.listRefunds.mockResolvedValue({ ...response, data: [refund], has_more: false });
    sdk.retrieveCharge.mockResolvedValue({ ...f.charge, amount_refunded: 3000 });
    const refunded = await reconcileWorkspacePayment(repository, f.scope, refundOp.id, secret);

    expect(refunded.state.refunds[0]!.state).toBe('succeeded');

    const returnUrl = new URL(sdk.createSession.mock.calls[0]![0].success_url);

    expect(await repository.readReturnStatus(new URLSearchParams(returnUrl.hash.slice(1)).get('status')!, binding.returnOrigin)).toEqual({ status: 'received', currency: 'CAD', amountCents: 13300, refundedCents: 3000 });
    expect(refunded.state.billChanges[0]).toMatchObject({ reason: 'Removed nail art and corrected tip', actorId: 'owner' });
    expect(customerPaymentTenderSummary((await listPayments(database, f.scope.appointmentId))[0]!)).toMatchObject({ grossCents: 13300, refundedPrincipalCents: 2000, refundedTipCents: 1000, netCents: 10300, collectionHold: false });
    expect((await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.scope.appointmentId)))[0]).toMatchObject({ amountPaidCents: 10300, paymentStatus: 'paid', tipCents: 1000 });
    expect((await reconcileWorkspacePayment(repository, f.scope, refundOp.id, secret)).replayed).toBe(true);
  });
});

describe('committed workspace dispatch with mocked Stripe responses', () => {
  it('dispatches the saved amount/account and retains a minimal observation without marking paid', async () => {
    const f = await fixture();
    const result = await dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding);

    expect(result.checkoutUrl).toContain('https://checkout.stripe.com/');
    expect(result.state.operations[0]).toMatchObject({ state: 'open', providerObjectId: `cs_test_${f.operationId.replaceAll('-', '')}` });
    expect(result.state.payments).toEqual([]);
    expect(sdk.createSession).toHaveBeenCalledWith(expect.objectContaining({ line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: 13300, product_data: { name: 'Appointment payment' } } }] }), expect.objectContaining({ stripeAccount: 'acct_connected', idempotencyKey: `luster_cp_v1_${f.operationId}`, maxNetworkRetries: 0 }));

    const rows = await database.select().from(schema.customerPaymentLiveObservationSchema).where(eq(schema.customerPaymentLiveObservationSchema.appointmentId, f.scope.appointmentId));

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('private-capability');
    expect(JSON.stringify(rows)).not.toContain('checkoutUrl');
    expect(await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.scope.appointmentId))).toEqual([]);
  });

  it('retries an interrupted dispatch with exactly the same parameters and provider key', async () => {
    const f = await fixture();
    sdk.createSession.mockRejectedValueOnce(new Error('connection interrupted'));

    await expect(dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding)).rejects.toThrow('interrupted');
    expect((await repository.read(f.actor))!.requests[0]!.state).toBe('uncertain');

    await dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding);

    expect(sdk.createSession.mock.calls[1]).toEqual(sdk.createSession.mock.calls[0]);
  });

  it('rejects forged, changed and reused permits before issuing another API call', async () => {
    const f = await fixture();
    const claim = await repository.claimDispatch(f.actor, f.operationId, dispatchBinding);
    const provider = createWorkspaceStripeProvider(secret);

    await expect(provider.dispatch(JSON.parse(JSON.stringify(claim)))).rejects.toThrow('COMMITTED_DISPATCH_REQUIRED');

    claim.operation.principalCents += 1;

    await expect(provider.dispatch(claim)).rejects.toThrow('COMMITTED_DISPATCH_REQUIRED');

    claim.operation.principalCents -= 1;
    await provider.dispatch(claim);

    await expect(provider.dispatch(claim)).rejects.toThrow('COMMITTED_DISPATCH_REQUIRED');
    expect(sdk.createSession).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired permit before networking', async () => {
    const f = await fixture();
    const claim = await repository.claimDispatch(f.actor, f.operationId, dispatchBinding);
    const time = vi.spyOn(Date, 'now').mockReturnValue(claim.operation.dispatchUntil! + 1);
    try {
      await expect(createWorkspaceStripeProvider(secret).dispatch(claim)).rejects.toThrow('COMMITTED_DISPATCH_REQUIRED');
      expect(sdk.accounts).not.toHaveBeenCalled();
    } finally {
      time.mockRestore();
    }
  });

  it('keeps collection off by default and never crosses provider mode', async () => {
    const f = await fixture();
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'false');

    await expect(dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding)).rejects.toThrow('PROVIDER_DISABLED');
    expect(sdk.accounts).not.toHaveBeenCalled();

    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'true');
    sdk.balance.mockResolvedValue({ ...response, object: 'balance', livemode: true });

    await expect(dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding)).rejects.toThrow('MODE_MISMATCH');
    expect(sdk.createSession).not.toHaveBeenCalled();
    expect((await repository.read(f.actor))!.requests[0]!.state).toBe('uncertain');
  });

  it('does not claim settlement from a successful create response', async () => {
    const f = await fixture();
    const original = sdk.createSession.getMockImplementation()!;
    sdk.createSession.mockImplementation(async (...args) => ({ ...await original(...args), status: 'complete', payment_status: 'paid', url: null }));
    const result = await dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding);

    expect(result.state.operations[0]!.state).toBe('pending');
    expect(result.state.requests[0]!.state).toBe('processing');
    expect(result.state.payments).toEqual([]);
    expect(result.checkoutUrl).toBeNull();
  });

  it('holds a mismatched provider amount and retains late valid responses for review', async () => {
    const f = await fixture();
    const original = sdk.createSession.getMockImplementation()!;
    sdk.createSession.mockImplementationOnce(async (...args) => ({ ...await original(...args), amount_total: 1 }));

    await expect(dispatchWorkspacePayment(repository, f.actor, f.operationId, secret, dispatchBinding)).rejects.toThrow('SESSION_MISMATCH');

    const claim = await repository.claimDispatch(f.actor, f.operationId, dispatchBinding);
    const observation = await createWorkspaceStripeProvider(secret).dispatch(claim);
    await repository.recordUncertain(f.scope, f.operationId, claim.dispatchToken);
    const late = await repository.recordProviderObservation(observation);

    expect(late.state.operations[0]!.state).toBe('review');
    expect(late.state.payments).toEqual([]);
    expect((await repository.recordProviderObservation(observation)).replayed).toBe(true);
    await expect(repository.recordProviderObservation(JSON.parse(JSON.stringify(observation)))).rejects.toThrow('PROVIDER_PROOF_REQUIRED');
  });
});
