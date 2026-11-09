import 'server-only';

import Stripe from 'stripe';

import type { InactiveStripeCheckoutBinding, InactiveStripeCheckoutInput, InactiveStripeCheckoutOperation } from './checkoutContract';
import { assertInactiveStripeCheckoutOperation, buildInactiveStripeCheckoutOperation, checkoutAdapterError, checkoutBindingSchema, freezeCheckoutValue, INACTIVE_STRIPE_IDEMPOTENCY_WINDOW_MS, requireInactiveStripeCheckoutRuntime } from './checkoutContract';
import type { InactiveStripeSessionProjection } from './checkoutResponse';
import { inspectInactiveStripeSession } from './checkoutResponse';
import { createInactiveStripeCheckoutSdkKernel } from './checkoutSdkKernel';

export type InactiveStripeCheckoutConfiguration = {
  enabled: true;
  purpose: 'unregistered_test_adapter';
  binding: InactiveStripeCheckoutBinding;
  /** Explicit secure caller injection only. Never loaded from env or the global Stripe client. */
  testSecretKey: string;
  /** Tests MUST supply a closed HTTP implementation; never use the SDK's network transport in tests. */
  httpClient?: Stripe.HttpClient;
};

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
  const { preflight, responseScope, create: createSession, retrieve: retrieveSession } = createInactiveStripeCheckoutSdkKernel(binding, configuration.testSecretKey, guardedTransport);
  const entries = new WeakMap<InactiveStripeCheckoutOperation, Entry>();
  const identities = new Map<string, Entry>();
  const requests = new Map<string, Entry>();
  const appointments = new Map<string, Entry>();
  const objectOwners = new Map<string, Entry>();
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
        const session = await createSession(operation);
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
        const session = await retrieveSession(sessionId);
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
