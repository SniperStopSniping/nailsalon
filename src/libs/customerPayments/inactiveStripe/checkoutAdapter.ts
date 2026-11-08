import 'server-only';

import Stripe from 'stripe';
import { z } from 'zod';

import type { InactiveStripeCheckoutBinding, InactiveStripeCheckoutInput, InactiveStripeCheckoutOperation } from './checkoutContract';
import { assertInactiveStripeCheckoutOperation, buildInactiveStripeCheckoutOperation, checkoutAdapterError, checkoutBindingSchema, freezeCheckoutValue, INACTIVE_STRIPE_API_VERSION, INACTIVE_STRIPE_IDEMPOTENCY_WINDOW_MS, requireInactiveStripeCheckoutRuntime, stripeAccountIdSchema } from './checkoutContract';
import type { InactiveStripeSessionProjection } from './checkoutResponse';
import { inspectInactiveStripeSession } from './checkoutResponse';

export type InactiveStripeCheckoutConfiguration = {
  enabled: true;
  purpose: 'unregistered_test_adapter';
  binding: InactiveStripeCheckoutBinding;
  /** Explicit secure caller injection only. Never loaded from env or the global Stripe client. */
  testSecretKey: string;
  /** Tests MUST supply a closed HTTP implementation; never use the SDK's network transport in tests. */
  httpClient?: Stripe.HttpClient;
};

const accountSchema = z.object({ id: stripeAccountIdSchema, object: z.literal('account') });
const connectedAccountScopeSchema = accountSchema.extend({
  country: z.literal('CA'),
  default_currency: z.literal('cad'),
  controller: z.object({
    stripe_dashboard: z.object({ type: z.literal('full') }),
    fees: z.object({ payer: z.literal('account') }),
    losses: z.object({ payments: z.literal('stripe') }),
    requirement_collection: z.literal('stripe'),
  }),
});
const connectedAccountCreationSchema = connectedAccountScopeSchema.extend({
  charges_enabled: z.literal(true),
  payouts_enabled: z.literal(true),
  details_submitted: z.literal(true),
  capabilities: z.object({ card_payments: z.literal('active') }),
  requirements: z.object({
    disabled_reason: z.null(),
    currently_due: z.array(z.unknown()).length(0),
    past_due: z.array(z.unknown()).length(0),
    pending_verification: z.array(z.unknown()).length(0),
    errors: z.array(z.unknown()).length(0).nullable(),
  }),
});
// Stripe Account has no livemode property. Balance and payment objects do.
const balanceSchema = z.object({ object: z.literal('balance'), livemode: z.literal(false) });

export type InactiveStripeCheckoutResult = Readonly<{
  operationId: string;
  identityHash: string;
  state: 'prepared' | 'preflighting' | 'dispatching' | 'uncertain' | 'session_observed' | 'review';
  reason: 'not_dispatched' | 'session_response' | 'create_outcome_unknown' | 'session_evidence_mismatch'
    | 'retrieval_unresolved' | 'no_bound_session' | 'object_ownership_conflict';
  evidence: 'unregistered_test_sdk_response';
  /** Mock HTTP responses are NOT distinguished from genuine responses by this diagnostic adapter. */
  providerOriginVerified: false;
  financialPostingAllowed: false;
  session: InactiveStripeSessionProjection | null;
}>;
type Entry = {
  operation: InactiveStripeCheckoutOperation;
  result: InactiveStripeCheckoutResult;
  firstDispatchedAt: number | null;
  createSent: boolean;
  reconciling: boolean;
};

/**
 * Implemented SDK operations, deliberately UNREGISTERED and test-runtime-only.
 * No constructor requests. No money writer, webhook consumer or durable journal.
 * The private state prevents in-process duplicate creates, NOT process-restart races.
 * A future driver must durably reserve identity/ownership before calling an SDK.
 */
export function createInactiveStripeCheckoutAdapter(configuration: InactiveStripeCheckoutConfiguration) {
  requireInactiveStripeCheckoutRuntime();
  const parsed = checkoutBindingSchema.safeParse(configuration.binding);
  if (configuration.enabled !== true || configuration.purpose !== 'unregistered_test_adapter' || !parsed.success
    || typeof configuration.testSecretKey !== 'string'
    || configuration.testSecretKey.trim() !== configuration.testSecretKey
    || !/^sk_test_[A-Za-z0-9]{8,200}$/.test(configuration.testSecretKey)) {
    return checkoutAdapterError('INVALID_TEST_CONFIGURATION');
  }
  const binding = freezeCheckoutValue(parsed.data);
  const dispatchEntries = new Map<string, Entry>();
  const transport = configuration.httpClient ?? Stripe.createNodeHttpClient();
  const send = transport.makeRequest.bind(transport);
  const guardedTransport: Stripe.HttpClient = {
    getClientName: () => 'inactive-stripe-checkout',
    async makeRequest(...args) {
      requireInactiveStripeCheckoutRuntime();
      if (args[3] !== 'GET') {
        const headers = args[4] as Record<string, string>;
        const entry = dispatchEntries.get(headers['Idempotency-Key'] ?? '');
        if (args[3] !== 'POST' || args[2] !== '/v1/checkout/sessions' || !entry
          || entry.result.state !== 'dispatching' || entry.createSent) {
          checkoutAdapterError('UNEXPECTED_MUTATION_OR_RETRY');
        }
        // Stripe awaits SDK setup after create() is called, so gate freshness at the real send too.
        fresh(entry.operation);
        entry.createSent = true;
      }
      try {
        return await send(...args);
      } catch {
        // SDK 16.12.0 retries ECONNRESET/EPIPE once EVEN with maxNetworkRetries=0.
        // Strip those codes and all raw error details to guarantee no hidden POST retry.
        throw new Error('INACTIVE_STRIPE_CHECKOUT_TRANSPORT_UNCERTAIN');
      }
    },
  };
  const client = new Stripe(configuration.testSecretKey, {
    apiVersion: INACTIVE_STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    timeout: 10000,
    telemetry: false,
    httpClient: guardedTransport,
  });
  const entries = new WeakMap<InactiveStripeCheckoutOperation, Entry>();
  const identities = new Map<string, Entry>();
  const requests = new Map<string, Entry>();
  const appointments = new Map<string, Entry>();
  const objectOwners = new Map<string, Entry>();
  const options = (connected = false): Stripe.RequestOptions => ({
    apiVersion: INACTIVE_STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    ...(connected ? { stripeAccount: binding.connectedAccountId } : {}),
  });
  function result(entry: Entry, patch: Partial<InactiveStripeCheckoutResult>): InactiveStripeCheckoutResult {
    // Another operation may raise an ownership hold while this one awaits HTTP.
    // No late success/error may clear that hold or erase the last valid facts.
    if (entry.result.state === 'review' && patch.state !== 'review') {
      return entry.result;
    }
    entry.result = freezeCheckoutValue({ ...entry.result, ...patch });
    return entry.result;
  }
  function lookup(operation: InactiveStripeCheckoutOperation): Entry {
    requireInactiveStripeCheckoutRuntime();
    const entry = entries.get(operation);
    if (!entry) {
      return checkoutAdapterError('UNKNOWN_OPERATION_HANDLE');
    }
    assertInactiveStripeCheckoutOperation(operation);
    return entry;
  }
  function responseScope(response: { lastResponse?: Stripe.Response<unknown>['lastResponse'] }, connected: boolean, idempotencyKey?: string) {
    const context = response.lastResponse;
    if (!context || context.statusCode !== 200
      || (context.apiVersion !== undefined && context.apiVersion !== INACTIVE_STRIPE_API_VERSION)
      || (context.stripeAccount !== undefined && context.stripeAccount !== (connected ? binding.connectedAccountId : binding.platformAccountId))
      || (idempotencyKey !== undefined && context.idempotencyKey !== undefined && context.idempotencyKey !== idempotencyKey)) {
      checkoutAdapterError('RESPONSE_SCOPE_MISMATCH');
    }
  }
  async function preflight(purpose: 'create' | 'reconcile'): Promise<void> {
    requireInactiveStripeCheckoutRuntime();
    const platform = await client.accounts.retrieve({}, options());
    requireInactiveStripeCheckoutRuntime();
    responseScope(platform, false);
    if (!accountSchema.safeParse(platform).success || platform.id !== binding.platformAccountId) {
      checkoutAdapterError('PLATFORM_MISMATCH');
    }
    const platformBalance = await client.balance.retrieve({}, options());
    requireInactiveStripeCheckoutRuntime();
    responseScope(platformBalance, false);
    if (!balanceSchema.safeParse(platformBalance).success) {
      checkoutAdapterError('PLATFORM_MODE_MISMATCH');
    }
    const connected = await client.accounts.retrieve(binding.connectedAccountId, {}, options());
    requireInactiveStripeCheckoutRuntime();
    responseScope(connected, false);
    if (!connectedAccountScopeSchema.safeParse(connected).success || connected.id !== binding.connectedAccountId) {
      checkoutAdapterError('CONNECTED_ACCOUNT_SCOPE_MISMATCH');
    }
    // Existing money must remain inspectable if readiness changes after checkout creation.
    // This does not relax provider authorization, account/controller scope or actual test mode.
    if (purpose === 'create' && !connectedAccountCreationSchema.safeParse(connected).success) {
      checkoutAdapterError('CONNECTED_ACCOUNT_NOT_READY');
    }
    const connectedBalance = await client.balance.retrieve({}, options(true));
    requireInactiveStripeCheckoutRuntime();
    responseScope(connectedBalance, true);
    if (!balanceSchema.safeParse(connectedBalance).success) {
      checkoutAdapterError('CONNECTED_MODE_MISMATCH');
    }
  }
  function fresh(operation: InactiveStripeCheckoutOperation) {
    const now = Date.now();
    if (!Number.isSafeInteger(now) || now < operation.material.createdAt || now >= operation.material.quoteExpiresAt) {
      checkoutAdapterError('QUOTE_EXPIRED');
    }
  }
  function observe(entry: Entry, raw: Stripe.Response<Stripe.Checkout.Session>, creating: boolean): InactiveStripeCheckoutResult {
    try {
      responseScope(raw, true, creating ? entry.operation.idempotencyKey : undefined);
      const session = inspectInactiveStripeSession(raw, entry.operation, entry.result.session);
      // Reserve all known immutable provider identities, never client_reference_id/metadata.
      const ids = [session.sessionId, session.paymentIntentId, session.feeCheck === 'captured_charge_amount_matches' ? session.chargeId : null].filter((id): id is string => id !== null);
      const conflicts = ids.map(id => objectOwners.get(id)).filter((owner): owner is Entry => owner !== undefined && owner !== entry);
      if (conflicts.length) {
        for (const owner of conflicts) {
          result(owner, { state: 'review', reason: 'object_ownership_conflict' });
        }
        return result(entry, { state: 'review', reason: 'object_ownership_conflict' });
      }
      ids.forEach(id => objectOwners.set(id, entry));
      return result(entry, { state: 'session_observed', reason: 'session_response', session });
    } catch {
      // Never expose SDK error/raw body/PII/key material. Retain the last valid observation.
      return result(entry, { state: 'review', reason: 'session_evidence_mismatch' });
    }
  }
  return Object.freeze({
    prepare(input: InactiveStripeCheckoutInput): InactiveStripeCheckoutOperation {
      requireInactiveStripeCheckoutRuntime();
      const operation = buildInactiveStripeCheckoutOperation(input, binding);
      const existing = identities.get(operation.material.operationId);
      if (existing) {
        if (existing.operation.identityHash !== operation.identityHash) {
          return checkoutAdapterError('IMMUTABLE_IDENTITY_MISMATCH');
        }
        return existing.operation;
      }
      const appointmentKey = JSON.stringify([operation.material.salonId, operation.material.appointmentId]);
      if (requests.has(operation.material.requestId) || appointments.has(appointmentKey)) {
        return checkoutAdapterError('OPERATION_ALREADY_RESERVED');
      }
      const entry: Entry = {
        operation,
        firstDispatchedAt: null,
        createSent: false,
        reconciling: false,
        result: freezeCheckoutValue({ operationId: operation.material.operationId, identityHash: operation.identityHash, state: 'prepared', reason: 'not_dispatched', evidence: 'unregistered_test_sdk_response', providerOriginVerified: false, financialPostingAllowed: false, session: null }),
      };
      entries.set(operation, entry);
      identities.set(operation.material.operationId, entry);
      requests.set(operation.material.requestId, entry);
      appointments.set(appointmentKey, entry);
      dispatchEntries.set(operation.idempotencyKey, entry);
      return operation;
    },
    inspect(operation: InactiveStripeCheckoutOperation): InactiveStripeCheckoutResult {
      return lookup(operation).result;
    },
    async create(operation: InactiveStripeCheckoutOperation): Promise<InactiveStripeCheckoutResult> {
      const entry = lookup(operation);
      if (entry.result.state === 'session_observed' || entry.result.state === 'review') {
        return entry.result;
      }
      if (entry.result.state !== 'prepared' || entry.firstDispatchedAt !== null) {
        return checkoutAdapterError('RECONCILIATION_REQUIRED');
      }
      fresh(operation);
      result(entry, { state: 'preflighting' });
      try {
        await preflight('create');
        requireInactiveStripeCheckoutRuntime();
        fresh(operation);
      } catch {
        result(entry, { state: 'prepared', reason: 'not_dispatched' });
        return checkoutAdapterError('PREFLIGHT_FAILED_WITHOUT_CREATE');
      }
      // No await between the last gate and marking dispatch. A thrown POST is uncertain.
      entry.firstDispatchedAt = Date.now();
      result(entry, { state: 'dispatching' });
      try {
        const session = await client.checkout.sessions.create(structuredClone(operation.params), { ...options(true), idempotencyKey: operation.idempotencyKey });
        requireInactiveStripeCheckoutRuntime();
        return observe(entry, session, true);
      } catch {
        return result(entry, { state: 'uncertain', reason: 'create_outcome_unknown' });
      }
    },
    async reconcile(operation: InactiveStripeCheckoutOperation): Promise<InactiveStripeCheckoutResult> {
      const entry = lookup(operation);
      if (entry.reconciling || ['prepared', 'preflighting', 'dispatching'].includes(entry.result.state)) {
        return checkoutAdapterError('OPERATION_BUSY_OR_NOT_DISPATCHED');
      }
      if (entry.result.state === 'review') {
        return entry.result;
      }
      if (!entry.result.session) {
        // Stripe has no retrieve-by-idempotency-key API. Search/metadata/404 is not absence proof.
        const expired = entry.firstDispatchedAt === null || Date.now() >= entry.firstDispatchedAt + INACTIVE_STRIPE_IDEMPOTENCY_WINDOW_MS;
        return result(entry, { state: expired ? 'review' : 'uncertain', reason: 'no_bound_session' });
      }
      const sessionId = entry.result.session.sessionId;
      entry.reconciling = true;
      try {
        await preflight('reconcile');
        requireInactiveStripeCheckoutRuntime();
        const session = await client.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] }, options(true));
        requireInactiveStripeCheckoutRuntime();
        return observe(entry, session, false);
      } catch {
        // Read failure cannot erase observed money, establish absence, or permit another create.
        return result(entry, { state: 'uncertain', reason: 'retrieval_unresolved' });
      } finally {
        entry.reconciling = false;
      }
    },
  });
}
