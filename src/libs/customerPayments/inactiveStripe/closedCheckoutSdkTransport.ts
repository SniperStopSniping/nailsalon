import 'server-only';

import { performance } from 'node:perf_hooks';

import type Stripe from 'stripe';
import { z } from 'zod';

import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { assertInactiveStripeCheckoutOperation, checkoutAdapterError, freezeCheckoutValue, INACTIVE_STRIPE_API_VERSION, requireInactiveStripeCheckoutRuntime } from './checkoutContract';
import { createInactiveStripeCheckoutSdkKernel } from './checkoutSdkKernel';
import type { DurableCheckoutLease, DurableCheckoutResult } from './durableCheckoutRepository';
import { consumeCommittedSdkAuthorization } from './durableCheckoutRepository';

/** This public literal is deliberately not a credential. No caller/env key is accepted. */
const CLOSED_SDK_DUMMY_KEY = 'sk_test_placeholder';
const stepSchema = z.object({
  method: z.enum(['GET', 'POST']),
  path: z.string().min(1).max(2048),
  account: z.string().optional(),
  response: z.record(z.unknown()).optional(),
  status: z.number().int().min(100).max(599).optional(),
  responseHeaders: z.record(z.string()).optional(),
  errorCode: z.enum(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']).optional(),
  pause: z.boolean().optional(),
}).strict();
export type ClosedCheckoutSdkStep = z.infer<typeof stepSchema>;
export type ClosedCheckoutSdkTransport = Readonly<{ kind: 'closed_checkout_sdk_http' }>;
type Call = Readonly<{ method: string; path: string; account: string | null; identityHash: string; idempotencyKey: string | null; apiVersion: string; parameterHash: string }>;
const transports = new WeakMap<ClosedCheckoutSdkTransport, { steps: ClosedCheckoutSdkStep[]; calls: Call[]; releases: Array<() => void> }>();

/** Static data only: no custom HttpClient, callback, socket or fallback is accepted. */
export function createClosedCheckoutSdkTransport(steps: readonly ClosedCheckoutSdkStep[]): ClosedCheckoutSdkTransport {
  requireInactiveStripeCheckoutRuntime();
  const parsed = z.array(stepSchema).max(1000).safeParse(steps);
  if (!parsed.success) {
    return checkoutAdapterError('INVALID_CLOSED_SDK_SCRIPT');
  }
  let copy: ClosedCheckoutSdkStep[];
  try {
    copy = structuredClone(parsed.data);
  } catch {
    return checkoutAdapterError('INVALID_CLOSED_SDK_SCRIPT');
  }
  const transport = Object.freeze({ kind: 'closed_checkout_sdk_http' as const });
  transports.set(transport, { steps: copy, calls: [], releases: [] });
  return transport;
}
export function assertClosedCheckoutSdkTransport(transport: ClosedCheckoutSdkTransport) {
  requireInactiveStripeCheckoutRuntime();
  if (!transports.has(transport)) {
    checkoutAdapterError('CLOSED_SDK_TRANSPORT_REQUIRED');
  }
}
export function inspectClosedCheckoutSdkTransport(transport: ClosedCheckoutSdkTransport) {
  assertClosedCheckoutSdkTransport(transport);
  const script = transports.get(transport)!;
  return Object.freeze({ calls: Object.freeze([...script.calls]), remaining: script.steps.length, paused: script.releases.length });
}
export function releaseClosedCheckoutSdkTransport(transport: ClosedCheckoutSdkTransport) {
  assertClosedCheckoutSdkTransport(transport);
  transports.get(transport)!.releases.shift()?.();
}

export type ClosedSdkCheckoutPermit = Readonly<{ databaseNow: number; sampleStarted: number; quoteExpiresAt: number | null; leaseUntil: number; sessionId: string | null }>;
export type ClosedSdkCheckoutAuthorization = Readonly<{ result: DurableCheckoutResult; lease: DurableCheckoutLease | null; permit: ClosedSdkCheckoutPermit | null }>;
export type ClosedSdkCheckoutOutcome = Readonly<{ kind: 'sdk_closed_http_outcome' }>;
type Evidence = { ok: true; response: unknown } | { ok: false };
const outcomes = new WeakMap<ClosedSdkCheckoutOutcome, { identityHash: string; claim: DurableCheckoutLease; evidence: Evidence }>();
function brandOutcome(operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease, evidence: Evidence): ClosedSdkCheckoutOutcome {
  const outcome = Object.freeze({ kind: 'sdk_closed_http_outcome' as const });
  outcomes.set(outcome, { identityHash: operation.identityHash, claim: freezeCheckoutValue(structuredClone(claim)), evidence: freezeCheckoutValue(structuredClone(evidence)) });
  return outcome;
}
/** Only an actual completed SDK invocation through this closed transport can produce evidence. */
export function getSdkClosedOutcome(outcome: ClosedSdkCheckoutOutcome, operation: InactiveStripeCheckoutOperation, claim: DurableCheckoutLease): Evidence {
  requireInactiveStripeCheckoutRuntime();
  assertInactiveStripeCheckoutOperation(operation);
  const value = outcomes.get(outcome);
  if (!value || value.identityHash !== operation.identityHash || value.claim.operationId !== claim.operationId
    || value.claim.version !== claim.version || value.claim.token !== claim.token || value.claim.activity !== claim.activity) {
    return checkoutAdapterError('DURABLE_CLOSED_SDK_OUTCOME_REQUIRED');
  }
  return value.evidence;
}

// Independent, bounded encoder for this immutable primitive-only parameter contract.
// Matches the installed SDK's indexed form serialization, without importing SDK internals.
function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function form(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => form(child, prefix ? `${prefix}[${key}]` : key));
  }
  if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') {
    return checkoutAdapterError('SDK_WIRE_PARAMETER_TYPE');
  }
  return [`${encode(prefix).replace(/%5B/g, '[').replace(/%5D/g, ']')}=${encode(String(value))}`];
}
function finalGate(permit: ClosedSdkCheckoutPermit, operation: InactiveStripeCheckoutOperation, activity: DurableCheckoutLease['activity'], sessionId: string | null) {
  requireInactiveStripeCheckoutRuntime();
  const elapsed = performance.now() - permit.sampleStarted;
  const upperNow = permit.databaseNow + Math.ceil(elapsed);
  if (![permit.databaseNow, permit.sampleStarted, permit.leaseUntil, upperNow].every(Number.isFinite)
    || elapsed < 0 || upperNow >= permit.leaseUntil || permit.sessionId !== sessionId
    || (activity === 'create' && (permit.quoteExpiresAt !== operation.material.quoteExpiresAt
      || upperNow < operation.material.createdAt || upperNow >= permit.quoteExpiresAt))
      || (activity === 'retrieve' && permit.quoteExpiresAt !== null)) {
    checkoutAdapterError('SDK_DISPATCH_DEADLINE');
  }
}
function sendClosed(transport: ClosedCheckoutSdkTransport, operation: InactiveStripeCheckoutOperation, args: Parameters<Stripe.HttpClient['makeRequest']>): Promise<Stripe.HttpClientResponse> {
  assertClosedCheckoutSdkTransport(transport);
  const [, , path, method, rawHeaders] = args;
  const headers = rawHeaders as Record<string, string>;
  const script = transports.get(transport)!;
  const step = script.steps.shift();
  script.calls.push(Object.freeze({ method, path, account: headers['Stripe-Account'] ?? null, identityHash: operation.identityHash, idempotencyKey: headers['Idempotency-Key'] ?? null, apiVersion: headers['Stripe-Version']!, parameterHash: operation.parameterHash }));
  if (!step || step.method !== method || step.path !== path || step.account !== headers['Stripe-Account']) {
    return Promise.reject(new Error('CLOSED_SDK_UNEXPECTED_REQUEST'));
  }
  return (async () => {
    if (step.pause) {
      await new Promise<void>((resolve) => {
        script.releases.push(resolve);
      });
    }
    if (step.errorCode) {
      throw Object.assign(new Error('CLOSED_SDK_SCRIPTED_FAILURE'), { code: step.errorCode });
    }
    const responseHeaders = {
      'request-id': 'req_closedSdk',
      'stripe-version': INACTIVE_STRIPE_API_VERSION,
      ...(headers['Stripe-Account'] ? { 'stripe-account': headers['Stripe-Account'] } : {}),
      ...(headers['Idempotency-Key'] ? { 'idempotency-key': headers['Idempotency-Key'] } : {}),
      ...step.responseHeaders,
    };
    return {
      getStatusCode: () => step.status ?? 200,
      getHeaders: () => responseHeaders,
      getRawResponse: () => ({ statusCode: step.status ?? 200 }),
      toStream: () => checkoutAdapterError('CLOSED_SDK_STREAM_FORBIDDEN'),
      toJSON: async () => structuredClone(step.response ?? {}),
    };
  })();
}

/** Internal execution seam. It exposes no client or arbitrary request method. */
export function createClosedCheckoutSdkExecution(transport: ClosedCheckoutSdkTransport, input: InactiveStripeCheckoutOperation, activity: DurableCheckoutLease['activity'], sessionId: string | null) {
  assertClosedCheckoutSdkTransport(transport);
  const operation = freezeCheckoutValue(structuredClone(input));
  assertInactiveStripeCheckoutOperation(operation);
  if (!['create', 'retrieve'].includes(activity) || (activity === 'create' ? sessionId !== null : !/^cs_test_[A-Za-z0-9]+$/.test(sessionId ?? ''))) {
    return checkoutAdapterError('SDK_EXACT_SESSION_REQUIRED');
  }
  const binding = operation.binding;
  const reads = [
    { path: '/v1/account', account: undefined },
    { path: '/v1/balance', account: undefined },
    { path: `/v1/accounts/${binding.connectedAccountId}`, account: undefined },
    { path: '/v1/balance', account: binding.connectedAccountId },
  ];
  let phase: 'ready' | 'preflight' | 'prepared' | 'dispatch' | 'finished' = 'ready';
  let readIndex = 0;
  let requested = false;
  let authorize: (() => Promise<ClosedSdkCheckoutAuthorization>) | null = null;
  let authorization: ClosedSdkCheckoutAuthorization | null = null;
  let executionClaim: DurableCheckoutLease | null = null;
  const httpClient: Stripe.HttpClient = {
    getClientName: () => 'durable-closed-sdk-http',
    async makeRequest(...args) {
      try {
        requireInactiveStripeCheckoutRuntime();
        const [host, port, path, method, rawHeaders, data, protocol, timeout] = args;
        const headers = rawHeaders as Record<string, string>;
        if (host !== 'api.stripe.com' || String(port) !== '443' || protocol !== 'https' || timeout !== 10000
          || headers.Authorization !== `Bearer ${CLOSED_SDK_DUMMY_KEY}` || headers['Stripe-Version'] !== INACTIVE_STRIPE_API_VERSION) {
          checkoutAdapterError('SDK_WIRE_SCOPE_MISMATCH');
        }
        if (phase === 'preflight') {
          const expected = reads[readIndex++];
          if (!expected || method !== 'GET' || path !== expected.path || headers['Stripe-Account'] !== expected.account
            || headers['Idempotency-Key'] !== undefined || data !== '') {
            checkoutAdapterError('SDK_PREFLIGHT_WIRE_MISMATCH');
          }
          return await sendClosed(transport, operation, args);
        }
        const expectedPath = activity === 'create' ? '/v1/checkout/sessions' : `/v1/checkout/sessions/${sessionId}?expand[0]=payment_intent.latest_charge`;
        if (phase !== 'dispatch' || requested || !authorize || path !== expectedPath
          || method !== (activity === 'create' ? 'POST' : 'GET') || headers['Stripe-Account'] !== binding.connectedAccountId
          || headers['Idempotency-Key'] !== (activity === 'create' ? operation.idempotencyKey : undefined)
          || data !== (activity === 'create' ? form(operation.params).join('&') : '')) {
          checkoutAdapterError('SDK_MUTATION_OR_RETRY_REJECTED');
        }
        requested = true;
        // The real SDK has finished its asynchronous preparation. This call returns
        // only after the one-use consumption marker is KNOWN committed.
        const candidate = await authorize();
        if (!candidate.permit && !candidate.lease) {
          authorization = { result: candidate.result, lease: null, permit: null };
          checkoutAdapterError('SDK_PERMIT_NOT_CONFIRMED');
        }
        const lease = candidate.lease;
        if (!candidate.permit || !lease || !executionClaim || lease.operationId !== executionClaim.operationId || lease.activity !== executionClaim.activity
          || lease.token !== executionClaim.token || lease.version !== executionClaim.version + 1) {
          checkoutAdapterError('SDK_PERMIT_NOT_CONFIRMED');
        }
        // Structural objects are not authority: only the repository can mint this
        // private capability after a confirmed commit. This consumes it once.
        const committed = consumeCommittedSdkAuthorization(candidate, operation, executionClaim);
        authorization = committed;
        finalGate(committed.permit!, operation, activity, sessionId);
        // No await, callback, external I/O or transaction between the final gate and
        // synchronous CLOSED script consumption. Source changes after commit can
        // still occur; the repository holds their late observation for review.
        return await sendClosed(transport, operation, args);
      } catch {
        // Stripe 16 retries ECONNRESET/EPIPE even when maxNetworkRetries is zero.
        // Never propagate those codes or private SDK/provider failure data.
        throw new Error('CLOSED_SDK_TRANSPORT_UNCERTAIN');
      }
    },
  };
  const kernel = createInactiveStripeCheckoutSdkKernel(binding, CLOSED_SDK_DUMMY_KEY, httpClient);
  return Object.freeze({
    async preflight() {
      requireInactiveStripeCheckoutRuntime();
      if (phase !== 'ready') {
        return checkoutAdapterError('SDK_EXECUTION_ALREADY_STARTED');
      }
      phase = 'preflight';
      try {
        await kernel.preflight(activity === 'create' ? 'create' : 'reconcile');
        phase = 'prepared';
      } catch {
        phase = 'finished';
        checkoutAdapterError('PREFLIGHT_FAILED_WITHOUT_CREATE');
      }
    },
    async execute(claim: DurableCheckoutLease, consume: () => Promise<ClosedSdkCheckoutAuthorization>): Promise<{ result: DurableCheckoutResult; lease: DurableCheckoutLease | null; outcome: ClosedSdkCheckoutOutcome | null }> {
      requireInactiveStripeCheckoutRuntime();
      if (phase !== 'prepared' || claim.activity !== activity || claim.operationId !== operation.material.operationId) {
        return checkoutAdapterError('SDK_EXECUTION_NOT_PREPARED');
      }
      phase = 'dispatch';
      executionClaim = freezeCheckoutValue(structuredClone(claim));
      authorize = consume;
      let evidence: Evidence;
      try {
        const response = activity === 'create' ? await kernel.create(operation) : await kernel.retrieve(sessionId!);
        requireInactiveStripeCheckoutRuntime();
        try {
          kernel.responseScope(response, true, activity === 'create' ? operation.idempotencyKey : undefined);
          evidence = { ok: true, response };
        } catch {
          // Preserve a rejected observation without retaining an unscoped response.
          evidence = { ok: true, response: {} };
        }
      } catch {
        evidence = { ok: false };
      } finally {
        phase = 'finished';
        authorize = null;
      }
      const committed = authorization as ClosedSdkCheckoutAuthorization | null;
      if (!committed) {
        return checkoutAdapterError('SDK_PERMIT_NOT_CONFIRMED');
      }
      return {
        result: committed.result,
        lease: committed.lease,
        outcome: committed.lease && committed.permit ? brandOutcome(operation, committed.lease, evidence) : null,
      };
    },
  });
}
