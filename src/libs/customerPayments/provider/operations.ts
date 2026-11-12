import { createHash } from 'node:crypto';

import { z } from 'zod';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';

export const OPERATION_RETENTION_MS = 23 * 60 * 60 * 1000;
const uuid = z.string().uuid();
const identifier = z.string().min(1).max(200).regex(/^[\w-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const cents = z.number().int().positive().max(50_000_000);
const returnUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash
    && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
});
const checkoutParameters = z.object({
  mode: z.literal('payment'),
  payment_method_types: z.tuple([z.literal('card')]),
  client_reference_id: identifier,
  success_url: returnUrl,
  cancel_url: returnUrl,
  line_items: z.tuple([z.object({ quantity: z.literal(1), price_data: z.object({ currency: z.literal('cad'), unit_amount: cents, product_data: z.object({ name: z.enum(['Appointment payment and optional tip', 'Appointment deposit and optional tip']) }).strict() }).strict() }).strict()]),
  payment_intent_data: z.object({ application_fee_amount: z.number().int().min(0).max(50_000_000) }).strict(),
}).strict().refine(value => value.payment_intent_data.application_fee_amount < value.line_items[0].price_data.unit_amount);
const common = z.object({
  id: uuid,
  salonId: identifier,
  appointmentId: identifier,
  quoteId: identifier,
  requestId: uuid,
  contextHash: hash,
  platformId: z.string().max(200).regex(/^acct_[A-Za-z0-9]+$/),
  mode: z.literal('test'),
  apiVersion: z.literal('2024-06-20'),
  provenance: z.literal('offline_fixture'),
}).strict();
const identityInputSchema = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('checkout_create'), accountScope: z.literal('connected'), accountId: z.string().max(200).regex(/^acct_[A-Za-z0-9]+$/), targetId: z.null(), parameters: checkoutParameters }).strict(),
  common.extend({ kind: z.literal('customer_refund'), accountScope: z.literal('connected'), accountId: z.string().max(200).regex(/^acct_[A-Za-z0-9]+$/), targetId: z.string().max(200).regex(/^pi_[A-Za-z0-9]+$/), parameters: z.object({ payment_intent: z.string().max(200).regex(/^pi_[A-Za-z0-9]+$/), amount: cents }).strict() }).strict(),
  common.extend({ kind: z.literal('application_fee_refund'), accountScope: z.literal('platform'), accountId: z.null(), targetId: z.string().max(200).regex(/^fee_[A-Za-z0-9]+$/), parameters: z.object({ amount: cents }).strict() }).strict(),
]);
export type OperationIdentityInput = z.infer<typeof identityInputSchema>;
export type OperationIdentity = OperationIdentityInput & { parameterHash: string; idempotencyKey: string };
function fail(code: string): never {
  throw new Error(`CUSTOMER_PAYMENT_OPERATION_${code}`);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
/** Only strict supported DTOs reach this serializer; arrays preserve exact order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function createOperationIdentity(input: OperationIdentityInput): OperationIdentity {
  const parsed = identityInputSchema.parse(input);
  if (parsed.accountScope === 'connected' && parsed.accountId === parsed.platformId) {
    fail('SCOPE_MISMATCH');
  }
  if (parsed.kind === 'customer_refund' && parsed.targetId !== parsed.parameters.payment_intent) {
    fail('TARGET_MISMATCH');
  }
  if (parsed.kind === 'checkout_create' && parsed.parameters.client_reference_id !== parsed.quoteId) {
    fail('QUOTE_REFERENCE_MISMATCH');
  }
  const parameterHash = digest(parsed.parameters);
  return freeze({ ...parsed, parameterHash, idempotencyKey: `cpay_fixture_${digest({ ...parsed, parameterHash })}` });
}
export function validateOperationIdentity(identity: OperationIdentity): OperationIdentity {
  const { parameterHash, idempotencyKey, ...input } = identity;
  const checked = createOperationIdentity(input);
  if (parameterHash !== checked.parameterHash || idempotencyKey !== checked.idempotencyKey) {
    fail('IDENTITY_MISMATCH');
  }
  return checked;
}
export type OperationResult = { provenance: 'offline_fixture'; objectId: string } | { provenance: 'offline_fixture'; rejectionCode: 'invalid_request' | 'not_permitted' };
export type OperationState = {
  identity: OperationIdentity;
  state: 'queued' | 'claimed' | 'dispatching' | 'uncertain' | 'succeeded' | 'failed' | 'review';
  version: number;
  createdAt: number;
  updatedAt: number;
  leaseToken: string | null;
  leaseUntil: number | null;
  leasePurpose: 'dispatch' | 'reconcile' | null;
  firstDispatchedAt: number | null;
  idempotencyExpiresAt: number | null;
  result: OperationResult | null;
};
export type DispatchObservation = { type: 'accepted'; objectId: string } | { type: 'rejected_without_execution'; code: 'invalid_request' | 'not_permitted' } | { type: 'uncertain' };
export type ReconciliationObservation = { type: 'exists'; objectId: string } | { type: 'authoritatively_absent' } | { type: 'unresolved' };
const dispatchSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('accepted'), objectId: identifier }).strict(), z.object({ type: z.literal('rejected_without_execution'), code: z.enum(['invalid_request', 'not_permitted']) }).strict(), z.object({ type: z.literal('uncertain') }).strict()]);
const reconciliationSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('exists'), objectId: identifier }).strict(), z.object({ type: z.literal('authoritatively_absent') }).strict(), z.object({ type: z.literal('unresolved') }).strict()]);
const stateSchema = z.object({
  identity: z.unknown(),
  state: z.enum(['queued', 'claimed', 'dispatching', 'uncertain', 'succeeded', 'failed', 'review']),
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  createdAt: timestamp,
  updatedAt: timestamp,
  leaseToken: uuid.nullable(),
  leaseUntil: timestamp.nullable(),
  leasePurpose: z.enum(['dispatch', 'reconcile']).nullable(),
  firstDispatchedAt: timestamp.nullable(),
  idempotencyExpiresAt: timestamp.nullable(),
  result: z.union([z.object({ provenance: z.literal('offline_fixture'), objectId: identifier }).strict(), z.object({ provenance: z.literal('offline_fixture'), rejectionCode: z.enum(['invalid_request', 'not_permitted']) }).strict()]).nullable(),
}).strict();
export function validateOperationState(state: OperationState): OperationState {
  const parsed = stateSchema.parse(state);
  validateOperationIdentity(state.identity);
  if (parsed.createdAt > parsed.updatedAt
    || (parsed.firstDispatchedAt === null) !== (parsed.idempotencyExpiresAt === null)
    || (parsed.firstDispatchedAt !== null && (parsed.firstDispatchedAt < parsed.createdAt || parsed.firstDispatchedAt > parsed.updatedAt || parsed.idempotencyExpiresAt !== parsed.firstDispatchedAt + OPERATION_RETENTION_MS))) {
    fail('INVALID_STATE');
  }
  const leased = parsed.leaseToken !== null;
  if (leased !== (parsed.leaseUntil !== null) || leased !== (parsed.leasePurpose !== null)
    || (leased && parsed.leaseUntil! <= parsed.updatedAt)
    || (['queued', 'succeeded', 'failed', 'review'].includes(parsed.state) && leased)
    || (['claimed', 'dispatching'].includes(parsed.state) && (!leased || parsed.leasePurpose !== 'dispatch'))
    || (parsed.state === 'uncertain' && leased && parsed.leasePurpose !== 'reconcile')
    || (['dispatching', 'uncertain', 'succeeded', 'failed'].includes(parsed.state) && parsed.firstDispatchedAt === null)) {
    fail('INVALID_STATE');
  }
  if (parsed.state === 'succeeded') {
    if (!parsed.result || !('objectId' in parsed.result)) {
      fail('INVALID_STATE');
    }
    objectResult(state, parsed.result.objectId);
  } else if (parsed.state === 'failed') {
    if (!parsed.result || !('rejectionCode' in parsed.result)) {
      fail('INVALID_STATE');
    }
  } else if (parsed.result !== null) {
    fail('INVALID_STATE');
  }
  return state;
}
const observationAuthority = new WeakMap<object, { key: string; kind: 'dispatch' | 'reconcile'; observedAt: number; version: number; leaseToken: string }>();
declare const observationBrand: unique symbol;
export type BoundDispatchObservation = DispatchObservation & { readonly [observationBrand]: 'dispatch' };
export type BoundReconciliationObservation = ReconciliationObservation & { readonly [observationBrand]: 'reconcile' };
function assertObservation(state: OperationState, observation: unknown, kind: 'dispatch' | 'reconcile', now: number) {
  const authority = typeof observation === 'object' && observation !== null ? observationAuthority.get(observation) : undefined;
  if (!authority || authority.key !== state.identity.idempotencyKey || authority.kind !== kind
    || authority.version !== state.version || authority.leaseToken !== state.leaseToken
    || authority.observedAt < state.updatedAt || authority.observedAt > now) {
    fail('UNTRUSTED_OBSERVATION');
  }
}
function check(state: OperationState, version: number, now: number) {
  validateOperationState(state);
  timestamp.parse(now);
  if (!Number.isSafeInteger(state.version) || state.version < 0 || version !== state.version || now < state.updatedAt) {
    fail('STALE_VERSION');
  }
}
function next(state: OperationState, now: number, patch: Partial<OperationState>): OperationState {
  if (state.version >= Number.MAX_SAFE_INTEGER) {
    fail('VERSION_EXHAUSTED');
  }
  return freeze({ ...state, ...patch, updatedAt: now, version: state.version + 1 });
}
const noLease = { leaseToken: null, leaseUntil: null, leasePurpose: null };
export function createOperation(identity: OperationIdentity, now: number): OperationState {
  timestamp.parse(now);
  return freeze({ identity: validateOperationIdentity(identity), state: 'queued', version: 0, createdAt: now, updatedAt: now, ...noLease, firstDispatchedAt: null, idempotencyExpiresAt: null, result: null });
}
export function claimOperation(state: OperationState, input: { expectedVersion: number; leaseToken: string; leaseDurationMs: number; now: number; purpose: 'dispatch' | 'reconcile' }): OperationState {
  check(state, input.expectedVersion, input.now);
  uuid.parse(input.leaseToken);
  z.enum(['dispatch', 'reconcile']).parse(input.purpose);
  z.number().int().min(1000).max(300_000).parse(input.leaseDurationMs);
  if (state.leaseUntil !== null && state.leaseUntil > input.now) {
    fail('LEASE_BUSY');
  }
  if (input.purpose === 'dispatch') {
    if (!['queued', 'claimed'].includes(state.state)) {
      fail('RECONCILIATION_REQUIRED');
    }
    if (state.idempotencyExpiresAt !== null && input.now >= state.idempotencyExpiresAt) {
      return next(state, input.now, { state: 'review', ...noLease });
    }
  } else if (state.state !== 'uncertain') {
    fail('NOT_UNCERTAIN');
  }
  const leaseUntil = input.now + input.leaseDurationMs;
  timestamp.parse(leaseUntil);
  return next(state, input.now, { state: input.purpose === 'dispatch' ? 'claimed' : 'uncertain', leaseToken: input.leaseToken, leaseUntil: input.purpose === 'dispatch' && state.idempotencyExpiresAt !== null ? Math.min(leaseUntil, state.idempotencyExpiresAt) : leaseUntil, leasePurpose: input.purpose });
}
function fenced(state: OperationState, input: { expectedVersion: number; leaseToken: string; now: number }, purpose: 'dispatch' | 'reconcile') {
  check(state, input.expectedVersion, input.now);
  if (!state.leaseToken || state.leaseToken !== input.leaseToken || state.leasePurpose !== purpose || state.leaseUntil === null || input.now >= state.leaseUntil) {
    fail('LEASE_LOST');
  }
}
export function beginOperationDispatch(state: OperationState, input: { expectedVersion: number; leaseToken: string; now: number }): OperationState {
  fenced(state, input, 'dispatch');
  if (state.state !== 'claimed') {
    fail('INVALID_TRANSITION');
  }
  const expiry = state.idempotencyExpiresAt ?? input.now + OPERATION_RETENTION_MS;
  timestamp.parse(expiry);
  if (input.now >= expiry) {
    fail('RETENTION_EXPIRED');
  }
  return next(state, input.now, { state: 'dispatching', firstDispatchedAt: state.firstDispatchedAt ?? input.now, idempotencyExpiresAt: expiry });
}
export function expireOperationLease(state: OperationState, input: { expectedVersion: number; now: number }): OperationState {
  check(state, input.expectedVersion, input.now);
  if (state.leaseUntil === null || input.now < state.leaseUntil) {
    fail('LEASE_NOT_EXPIRED');
  }
  if (!['claimed', 'dispatching', 'uncertain'].includes(state.state)) {
    fail('INVALID_TRANSITION');
  }
  return next(state, input.now, { state: state.state === 'claimed' ? 'queued' : 'uncertain', ...noLease });
}
function objectResult(state: OperationState, objectId: string): OperationResult {
  const prefix = state.identity.kind === 'checkout_create' ? 'cs_' : state.identity.kind === 'customer_refund' ? 're_' : 'fr_';
  // Legacy short fixture IDs remain readable; live and secret-shaped IDs do not.
  const pattern = state.identity.kind === 'checkout_create' ? /^cs_(?:test_)?[A-Za-z0-9]+$/ : new RegExp(`^${prefix}[A-Za-z0-9]+$`);
  if (!pattern.test(objectId)) {
    fail('RESULT_KIND_MISMATCH');
  }
  return { provenance: 'offline_fixture', objectId };
}
export function observeOperationDispatch(state: OperationState, input: { expectedVersion: number; leaseToken: string; now: number; observation: BoundDispatchObservation }): OperationState {
  fenced(state, input, 'dispatch');
  if (state.state !== 'dispatching') {
    fail('INVALID_TRANSITION');
  }
  assertObservation(state, input.observation, 'dispatch', input.now);
  const observation = dispatchSchema.parse(input.observation);
  if (observation.type === 'uncertain') {
    return next(state, input.now, { state: 'uncertain', ...noLease });
  }
  return next(state, input.now, { state: observation.type === 'accepted' ? 'succeeded' : 'failed', ...noLease, result: observation.type === 'accepted' ? objectResult(state, observation.objectId) : { provenance: 'offline_fixture', rejectionCode: observation.code } });
}
export function reconcileOperation(state: OperationState, input: { expectedVersion: number; leaseToken: string; now: number; observation: BoundReconciliationObservation }): OperationState {
  fenced(state, input, 'reconcile');
  if (state.state !== 'uncertain') {
    fail('INVALID_TRANSITION');
  }
  assertObservation(state, input.observation, 'reconcile', input.now);
  const observation = reconciliationSchema.parse(input.observation);
  if (observation.type === 'exists') {
    return next(state, input.now, { state: 'succeeded', result: objectResult(state, observation.objectId), ...noLease });
  }
  const safe = observation.type === 'authoritatively_absent' && state.idempotencyExpiresAt !== null && input.now < state.idempotencyExpiresAt;
  return next(state, input.now, { state: safe ? 'queued' : 'review', ...noLease });
}

/** A closed response map, never an injected callback or SDK; results are not financial evidence. */
export type OfflineOperationFixture = { identity: OperationIdentity; dispatch: DispatchObservation; reconciliation: ReconciliationObservation };
export type OfflineOperationTransport = { readonly provenance: 'offline_fixture'; execute: (state: OperationState, observedAt: number) => Promise<BoundDispatchObservation>; reconcile: (state: OperationState, observedAt: number) => Promise<BoundReconciliationObservation> };
const offlineTransports = new WeakSet<object>();
export function isOfflineOperationTransport(value: unknown): value is OfflineOperationTransport {
  return typeof value === 'object' && value !== null && offlineTransports.has(value);
}
export function createOfflineOperationTransport(fixtures: readonly OfflineOperationFixture[]): OfflineOperationTransport {
  requireCustomerPaymentProviderFixtureEnabled();
  if (fixtures.length > 1000) {
    fail('FIXTURE_LIMIT');
  }
  const responses = new Map<string, { dispatch: DispatchObservation; reconciliation: ReconciliationObservation }>();
  for (const fixture of fixtures) {
    const identity = validateOperationIdentity(fixture.identity);
    if (responses.has(identity.idempotencyKey)) {
      fail('DUPLICATE_FIXTURE');
    }
    responses.set(identity.idempotencyKey, freeze({ dispatch: dispatchSchema.parse(fixture.dispatch), reconciliation: reconciliationSchema.parse(fixture.reconciliation) }));
  }
  function lookup(identity: OperationIdentity) {
    const key = validateOperationIdentity(identity).idempotencyKey;
    const response = responses.get(key);
    if (!response) {
      fail('FIXTURE_NOT_FOUND');
    }
    return response;
  }
  function observed(state: OperationState, observedAt: number, kind: 'dispatch' | 'reconcile') {
    requireCustomerPaymentProviderFixtureEnabled();
    fenced(state, { expectedVersion: state.version, leaseToken: state.leaseToken!, now: observedAt }, kind === 'dispatch' ? 'dispatch' : 'reconcile');
    if (state.state !== (kind === 'dispatch' ? 'dispatching' : 'uncertain')) {
      fail('INVALID_TRANSITION');
    }
    const fixture = lookup(state.identity);
    const value = Object.freeze({ ...(kind === 'dispatch' ? fixture.dispatch : fixture.reconciliation) });
    observationAuthority.set(value, { key: state.identity.idempotencyKey, kind, observedAt, version: state.version, leaseToken: state.leaseToken! });
    return value;
  }
  const transport: OfflineOperationTransport = Object.freeze({ provenance: 'offline_fixture', execute: async (state: OperationState, observedAt: number) => observed(state, observedAt, 'dispatch') as BoundDispatchObservation, reconcile: async (state: OperationState, observedAt: number) => observed(state, observedAt, 'reconcile') as BoundReconciliationObservation });
  offlineTransports.add(transport);
  return transport;
}

export type OperationCommand = { type: 'begin_dispatch' } | { type: 'expire' }
  | { type: 'observe_dispatch'; observation: BoundDispatchObservation }
  | { type: 'reconcile'; observation: BoundReconciliationObservation };
/** Durable adapters supply database time/version and never accept a caller-proposed next state. */
export function applyOperationCommand(state: OperationState, fence: { expectedVersion: number; leaseToken: string; now: number }, command: OperationCommand): OperationState {
  const keys = Object.keys(command);
  const allowed = ['observe_dispatch', 'reconcile'].includes(command.type) ? ['type', 'observation'] : ['type'];
  if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) {
    fail('INVALID_COMMAND');
  }
  if (command.type === 'begin_dispatch') {
    return beginOperationDispatch(state, fence);
  }
  if (command.type === 'expire') {
    return expireOperationLease(state, fence);
  }
  if (command.type === 'observe_dispatch') {
    return observeOperationDispatch(state, { ...fence, observation: command.observation });
  }
  if (command.type === 'reconcile') {
    return reconcileOperation(state, { ...fence, observation: command.observation });
  }
  return fail('INVALID_COMMAND');
}
