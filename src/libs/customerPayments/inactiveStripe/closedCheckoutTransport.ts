import 'server-only';

import { performance } from 'node:perf_hooks';

import type { InactiveStripeCheckoutOperation } from './checkoutContract';
import { assertInactiveStripeCheckoutOperation, checkoutAdapterError, requireInactiveStripeCheckoutRuntime } from './checkoutContract';

/** A static in-memory script, not an implementation of a network transport interface. */
export type ClosedCheckoutFixtureStep = {
  kind: 'create' | 'retrieve';
  operationId: string;
  sessionId?: string;
  outcome: 'response' | 'timeout' | 'not_found';
  response?: unknown;
  /** Internal fixture barrier, released only by releaseClosedCheckoutFixture. */
  pause?: boolean;
};
export type ClosedCheckoutFixtureTransport = Readonly<{ kind: 'closed_checkout_fixture' }>;
type Call = Readonly<{ kind: 'create' | 'retrieve'; operationId: string; identityHash: string; sessionId: string | null }>;
const transports = new WeakMap<ClosedCheckoutFixtureTransport, { steps: ClosedCheckoutFixtureStep[]; calls: Call[]; releases: (() => void)[] }>();

export function createClosedCheckoutFixtureTransport(steps: readonly ClosedCheckoutFixtureStep[]): ClosedCheckoutFixtureTransport {
  requireInactiveStripeCheckoutRuntime();
  if (!Array.isArray(steps) || steps.length > 1000 || steps.some(step => !step || Object.keys(step).some(key => !['kind', 'operationId', 'sessionId', 'outcome', 'response', 'pause'].includes(key))
    || !['create', 'retrieve'].includes(step.kind) || !['response', 'timeout', 'not_found'].includes(step.outcome)
    || (step.pause !== undefined && typeof step.pause !== 'boolean'))) {
    return checkoutAdapterError('INVALID_CLOSED_FIXTURE_SCRIPT');
  }
  const transport = Object.freeze({ kind: 'closed_checkout_fixture' as const });
  transports.set(transport, { steps: steps.map(step => ({ ...step, response: structuredClone(step.response) })), calls: [], releases: [] });
  return transport;
}
export function assertClosedCheckoutFixtureTransport(transport: ClosedCheckoutFixtureTransport) {
  requireInactiveStripeCheckoutRuntime();
  if (!transports.has(transport)) {
    checkoutAdapterError('CLOSED_FIXTURE_TRANSPORT_REQUIRED');
  }
}
export function releaseClosedCheckoutFixture(transport: ClosedCheckoutFixtureTransport) {
  assertClosedCheckoutFixtureTransport(transport);
  transports.get(transport)!.releases.shift()?.();
}
export function inspectClosedCheckoutFixtureTransport(transport: ClosedCheckoutFixtureTransport) {
  assertClosedCheckoutFixtureTransport(transport);
  const entry = transports.get(transport)!;
  return Object.freeze({ calls: Object.freeze([...entry.calls]), remaining: entry.steps.length });
}
/** No callback, SDK, credentials, socket, fetch or fallback can be installed here. */
export function consumeClosedCheckoutFixture(transport: ClosedCheckoutFixtureTransport, operation: InactiveStripeCheckoutOperation, sessionId: string | null, deadline: { databaseNow: number; sampleStarted: number; quoteExpiresAt: number | null; leaseUntil: number }): Promise<unknown> {
  assertClosedCheckoutFixtureTransport(transport);
  assertInactiveStripeCheckoutOperation(operation);
  const entry = transports.get(transport)!;
  const upperNow = deadline.databaseNow + Math.ceil(performance.now() - deadline.sampleStarted);
  requireInactiveStripeCheckoutRuntime();
  if (!Number.isFinite(upperNow) || upperNow >= deadline.leaseUntil || (deadline.quoteExpiresAt !== null && upperNow >= deadline.quoteExpiresAt)) {
    return Promise.reject(new Error('CLOSED_CHECKOUT_DISPATCH_DEADLINE'));
  }
  const kind = sessionId === null ? 'create' : 'retrieve';
  const step = entry.steps.shift();
  entry.calls.push(Object.freeze({ kind, operationId: operation.material.operationId, identityHash: operation.identityHash, sessionId }));
  if (!step || step.kind !== kind || step.operationId !== operation.material.operationId || (kind === 'retrieve' && step.sessionId !== sessionId)) {
    return Promise.reject(new Error('CLOSED_CHECKOUT_UNEXPECTED_FIXTURE_CALL'));
  }
  return (async () => {
    if (step.pause) {
      await new Promise<void>((resolve) => {
        entry.releases.push(resolve);
      });
    }
    if (step.outcome !== 'response') {
      throw new Error('CLOSED_CHECKOUT_FIXTURE_OUTCOME_UNKNOWN');
    }
    return structuredClone(step.response);
  })();
}
