import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { customerPaymentLiveObservationSchema, customerPaymentLiveReceiptSchema, customerPaymentLiveSettlementSchema, customerPaymentWorkspaceAuditSchema, customerPaymentWorkspaceSchema } from '@/models/customerPaymentWorkspaceSchema';
import { appointmentPaymentSchema, appointmentSchema } from '@/models/Schema';

import { adjustmentPermissions, resolveAdjustmentBalance } from '../adjustments';
import { assertVerifiedStripeCustomerPaymentReceipt } from '../liveProvider/stripeReceipt';
import { assertWorkspaceProviderObservation, assertWorkspaceVerifiedOutcome } from '../liveProvider/workspaceStripe';
import type { PaymentReturnView } from '../paymentReturnView';
import { paymentReturnSigningKeyHash, verifyPaymentReturnToken } from './paymentReturnToken';
import type { CustomerPaymentTransaction } from './preparationRepository';
import { customerPaymentFingerprint } from './preparationRepository';
import { authorizeWorkspaceActor } from './workspaceAccess';
import type { PaymentProviderBinding, PaymentWorkspaceActor, PaymentWorkspaceCommand, PaymentWorkspaceScope, PaymentWorkspaceState, WorkspaceOperation } from './workspaceContract';
import { paymentProviderBindingSchema, paymentWorkspaceCommandSchema, PaymentWorkspaceError, paymentWorkspaceScopeSchema, paymentWorkspaceStateSchema, workspaceBillChangeSchema, workspaceFailure, workspaceManualPaymentSchema } from './workspaceContract';
import { reconcileWorkspaceDepositFacts } from './workspaceDepositReconciliation';
import { readWorkspaceInvoice } from './workspaceInvoice';
import { enqueueWorkspaceRecovery } from './workspaceRecoveryQueue';
import { enqueueWorkspaceStats } from './workspaceStats';

type Database = Pick<typeof db, 'transaction'>;
type WorkspaceRow = typeof customerPaymentWorkspaceSchema.$inferSelect;
type Appointment = typeof appointmentSchema.$inferSelect;
/** Recompute from locked invoice/tender/deposit sources, never client-supplied totals. */
export type WorkspaceBindingReader = (tx: CustomerPaymentTransaction, appointment: Appointment, state: PaymentWorkspaceState) => Promise<{ binding: PaymentProviderBinding | null; billSourceHash: string }>;
type InitialState = Pick<PaymentWorkspaceState, 'bill' | 'billSourceHash' | 'payments' | 'invoice' | 'legacyTenderHash'>;
const activeStates = new Set(['awaiting_approval', 'prepared', 'dispatching', 'open', 'pending', 'uncertain', 'review']);

/**
 * Keep every signed delivery, but compare immutable payment facts for conflicts.
 * Stripe redeliveries can change envelope bookkeeping such as pending_webhooks.
 * Raw payload hashes and local receipt times therefore are not event identities.
 */
function hasConflictingReceipts(rows: readonly Pick<typeof customerPaymentLiveReceiptSchema.$inferSelect, 'eventId' | 'receipt'>[]): boolean {
  const events = new Map<string, string>();
  for (const row of rows) {
    const { payloadDigest: _digest, receivedAt: _receivedAt, endpointId: _endpointId, ...facts } = row.receipt;
    const fingerprint = customerPaymentFingerprint(facts);
    const previous = events.get(row.eventId);
    if (previous !== undefined && previous !== fingerprint) {
      return true;
    }
    events.set(row.eventId, fingerprint);
  }
  return false;
}

export type WorkspaceDispatchClaim = {
  action: 'create' | 'expire';
  scope: PaymentWorkspaceScope;
  operation: WorkspaceOperation;
  dispatchToken: string;
  idempotencyKey: string;
};
const dispatchClaims = new WeakMap<object, { hash: string; consumed: boolean }>();

export type WorkspaceReconciliationClaim = {
  scope: PaymentWorkspaceScope;
  operation: WorkspaceOperation;
  expectedRevision: number;
  operationFingerprint: string;
  expectedRefundedCents: number;
  parentAmountCents: number | null;
  alreadySettled: boolean;
  knownRefunds: { objectId: string; operationId: string; amountCents: number }[];
  expiresAt: number;
};
const reconciliationClaims = new WeakMap<object, string>();

export function assertWorkspaceReconciliationClaim(claim: WorkspaceReconciliationClaim): void {
  if (reconciliationClaims.get(claim) !== customerPaymentFingerprint(claim) || Date.now() >= claim.expiresAt) {
    workspaceFailure('PAYMENT_WORKSPACE_RECONCILIATION_CLAIM_REQUIRED');
  }
}

/** A dispatch permit is registered only after its database transaction commits. */
export function assertWorkspaceDispatchClaim(claim: WorkspaceDispatchClaim, consume = false): void {
  const proof = dispatchClaims.get(claim);
  if (!proof || proof.consumed || proof.hash !== customerPaymentFingerprint(claim)
    || claim.operation.dispatchUntil === null || Date.now() >= claim.operation.dispatchUntil) {
    workspaceFailure('PAYMENT_WORKSPACE_COMMITTED_DISPATCH_REQUIRED');
  }
  if (consume) {
    proof.consumed = true;
  }
}

function permissions(actor: PaymentWorkspaceActor) {
  paymentWorkspaceScopeSchema.parse({ salonId: actor.salonId, appointmentId: actor.appointmentId });
  if (!actor.id || actor.id.length > 200 || !['owner', 'staff', 'admin', 'customer'].includes(actor.role)) {
    workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  const result = adjustmentPermissions({ ...actor, hasAppointmentAccess: true });
  if (!result.canView) {
    workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  return result;
}

function projection(state: PaymentWorkspaceState) {
  return resolveAdjustmentBalance({ revision: state.revision, bill: state.bill, payments: state.payments, refunds: state.refunds, requests: state.requests });
}

function validate(state: unknown, scope: PaymentWorkspaceScope): PaymentWorkspaceState {
  const parsed = paymentWorkspaceStateSchema.parse(state);
  if (parsed.bill.salonId !== scope.salonId || parsed.bill.appointmentId !== scope.appointmentId
    || new Set(parsed.operations.map(op => op.id)).size !== parsed.operations.length) {
    workspaceFailure('PAYMENT_WORKSPACE_SCOPE_MISMATCH');
  }
  projection(parsed);
  if (parsed.invoice && (parsed.invoice.taxSnapshot.serviceSubtotalCents !== parsed.bill.serviceCents
    || parsed.invoice.taxSnapshot.taxAmountCents !== parsed.bill.taxCents || parsed.invoice.tipCents !== parsed.bill.tipCents)) {
    workspaceFailure('PAYMENT_WORKSPACE_INVOICE_BILL_MISMATCH');
  }
  for (const op of parsed.operations) {
    const fact = op.kind === 'payment' ? parsed.requests.find(row => row.id === op.id) : parsed.refunds.find(row => row.id === op.id);
    if (!fact || fact.principalCents !== op.principalCents || fact.tipCents !== op.tipCents
      || op.principalCents + op.tipCents <= 0 || op.principalCents + op.tipCents > 50_000_000
      || (op.kind === 'refund' && (!op.parentPaymentId || !op.parentChargeId || !op.reason))
      || (op.kind === 'payment' && (op.parentPaymentId !== null || op.parentChargeId !== null))) {
      workspaceFailure('PAYMENT_WORKSPACE_OPERATION_MISMATCH');
    }
  }
  return parsed;
}

async function lock(tx: CustomerPaymentTransaction, scope: PaymentWorkspaceScope) {
  const [appointment] = await tx.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, scope.appointmentId), eq(appointmentSchema.salonId, scope.salonId))).for('update').limit(1);
  if (!appointment) {
    return workspaceFailure('PAYMENT_WORKSPACE_NOT_FOUND');
  }
  const [row] = await tx.select().from(customerPaymentWorkspaceSchema).where(and(eq(customerPaymentWorkspaceSchema.appointmentId, scope.appointmentId), eq(customerPaymentWorkspaceSchema.salonId, scope.salonId))).for('update').limit(1);
  return { appointment, row };
}

async function clock(tx: CustomerPaymentTransaction) {
  const [row] = await tx.select({ now: sql<string>`floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint` }).from(sql`(SELECT 1) AS payment_workspace_clock`);
  return Number(row!.now);
}

async function lockActor(tx: CustomerPaymentTransaction, actor: PaymentWorkspaceActor) {
  const result = await lock(tx, actor);
  await authorizeWorkspaceActor(tx, actor);
  if (actor.role === 'staff' && result.appointment.technicianId !== actor.id) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  return result;
}

async function replay(tx: CustomerPaymentTransaction, actor: PaymentWorkspaceActor, requestId: string, requestHash: string) {
  const [event] = await tx.select().from(customerPaymentWorkspaceAuditSchema).where(and(eq(customerPaymentWorkspaceAuditSchema.salonId, actor.salonId), eq(customerPaymentWorkspaceAuditSchema.requestId, requestId))).limit(1);
  if (!event) {
    return null;
  }
  if (event.appointmentId !== actor.appointmentId || event.actorId !== actor.id || event.requestHash !== requestHash) {
    return workspaceFailure('PAYMENT_WORKSPACE_REQUEST_CONFLICT');
  }
  return { state: validate(event.state, actor), replayed: true };
}

async function save(tx: CustomerPaymentTransaction, row: WorkspaceRow, state: PaymentWorkspaceState, event: { requestId: string; requestHash: string; actorId: string; action: string }) {
  const next = validate({ ...state, revision: row.revision + 1 }, row);
  const [saved] = await tx.update(customerPaymentWorkspaceSchema).set({ ...event, revision: next.revision, state: next })
    .where(and(eq(customerPaymentWorkspaceSchema.appointmentId, row.appointmentId), eq(customerPaymentWorkspaceSchema.salonId, row.salonId), eq(customerPaymentWorkspaceSchema.revision, row.revision))).returning();
  if (!saved) {
    return workspaceFailure('PAYMENT_WORKSPACE_STALE');
  }
  return { state: next, replayed: false };
}

async function updateCanonicalBalance(tx: CustomerPaymentTransaction, scope: PaymentWorkspaceScope, state: PaymentWorkspaceState) {
  // Deposits are credited separately by existing checkout accounting.
  const [paid] = await tx.select({ amount: sql<string>`coalesce(sum(amount_cents) FILTER (WHERE voided_at IS NULL),0) -
    (SELECT coalesce(sum(principal_cents+tip_cents),0) FROM customer_payment_live_settlement WHERE appointment_id=${scope.appointmentId} AND salon_id=${scope.salonId} AND kind='refund')` })
    .from(appointmentPaymentSchema).where(and(eq(appointmentPaymentSchema.appointmentId, scope.appointmentId), eq(appointmentPaymentSchema.salonId, scope.salonId)));
  const amountPaidCents = Number(paid!.amount);
  const expected = state.payments.filter(item => item.kind !== 'deposit' && item.state === 'confirmed').reduce((sum, item) => sum + item.principalCents + item.tipCents, 0)
    - state.refunds.filter(item => item.state === 'succeeded' && state.payments.some(payment => payment.id === item.paymentId && payment.kind !== 'deposit')).reduce((sum, item) => sum + item.principalCents + item.tipCents, 0);
  if (!Number.isSafeInteger(amountPaidCents) || amountPaidCents < 0 || amountPaidCents > 50_000_000 || amountPaidCents !== expected) {
    return workspaceFailure('PAYMENT_WORKSPACE_CANONICAL_BALANCE_INVALID');
  }
  const balance = projection(state);
  await tx.update(appointmentSchema).set({ amountPaidCents, tipCents: state.bill.tipCents, paymentStatus: balance.balanceDueCents === 0 ? 'paid' : balance.netPaidCents > 0 ? 'partially_paid' : 'pending' })
    .where(and(eq(appointmentSchema.id, scope.appointmentId), eq(appointmentSchema.salonId, scope.salonId)));
  await enqueueWorkspaceStats(tx, scope, state.revision);
}

/**
 * Join an existing canonical checkout transaction. The caller keeps this
 * transaction open through finish(); any validation error rolls back the
 * invoice, tender and immutable workspace revision together.
 */
export async function beginCanonicalWorkspaceChange(tx: CustomerPaymentTransaction, appointment: Appointment, getActor: () => Promise<PaymentWorkspaceActor>, reason: string, options: { allowManualVoids?: boolean } = {}) {
  const scope = { salonId: appointment.salonId, appointmentId: appointment.id };
  const { row, appointment: currentAppointment } = await lock(tx, scope);
  if (!row) {
    return null;
  }
  const actor = await getActor();
  if (actor.salonId !== scope.salonId || actor.appointmentId !== scope.appointmentId || !permissions(actor).canAdjustBill) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  await authorizeWorkspaceActor(tx, actor);
  if (actor.role === 'staff' && currentAppointment.technicianId !== actor.id) {
    return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
  }
  const state = validate(row.state, scope);
  if (state.operations.some(op => activeStates.has(op.state)) || projection(state).blockedReasons.length) {
    return workspaceFailure('PAYMENT_WORKSPACE_BALANCE_HELD');
  }
  const before = await readWorkspaceInvoice(tx, currentAppointment);
  if (before.collectionHold || before.billSourceHash !== state.billSourceHash) {
    return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
  }
  const onlineIds = new Set(state.payments.filter(payment => payment.kind === 'online' && payment.state === 'confirmed').map(payment => payment.id));
  const onlineRefundablePrincipalCents = state.payments.filter(payment => onlineIds.has(payment.id)).reduce((sum, payment) => sum + payment.principalCents, 0)
    - state.refunds.filter(refund => onlineIds.has(refund.paymentId) && refund.state === 'succeeded').reduce((sum, refund) => sum + refund.principalCents, 0);
  let finished = false;
  return {
    onlineRefundablePrincipalCents,
    async finish() {
      if (finished) {
        return workspaceFailure('PAYMENT_WORKSPACE_SCOPE_MISMATCH');
      }
      finished = true;
      const { appointment: updatedAppointment } = await lock(tx, scope);
      const after = await readWorkspaceInvoice(tx, updatedAppointment);
      // A service revision never rewrites old tender, refunds a deposit, or
      // reclassifies a prepaid tip. Those need their own financial command.
      if (after.collectionHold || before.depositFingerprint !== after.depositFingerprint) {
        return workspaceFailure('PAYMENT_WORKSPACE_LEDGER_RECONCILIATION_REQUIRED');
      }
      for (const old of before.tenderFacts) {
        const current = after.tenderFacts.find(tender => tender.id === old.id);
        if (current && customerPaymentFingerprint(current) === customerPaymentFingerprint(old)) {
          continue;
        }
        const payment = state.payments.find(payment => payment.id === old.id && payment.kind === 'manual');
        if (!options.allowManualVoids || actor.role === 'staff' || !current || !payment || old.voided || !current.voided
          || customerPaymentFingerprint({ ...current, voided: false }) !== customerPaymentFingerprint(old)
          || state.refunds.some(refund => refund.paymentId === old.id)) {
          return workspaceFailure('PAYMENT_WORKSPACE_LEDGER_RECONCILIATION_REQUIRED');
        }
        state.refunds.push({ ...scope, id: `manual_void_${old.id}`, paymentId: old.id, principalCents: payment.principalCents, tipCents: payment.tipCents, state: 'succeeded', kind: 'manual_void' });
      }
      const invoiceChanged = customerPaymentFingerprint(state.invoice) !== customerPaymentFingerprint(after.invoice);
      state.bill = { ...after.bill, revision: state.bill.revision + (invoiceChanged ? 1 : 0) };
      state.invoice = after.invoice;
      for (const tender of after.tenderFacts.filter(current => !before.tenderFacts.some(old => old.id === current.id))) {
        const balance = projection(state);
        if (tender.voided || tender.actorType === 'system' || tender.actorId !== actor.id
          || !workspaceManualPaymentSchema.shape.method.safeParse(tender.method).success
          || !permissions(actor).canRecordPayment || !balance.canReservePayment || tender.amountCents > balance.balanceDueCents) {
          return workspaceFailure('PAYMENT_WORKSPACE_MANUAL_TENDER_MISMATCH');
        }
        const principalCents = Math.min(balance.principalDueCents, tender.amountCents);
        state.payments.push({ ...scope, id: tender.id, movementId: tender.id, kind: 'manual', principalCents, tipCents: tender.amountCents - principalCents, state: 'confirmed' });
      }
      const expectedTenderCents = state.payments.filter(payment => payment.kind !== 'deposit' && payment.state === 'confirmed').reduce((sum, payment) => sum + payment.principalCents + payment.tipCents, 0)
        - state.refunds.filter(refund => refund.state === 'succeeded' && state.payments.some(payment => payment.id === refund.paymentId && payment.kind !== 'deposit')).reduce((sum, refund) => sum + refund.principalCents + refund.tipCents, 0);
      if (after.ledgerCents !== expectedTenderCents) {
        return workspaceFailure('PAYMENT_WORKSPACE_LEDGER_RECONCILIATION_REQUIRED');
      }
      state.billSourceHash = after.billSourceHash;
      state.legacyTenderHash = after.legacyTenderHash;
      if (invoiceChanged) {
        state.billChanges.push({ revision: state.bill.revision, reason, actorId: actor.id, changedAt: await clock(tx), sourceHash: after.billSourceHash });
      }
      await enqueueWorkspaceStats(tx, scope, row.revision + 1);
      return save(tx, row, state, { requestId: randomUUID(), requestHash: customerPaymentFingerprint({ before: before.billSourceHash, after: after.billSourceHash, reason, actorId: actor.id }), actorId: actor.id, action: invoiceChanged ? 'checkout_invoice_saved' : options.allowManualVoids ? 'manual_payment_voided' : 'manual_payment_recorded' });
    },
  };
}

/** Every financial command commits its reservation before a separate provider call. */
export function createPaymentWorkspaceRepository(database: Database) {
  return {
    /** Public capability grants only this projection; it cannot mutate or list history. */
    async readReturnStatus(token: string, origin: string): Promise<PaymentReturnView | null> {
      const claims = verifyPaymentReturnToken(token, origin);
      if (!claims) {
        return null;
      }
      return database.transaction(async (tx) => {
        const [row] = await tx.select().from(customerPaymentWorkspaceSchema).where(and(eq(customerPaymentWorkspaceSchema.appointmentId, claims.appointmentId), eq(customerPaymentWorkspaceSchema.salonId, claims.salonId))).limit(1);
        if (!row) {
          return null;
        }
        const state = validate(row.state, claims);
        const operation = state.operations.find(item => item.id === claims.operationId && item.kind === 'payment');
        if (!operation || operation.createdAt !== claims.createdAt || operation.binding.returnOrigin !== origin || operation.returnStatusKeyHash !== paymentReturnSigningKeyHash()) {
          return null;
        }
        const payment = state.payments.find(item => item.requestId === operation.id && item.kind === 'online' && item.state === 'confirmed');
        const refundedCents = payment ? state.refunds.filter(item => item.paymentId === payment.id && item.state === 'succeeded').reduce((sum, item) => sum + item.principalCents + item.tipCents, 0) : 0;
        return {
          status: operation.state === 'review' ? 'review' : payment && operation.state === 'succeeded' ? 'received' : ['failed', 'canceled'].includes(operation.state) ? 'closed' : 'pending',
          currency: 'CAD',
          amountCents: operation.principalCents + operation.tipCents,
          refundedCents,
        };
      });
    },
    async inspect<T>(actor: PaymentWorkspaceActor, inspect: (tx: CustomerPaymentTransaction, appointment: Appointment, state: PaymentWorkspaceState | null) => Promise<T>) {
      permissions(actor);
      return database.transaction(async (tx) => {
        const { row, appointment } = await lockActor(tx, actor);
        const state = row ? validate(row.state, actor) : null;
        return { state, context: await inspect(tx, appointment, state) };
      });
    },
    async read(actor: PaymentWorkspaceActor) {
      permissions(actor);
      return database.transaction(async (tx) => {
        const { row } = await lockActor(tx, actor);
        return row ? validate(row.state, actor) : null;
      });
    },

    async initialize(actor: PaymentWorkspaceActor, requestId: string, prepare: (tx: CustomerPaymentTransaction, appointment: Appointment) => Promise<InitialState>) {
      if (!permissions(actor).canRequestPayment || !/^[0-9a-f-]{36}$/i.test(requestId)) {
        return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
      }
      const requestHash = customerPaymentFingerprint({ kind: 'initialize', requestId, actorId: actor.id });
      return database.transaction(async (tx) => {
        const { appointment, row } = await lockActor(tx, actor);
        const existing = await replay(tx, actor, requestId, requestHash);
        if (existing) {
          return existing;
        }
        if (row) {
          return workspaceFailure('PAYMENT_WORKSPACE_ALREADY_EXISTS');
        }
        const initial = await prepare(tx, appointment);
        // Existing provider evidence needs a dedicated verified import; never
        // promote the synthetic foundation by accepting an "online" label.
        if (initial.payments.some(payment => payment.kind === 'online')) {
          return workspaceFailure('PAYMENT_WORKSPACE_VERIFIED_IMPORT_REQUIRED');
        }
        const state = validate({ ...initial, revision: 0, refunds: [], requests: [], operations: [] }, actor);
        await tx.insert(customerPaymentWorkspaceSchema).values({ salonId: actor.salonId, appointmentId: actor.appointmentId, revision: 0, state, requestId, requestHash, actorId: actor.id, action: 'initialize' });
        return { state, replayed: false };
      });
    },

    /** Import only canonical resolved deposit facts; no Stripe request or invoice edit. */
    async reconcileDeposits(scope: PaymentWorkspaceScope, actor?: PaymentWorkspaceActor) {
      paymentWorkspaceScopeSchema.parse(scope);
      if (actor && (actor.salonId !== scope.salonId || actor.appointmentId !== scope.appointmentId || !permissions(actor).canAdjustBill)) {
        return workspaceFailure('PAYMENT_WORKSPACE_ACCESS_REQUIRED');
      }
      return database.transaction(async (tx) => {
        const { row, appointment } = actor ? await lockActor(tx, actor) : await lock(tx, scope);
        if (!row) {
          return { changed: false, held: false };
        }
        const state = validate(row.state, scope);
        if (state.operations.some(op => activeStates.has(op.state))) {
          return { changed: false, held: true };
        }
        let material: Awaited<ReturnType<typeof readWorkspaceInvoice>>;
        try {
          material = await readWorkspaceInvoice(tx, appointment);
        } catch (error) {
          if (error instanceof PaymentWorkspaceError) {
            return { changed: false, held: true };
          }
          throw error;
        }
        if (state.billSourceHash === material.billSourceHash) {
          return { changed: false, held: false };
        }
        try {
          reconcileWorkspaceDepositFacts(state, material, await clock(tx));
        } catch (error) {
          if (!actor && error instanceof PaymentWorkspaceError) {
            return { changed: false, held: true };
          }
          throw error;
        }
        const result = await save(tx, row, state, { requestId: randomUUID(), requestHash: customerPaymentFingerprint({ action: 'deposit_credit_reconciled', source: material.billSourceHash }), actorId: actor?.id ?? 'system:deposit-reconciliation', action: 'deposit_credit_reconciled' });
        await updateCanonicalBalance(tx, scope, result.state);
        return { changed: true, held: false };
      });
    },

    async command(actor: PaymentWorkspaceActor, value: PaymentWorkspaceCommand, readBinding: WorkspaceBindingReader) {
      const access = permissions(actor);
      const input = paymentWorkspaceCommandSchema.parse(value);
      if ((input.kind === 'request_payment' && !access.canRequestPayment)
        || (input.kind === 'request_refund' && !access.canRequestRefund)
        || (['approve_refund', 'reject_refund'].includes(input.kind) && !access.canIssueRefund)) {
        return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
      }
      const requestHash = customerPaymentFingerprint({ ...input, actorId: actor.id });
      return database.transaction(async (tx) => {
        const { row, appointment } = await lockActor(tx, actor);
        const existing = await replay(tx, actor, input.requestId, requestHash);
        if (existing) {
          return existing;
        }
        if (!row) {
          return workspaceFailure('PAYMENT_WORKSPACE_NOT_INITIALIZED');
        }
        if (row.revision !== input.expectedRevision) {
          return workspaceFailure('PAYMENT_WORKSPACE_STALE');
        }
        const state = validate(row.state, actor);
        const current = await readBinding(tx, appointment, state);
        if (current.billSourceHash !== state.billSourceHash) {
          return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
        }
        const balance = projection(state);
        const scope = { salonId: actor.salonId, appointmentId: actor.appointmentId };
        const now = await clock(tx);
        if (input.kind === 'request_payment' || input.kind === 'request_refund') {
          if (state.operations.some(op => activeStates.has(op.state))
            || (input.kind === 'request_payment' ? !balance.canReservePayment : !balance.canReserveRefund)) {
            return workspaceFailure('PAYMENT_WORKSPACE_BALANCE_HELD');
          }
          const id = randomUUID();
          const operation: WorkspaceOperation = {
            id,
            kind: input.kind === 'request_payment' ? 'payment' : 'refund',
            state: 'prepared',
            billRevision: state.bill.revision,
            principalCents: balance.principalDueCents,
            tipCents: balance.tipDueCents,
            binding: input.kind === 'request_payment' ? paymentProviderBindingSchema.parse(current.binding) : {} as PaymentProviderBinding,
            parentPaymentId: null,
            parentChargeId: null,
            requestedBy: actor.id,
            approvedBy: null,
            reason: null,
            createdAt: now,
            sessionExpiresAt: input.kind === 'request_payment' ? (Math.floor(now / 1000) + 86400) * 1000 : null,
            firstDispatchAt: null,
            dispatchToken: null,
            dispatchUntil: null,
            providerObjectId: null,
          };
          if (input.kind === 'request_payment') {
            if (actor.role === 'customer') {
              if (!actor.accessToken || !current.binding?.policyRevision || input.acceptedPolicyRevision !== current.binding.policyRevision || input.expectedInvoiceHash !== state.billSourceHash) {
                return workspaceFailure('PAYMENT_WORKSPACE_POLICY_ACCEPTANCE_REQUIRED');
              }
              operation.customerAcceptance = { policyRevision: current.binding.policyRevision, accessTokenId: actor.accessToken.id, acceptedAt: now };
            }
            const statusKeyHash = paymentReturnSigningKeyHash();
            if (statusKeyHash) {
              operation.returnStatusKeyHash = statusKeyHash;
            }
            state.requests.push({ ...scope, id, billRevision: state.bill.revision, principalCents: operation.principalCents, tipCents: operation.tipCents, state: 'reserved' });
          } else {
            const payment = state.payments.find(item => item.id === input.paymentId);
            const original = state.operations.find(op => op.id === payment?.requestId && op.kind === 'payment' && op.state === 'succeeded');
            const available = balance.refundable.find(item => item.paymentId === input.paymentId);
            if (!payment || payment.kind !== 'online' || payment.state !== 'confirmed' || !original || !available
              || !/^ch_[A-Za-z0-9]+$/.test(payment.movementId)
              || input.principalCents + input.tipCents <= 0
              || input.principalCents > Math.min(available.principalCents, balance.principalOverpaidCents)
              || input.tipCents > Math.min(available.tipCents, balance.tipOverpaidCents)) {
              return workspaceFailure('PAYMENT_WORKSPACE_REFUND_ALLOCATION_INVALID');
            }
            Object.assign(operation, { principalCents: input.principalCents, tipCents: input.tipCents, binding: original.binding, parentPaymentId: payment.id, parentChargeId: payment.movementId, reason: input.reason, state: access.canIssueRefund ? 'prepared' : 'awaiting_approval', approvedBy: access.canIssueRefund ? actor.id : null });
            state.refunds.push({ ...scope, id, paymentId: payment.id, principalCents: input.principalCents, tipCents: input.tipCents, state: 'requested' });
          }
          state.operations.push(operation);
        } else {
          const op = state.operations.find(item => item.id === input.operationId && item.kind === 'refund');
          const refund = state.refunds.find(item => item.id === input.operationId);
          if (!op || !refund || op.state !== 'awaiting_approval' || refund.state !== 'requested' || op.firstDispatchAt !== null || op.billRevision !== state.bill.revision) {
            return workspaceFailure('PAYMENT_WORKSPACE_REFUND_NOT_AWAITING_APPROVAL');
          }
          if (input.kind === 'approve_refund') {
            op.approvedBy = actor.id;
            op.state = 'prepared';
          } else {
            op.state = 'canceled';
            refund.state = 'canceled';
            // The audit row preserves both the original request and rejection.
            op.reason = input.reason;
          }
        }
        return save(tx, row, state, { requestId: input.requestId, requestHash, actorId: actor.id, action: input.kind });
      });
    },

    /** The pricing writer runs under the same appointment lock and rolls back on failure. */
    async reviseBill(actor: PaymentWorkspaceActor, value: unknown, writeInvoice: (tx: CustomerPaymentTransaction, appointment: Appointment, state: PaymentWorkspaceState) => Promise<Pick<InitialState, 'bill' | 'billSourceHash' | 'invoice' | 'legacyTenderHash'>>) {
      if (!permissions(actor).canAdjustBill) {
        return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
      }
      const input = workspaceBillChangeSchema.parse(value);
      const requestHash = customerPaymentFingerprint({ ...input, kind: 'revise_bill', actorId: actor.id });
      return database.transaction(async (tx) => {
        const { row, appointment } = await lockActor(tx, actor);
        const existing = await replay(tx, actor, input.requestId, requestHash);
        if (existing) {
          return existing;
        }
        if (!row || row.revision !== input.expectedRevision) {
          return workspaceFailure('PAYMENT_WORKSPACE_STALE');
        }
        const state = validate(row.state, actor);
        if (state.operations.some(op => activeStates.has(op.state))) {
          return workspaceFailure('PAYMENT_WORKSPACE_BALANCE_HELD');
        }
        const invoice = await writeInvoice(tx, appointment, state);
        if (state.invoice && !invoice.invoice) {
          return workspaceFailure('PAYMENT_WORKSPACE_READABLE_INVOICE_REQUIRED');
        }
        if (invoice.invoice) {
          state.invoice = invoice.invoice;
        }
        state.bill = { ...invoice.bill, revision: state.bill.revision + 1 };
        state.billSourceHash = invoice.billSourceHash;
        state.legacyTenderHash = invoice.legacyTenderHash ?? state.legacyTenderHash;
        state.billChanges.push({ revision: state.bill.revision, reason: input.reason, actorId: actor.id, changedAt: await clock(tx), sourceHash: invoice.billSourceHash });
        await enqueueWorkspaceStats(tx, actor, row.revision + 1);
        return save(tx, row, state, { requestId: input.requestId, requestHash, actorId: actor.id, action: 'revise_bill' });
      });
    },

    /** Manual tender remains a canonical ledger write; it cannot impersonate Stripe. */
    async recordManualPayment(actor: PaymentWorkspaceActor, value: unknown, readSourceHash: (tx: CustomerPaymentTransaction, appointment: Appointment) => Promise<string>, writePayment: (tx: CustomerPaymentTransaction, appointment: Appointment, allocation: { principalCents: number; tipCents: number; amountCents: number; method: string; requestId: string }) => Promise<{ paymentId: string; billSourceHash: string }>) {
      if (!permissions(actor).canRecordPayment) {
        return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
      }
      const input = workspaceManualPaymentSchema.parse(value);
      const requestHash = customerPaymentFingerprint({ ...input, kind: 'manual_payment', actorId: actor.id });
      return database.transaction(async (tx) => {
        const { row, appointment } = await lockActor(tx, actor);
        const existing = await replay(tx, actor, input.requestId, requestHash);
        if (existing) {
          return existing;
        }
        if (!row || row.revision !== input.expectedRevision) {
          return workspaceFailure('PAYMENT_WORKSPACE_STALE');
        }
        const state = validate(row.state, actor);
        if (await readSourceHash(tx, appointment) !== state.billSourceHash) {
          return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
        }
        const balance = projection(state);
        if (state.operations.some(op => activeStates.has(op.state)) || !balance.canReservePayment || input.amountCents > balance.balanceDueCents) {
          return workspaceFailure('PAYMENT_WORKSPACE_BALANCE_HELD');
        }
        const principalCents = Math.min(input.amountCents, balance.principalDueCents);
        const tipCents = input.amountCents - principalCents;
        const result = await writePayment(tx, appointment, { principalCents, tipCents, amountCents: input.amountCents, method: input.method, requestId: input.requestId });
        const [tender] = await tx.select().from(appointmentPaymentSchema).where(and(eq(appointmentPaymentSchema.id, result.paymentId), eq(appointmentPaymentSchema.appointmentId, actor.appointmentId), eq(appointmentPaymentSchema.salonId, actor.salonId))).limit(1);
        if (!tender || tender.amountCents !== input.amountCents || tender.method !== input.method || tender.voidedAt !== null
          || tender.recordedByType === 'system' || tender.recordedById !== actor.id || tender.idempotencyKey !== input.requestId) {
          return workspaceFailure('PAYMENT_WORKSPACE_MANUAL_TENDER_MISMATCH');
        }
        state.payments.push({ salonId: actor.salonId, appointmentId: actor.appointmentId, id: tender.id, movementId: tender.id, kind: 'manual', principalCents, tipCents, state: 'confirmed' });
        state.billSourceHash = result.billSourceHash;
        const saved = await save(tx, row, state, { requestId: input.requestId, requestHash, actorId: actor.id, action: 'manual_payment' });
        await updateCanonicalBalance(tx, actor, saved.state);
        return saved;
      });
    },

    async claimReconciliation(scope: PaymentWorkspaceScope, operationId: string) {
      paymentWorkspaceScopeSchema.parse(scope);
      const claim = await database.transaction(async (tx) => {
        const { row } = await lock(tx, scope);
        if (!row) {
          return workspaceFailure('PAYMENT_WORKSPACE_NOT_INITIALIZED');
        }
        const state = validate(row.state, scope);
        const op = state.operations.find(item => item.id === operationId);
        if (op?.providerConflict) {
          return workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_CONFLICT_REVIEW_REQUIRED');
        }
        if (!op || op.firstDispatchAt === null) {
          return workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_OBJECT_REQUIRED');
        }
        const parent = op.kind === 'payment' ? state.payments.find(item => item.requestId === op.id) : state.payments.find(item => item.id === op.parentPaymentId);
        const expectedRefundedCents = parent ? state.refunds.filter(item => item.paymentId === parent.id && item.state === 'succeeded').reduce((sum, item) => sum + item.principalCents + item.tipCents, 0) : 0;
        const knownRefunds = parent
          ? state.operations.filter(item => item.kind === 'refund' && item.parentPaymentId === parent.id && item.providerObjectId !== null)
            .map(item => ({ objectId: item.providerObjectId!, operationId: item.id, amountCents: item.principalCents + item.tipCents }))
          : [];
        return { scope: { ...scope }, operation: op, expectedRevision: state.revision, operationFingerprint: customerPaymentFingerprint(op), expectedRefundedCents, parentAmountCents: parent ? parent.principalCents + parent.tipCents : null, knownRefunds, alreadySettled: op.kind === 'payment' ? !!parent : state.refunds.some(item => item.id === op.id && item.state === 'succeeded'), expiresAt: await clock(tx) + 120_000 };
      });
      reconciliationClaims.set(claim, customerPaymentFingerprint(claim));
      return claim;
    },

    /** Atomic verified outcome, immutable allocation, canonical tender, and cache. */
    async applyVerifiedOutcome(value: unknown) {
      assertWorkspaceVerifiedOutcome(value);
      return database.transaction(async (tx) => {
        const { row } = await lock(tx, value.scope);
        if (!row) {
          return workspaceFailure('PAYMENT_WORKSPACE_NOT_INITIALIZED');
        }
        const state = validate(row.state, value.scope);
        const op = state.operations.find(item => item.id === value.operationId);
        if (!op || value.expectedRevision !== row.revision || customerPaymentFingerprint(op) !== value.operationFingerprint
          || op.providerObjectId !== value.objectId || op.kind !== value.kind
          || customerPaymentFingerprint(op.binding) !== customerPaymentFingerprint(value.binding)
          || op.principalCents + op.tipCents !== value.amountCents) {
          return workspaceFailure('PAYMENT_WORKSPACE_RECONCILIATION_STALE');
        }
        const [previous] = await tx.select().from(customerPaymentLiveSettlementSchema).where(eq(customerPaymentLiveSettlementSchema.operationId, op.id)).limit(1);
        const observations = await tx.select().from(customerPaymentLiveObservationSchema).where(eq(customerPaymentLiveObservationSchema.operationId, op.id));
        if (observations.some(item => item.facts.objectId !== value.objectId)) {
          return workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_OBJECT_CONFLICT');
        }
        const receipts = await tx.select().from(customerPaymentLiveReceiptSchema).where(and(
          eq(customerPaymentLiveReceiptSchema.platformAccountId, op.binding.platformAccountId),
          eq(customerPaymentLiveReceiptSchema.accountId, op.binding.connectedAccountId),
          eq(customerPaymentLiveReceiptSchema.livemode, op.binding.livemode),
          sql`(${customerPaymentLiveReceiptSchema.receipt} #>> '{facts,luster_payment_operation}' = ${op.id}
            OR ${customerPaymentLiveReceiptSchema.receipt} ->> 'objectId' IN (${value.objectId}, ${value.chargeId}, ${value.paymentIntentId})
            OR ${customerPaymentLiveReceiptSchema.receipt} #>> '{facts,charge}' = ${value.chargeId})`,
        ));
        if (hasConflictingReceipts(receipts) || receipts.some(item =>
          item.receipt.disposition !== 'candidate' || (item.receipt.objectType === (op.kind === 'payment' ? 'checkout.session' : 'refund')
            && (item.receipt.facts as Record<string, unknown>)?.luster_payment_operation === op.id && item.receipt.objectId !== value.objectId))) {
          return workspaceFailure('PAYMENT_WORKSPACE_RECEIPT_CONFLICT');
        }
        if (previous && value.status !== 'review') {
          if (value.status !== 'succeeded' || previous.chargeId !== value.chargeId || previous.paymentIntentId !== value.paymentIntentId) {
            return workspaceFailure('PAYMENT_WORKSPACE_SETTLEMENT_CONFLICT');
          }
          if (op.state === 'succeeded') {
            return { state, replayed: true };
          }
          op.state = 'succeeded';
          return save(tx, row, state, { requestId: randomUUID(), requestHash: customerPaymentFingerprint(value), actorId: 'system:payment-reconciliation', action: 'provider_review_resolved' });
        }
        const request = state.requests.find(item => item.id === op.id);
        const refund = state.refunds.find(item => item.id === op.id);
        const { checkoutUrl: _checkoutUrl, ...evidence } = value;
        const evidenceHash = customerPaymentFingerprint(evidence);
        if (value.status === 'succeeded') {
          if (!value.chargeId || !value.paymentIntentId || op.billRevision !== state.bill.revision
            || (op.kind === 'refund' && (!op.approvedBy || op.parentChargeId !== value.chargeId))) {
            return workspaceFailure('PAYMENT_WORKSPACE_SETTLEMENT_CONFLICT');
          }
          op.state = 'succeeded';
          if (request) {
            request.state = 'paid';
            state.payments.push({ ...value.scope, id: `lpay_${op.id}`, movementId: value.chargeId, requestId: op.id, kind: 'online', principalCents: op.principalCents, tipCents: op.tipCents, state: 'confirmed' });
          }
          if (refund) {
            refund.state = 'succeeded';
          }
        } else if (value.status === 'expired' || value.status === 'canceled' || value.status === 'failed') {
          op.state = value.status === 'expired' ? 'canceled' : value.status;
          if (request) {
            request.state = value.status === 'expired' ? 'expired' : 'canceled';
          }
          if (refund) {
            refund.state = value.status === 'failed' ? 'failed' : 'canceled';
          }
        } else {
          op.state = value.status;
          if (request && request.state !== 'paid') {
            request.state = value.status === 'open' ? 'open' : value.status === 'review' ? 'uncertain' : 'processing';
          }
          if (refund && refund.state !== 'succeeded') {
            refund.state = value.status === 'review' ? 'under_review' : 'pending';
          }
        }
        op.dispatchUntil = null;
        const result = await save(tx, row, state, { requestId: randomUUID(), requestHash: evidenceHash, actorId: 'system:payment-reconciliation', action: `provider_verified_${value.status}` });
        if (value.status === 'succeeded') {
          await tx.insert(customerPaymentLiveSettlementSchema).values({ operationId: op.id, ...value.scope, kind: op.kind, platformAccountId: op.binding.platformAccountId, accountId: op.binding.connectedAccountId, livemode: op.binding.livemode, objectId: value.objectId, paymentIntentId: value.paymentIntentId!, chargeId: value.chargeId!, parentOperationId: op.kind === 'refund' ? state.payments.find(item => item.id === op.parentPaymentId)!.requestId! : null, principalCents: op.principalCents, tipCents: op.tipCents, evidenceHash, evidence });
          if (op.kind === 'payment') {
            await tx.insert(appointmentPaymentSchema).values({ id: `lpay_${op.id}`, ...value.scope, amountCents: value.amountCents, method: 'online', reference: `customer_payment_live:${op.id}`, idempotencyKey: `luster_cp_v1_${op.id}`, recordedByType: 'system', recordedById: 'stripe' });
          }
          await updateCanonicalBalance(tx, value.scope, result.state);
        }
        return result;
      });
    },

    /** Claim once per short lease; an unknown result retains the reservation. */
    async claimDispatch(actor: PaymentWorkspaceActor, operationId: string, readBinding: WorkspaceBindingReader) {
      const access = permissions(actor);
      const scope = { salonId: actor.salonId, appointmentId: actor.appointmentId };
      const claim = await database.transaction(async (tx) => {
        const { row, appointment } = await lockActor(tx, actor);
        if (!row) {
          return workspaceFailure('PAYMENT_WORKSPACE_NOT_INITIALIZED');
        }
        const state = validate(row.state, scope);
        const op = state.operations.find(item => item.id === operationId);
        const now = await clock(tx);
        if (!op || !['prepared', 'uncertain', 'dispatching'].includes(op.state)
          || (op.kind === 'refund' && !op.approvedBy)
          || op.billRevision !== state.bill.revision || op.providerObjectId !== null
          || (op.kind === 'payment' && (op.sessionExpiresAt === null || now + 30 * 60 * 1000 >= op.sessionExpiresAt))
          || (op.dispatchUntil !== null && op.dispatchUntil > now)) {
          return workspaceFailure('PAYMENT_WORKSPACE_DISPATCH_HELD');
        }
        if (op.kind === 'payment' ? !access.canRequestPayment : !access.canIssueRefund) {
          return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
        }
        if (actor.role === 'customer' && (op.requestedBy !== actor.id || op.customerAcceptance?.accessTokenId !== actor.accessToken?.id || op.customerAcceptance?.policyRevision !== op.binding.policyRevision)) {
          return workspaceFailure('PAYMENT_WORKSPACE_POLICY_ACCEPTANCE_REQUIRED');
        }
        const current = await readBinding(tx, appointment, state);
        if (current.billSourceHash !== state.billSourceHash) {
          return workspaceFailure('PAYMENT_WORKSPACE_BILL_CHANGED');
        }
        if (op.kind === 'payment' && (!current.binding || customerPaymentFingerprint(current.binding) !== customerPaymentFingerprint(op.binding))) {
          return workspaceFailure('PAYMENT_WORKSPACE_ACTIVATION_CHANGED');
        }
        // Stripe can prune idempotency keys after 24 hours. Beyond this bound,
        // only reconciliation is permitted; never create with a new key.
        if (op.firstDispatchAt !== null && now >= op.firstDispatchAt + 23 * 60 * 60 * 1000) {
          return workspaceFailure('PAYMENT_WORKSPACE_RECONCILIATION_REQUIRED');
        }
        op.firstDispatchAt ??= now;
        op.dispatchToken = randomUUID();
        op.dispatchUntil = now + 60_000;
        op.state = 'dispatching';
        const request = state.requests.find(item => item.id === op.id);
        if (request) {
          request.state = 'processing';
        }
        const eventId = randomUUID();
        await save(tx, row, state, { requestId: eventId, requestHash: customerPaymentFingerprint({ operationId, token: op.dispatchToken }), actorId: 'system:payment-dispatch', action: 'dispatch_claimed' });
        await enqueueWorkspaceRecovery(tx, scope, op.id);
        return { action: 'create' as const, scope: { ...scope }, operation: op, dispatchToken: op.dispatchToken, idempotencyKey: `luster_cp_v1_${op.id}` };
      });
      dispatchClaims.set(claim, { hash: customerPaymentFingerprint(claim), consumed: false });
      return claim;
    },

    /** Expire the original link before allowing another bill/payment request. */
    async cancelUndispatched(actor: PaymentWorkspaceActor, value: { requestId: string; expectedRevision: number; operationId: string }) {
      const access = permissions(actor);
      const requestHash = customerPaymentFingerprint({ ...value, kind: 'cancel_undispatched', actorId: actor.id });
      return database.transaction(async (tx) => {
        const { row } = await lockActor(tx, actor);
        const existing = await replay(tx, actor, value.requestId, requestHash);
        if (existing) {
          return existing;
        }
        if (!row || row.revision !== value.expectedRevision) {
          return workspaceFailure('PAYMENT_WORKSPACE_STALE');
        }
        const state = validate(row.state, actor);
        const op = state.operations.find(item => item.id === value.operationId);
        if (!op || !['prepared', 'awaiting_approval'].includes(op.state) || op.firstDispatchAt !== null || op.providerObjectId !== null
          || (op.kind === 'payment' ? !access.canRequestPayment : !access.canIssueRefund)) {
          return workspaceFailure('PAYMENT_WORKSPACE_CANCELLATION_HELD');
        }
        op.state = 'canceled';
        const fact = op.kind === 'payment' ? state.requests.find(item => item.id === op.id) : state.refunds.find(item => item.id === op.id);
        fact!.state = 'canceled';
        return save(tx, row, state, { requestId: value.requestId, requestHash, actorId: actor.id, action: 'cancel_undispatched' });
      });
    },

    /** A dispatched request can be canceled only with independent provider proof. */
    async claimCancellation(actor: PaymentWorkspaceActor, expectedRevision: number, operationId: string) {
      if (!permissions(actor).canRequestPayment) {
        return workspaceFailure('PAYMENT_WORKSPACE_ACTION_FORBIDDEN');
      }
      const claim = await database.transaction(async (tx) => {
        const { row } = await lockActor(tx, actor);
        if (!row || row.revision !== expectedRevision) {
          return workspaceFailure('PAYMENT_WORKSPACE_STALE');
        }
        const state = validate(row.state, actor);
        const op = state.operations.find(item => item.id === operationId);
        const now = await clock(tx);
        if (!op || op.kind !== 'payment' || op.state !== 'open' || !op.providerObjectId
          || op.firstDispatchAt === null || (op.dispatchUntil !== null && op.dispatchUntil > now)) {
          return workspaceFailure('PAYMENT_WORKSPACE_CANCELLATION_HELD');
        }
        op.state = 'dispatching';
        op.dispatchToken = randomUUID();
        op.dispatchUntil = now + 60_000;
        state.requests.find(item => item.id === op.id)!.state = 'processing';
        await save(tx, row, state, { requestId: randomUUID(), requestHash: customerPaymentFingerprint({ operationId, action: 'expire', token: op.dispatchToken }), actorId: actor.id, action: 'cancellation_claimed' });
        return { action: 'expire' as const, scope: { salonId: actor.salonId, appointmentId: actor.appointmentId }, operation: op, dispatchToken: op.dispatchToken, idempotencyKey: `luster_cp_expire_v1_${op.id}` };
      });
      dispatchClaims.set(claim, { hash: customerPaymentFingerprint(claim), consumed: false });
      return claim;
    },

    /** A timeout/error does not mean Stripe did nothing. No balance is released. */
    async recordUncertain(scope: PaymentWorkspaceScope, operationId: string, dispatchToken: string) {
      paymentWorkspaceScopeSchema.parse(scope);
      return database.transaction(async (tx) => {
        const { row } = await lock(tx, scope);
        if (!row) {
          return workspaceFailure('PAYMENT_WORKSPACE_NOT_INITIALIZED');
        }
        const state = validate(row.state, scope);
        const op = state.operations.find(item => item.id === operationId);
        if (!op || op.state !== 'dispatching' || op.dispatchToken !== dispatchToken) {
          return workspaceFailure('PAYMENT_WORKSPACE_DISPATCH_FENCED');
        }
        op.state = 'uncertain';
        op.dispatchUntil = null;
        const request = state.requests.find(item => item.id === op.id);
        if (request) {
          request.state = 'uncertain';
        }
        return save(tx, row, state, { requestId: randomUUID(), requestHash: customerPaymentFingerprint({ operationId, dispatchToken }), actorId: 'system:payment-dispatch', action: 'dispatch_uncertain' });
      });
    },

    /** Acknowledge the webhook only after this transaction commits. */
    async retainReceipt(receipt: unknown) {
      assertVerifiedStripeCustomerPaymentReceipt(receipt);
      return database.transaction(async (tx) => {
        await tx.insert(customerPaymentLiveReceiptSchema).values({
          id: randomUUID(),
          platformAccountId: receipt.platformAccountId,
          accountId: receipt.accountId,
          livemode: receipt.livemode,
          eventId: receipt.eventId,
          payloadDigest: receipt.payloadDigest,
          receipt: { ...receipt },
          receivedAt: new Date(receipt.receivedAt),
        }).onConflictDoNothing();
        const rows = await tx.select().from(customerPaymentLiveReceiptSchema).where(and(
          eq(customerPaymentLiveReceiptSchema.platformAccountId, receipt.platformAccountId),
          eq(customerPaymentLiveReceiptSchema.accountId, receipt.accountId),
          eq(customerPaymentLiveReceiptSchema.livemode, receipt.livemode),
          eq(customerPaymentLiveReceiptSchema.eventId, receipt.eventId),
        ));
        const retained = rows.find(row => row.payloadDigest === receipt.payloadDigest);
        if (!retained) {
          return workspaceFailure('PAYMENT_WORKSPACE_RECEIPT_NOT_RETAINED');
        }
        return { receiptId: retained.id, collision: hasConflictingReceipts(rows) };
      });
    },

    /** Signed metadata may recover an unknown create result, but cannot settle it. */
    async associateReceipt(receiptId: string) {
      return database.transaction(async (tx) => {
        const [delivery] = await tx.select().from(customerPaymentLiveReceiptSchema).where(eq(customerPaymentLiveReceiptSchema.id, receiptId)).limit(1);
        if (!delivery) {
          return workspaceFailure('PAYMENT_WORKSPACE_RECEIPT_NOT_RETAINED');
        }
        const receipt = delivery.receipt;
        const facts = receipt.facts as Record<string, unknown> | undefined;
        let operationId = typeof facts?.luster_payment_operation === 'string' ? facts.luster_payment_operation : null;
        if (!operationId) {
          const chargeId = receipt.objectType === 'charge' ? receipt.objectId : facts?.charge;
          if (typeof chargeId !== 'string' || !/^ch_[A-Za-z0-9]+$/.test(chargeId)) {
            return null;
          }
          const [parent] = await tx.select().from(customerPaymentLiveSettlementSchema).where(and(
            eq(customerPaymentLiveSettlementSchema.platformAccountId, delivery.platformAccountId),
            eq(customerPaymentLiveSettlementSchema.accountId, delivery.accountId),
            eq(customerPaymentLiveSettlementSchema.livemode, delivery.livemode),
            eq(customerPaymentLiveSettlementSchema.chargeId, chargeId),
            eq(customerPaymentLiveSettlementSchema.kind, 'payment'),
          )).limit(1);
          operationId = parent?.operationId ?? null;
        }
        if (!operationId) {
          return null;
        }
        const candidates = await tx.select({ salonId: customerPaymentWorkspaceSchema.salonId, appointmentId: customerPaymentWorkspaceSchema.appointmentId })
          .from(customerPaymentWorkspaceSchema).where(sql`${customerPaymentWorkspaceSchema.state} @> ${JSON.stringify({ operations: [{ id: operationId }] })}::jsonb`).limit(2);
        if (candidates.length !== 1) {
          return candidates.length === 0 ? null : workspaceFailure('PAYMENT_WORKSPACE_RECEIPT_SCOPE_AMBIGUOUS');
        }
        const scope = candidates[0]!;
        const { row } = await lock(tx, scope);
        const state = validate(row!.state, scope);
        const op = state.operations.find(item => item.id === operationId)!;
        if (op.binding.platformAccountId !== delivery.platformAccountId || op.binding.connectedAccountId !== delivery.accountId || op.binding.livemode !== delivery.livemode) {
          return null;
        }
        if (op.providerConflict) {
          return { scope, operationId: op.id, held: true };
        }
        const deliveries = await tx.select({ eventId: customerPaymentLiveReceiptSchema.eventId, receipt: customerPaymentLiveReceiptSchema.receipt }).from(customerPaymentLiveReceiptSchema).where(and(
          eq(customerPaymentLiveReceiptSchema.platformAccountId, delivery.platformAccountId),
          eq(customerPaymentLiveReceiptSchema.accountId, delivery.accountId),
          eq(customerPaymentLiveReceiptSchema.livemode, delivery.livemode),
          eq(customerPaymentLiveReceiptSchema.eventId, delivery.eventId),
        ));
        const matchingObject = (op.kind === 'payment' && receipt.objectType === 'checkout.session') || (op.kind === 'refund' && receipt.objectType === 'refund');
        const objectId = typeof receipt.objectId === 'string' ? receipt.objectId : '';
        const expectedId = op.kind === 'payment' ? /^cs_(?:test_|live_)?[A-Za-z0-9]+$/ : /^re_[A-Za-z0-9]+$/;
        const conflict = hasConflictingReceipts(deliveries) || receipt.disposition !== 'candidate'
          || (matchingObject && (op.providerObjectId !== null && op.providerObjectId !== objectId))
          || op.firstDispatchAt === null;
        if (conflict) {
          op.providerConflict = true;
          op.state = 'review';
        } else if (matchingObject && expectedId.test(objectId) && op.providerObjectId === null) {
          op.providerObjectId = objectId;
          op.state = 'pending';
        } else {
          return op.providerObjectId ? { scope, operationId: op.id, held: false } : null;
        }
        op.dispatchUntil = null;
        const request = state.requests.find(item => item.id === op.id);
        const refund = state.refunds.find(item => item.id === op.id);
        if (request && request.state !== 'paid') {
          request.state = conflict ? 'uncertain' : 'processing';
        }
        if (refund && refund.state !== 'succeeded') {
          refund.state = conflict ? 'under_review' : 'pending';
        }
        await save(tx, row!, state, { requestId: randomUUID(), requestHash: customerPaymentFingerprint({ receiptId, objectId, conflict }), actorId: 'system:payment-webhook', action: conflict ? 'receipt_conflict' : 'provider_object_recovered' });
        return { scope, operationId: op.id, held: conflict };
      });
    },

    /** Preserve even a late provider response. It never posts a payment/refund. */
    async recordProviderObservation(value: unknown) {
      assertWorkspaceProviderObservation(value);
      return database.transaction(async (tx) => {
        const { row } = await lock(tx, value.scope);
        if (!row) {
          return workspaceFailure('PAYMENT_WORKSPACE_NOT_INITIALIZED');
        }
        const state = validate(row.state, value.scope);
        const op = state.operations.find(item => item.id === value.operationId);
        if (!op || op.kind !== value.kind || op.principalCents + op.tipCents !== value.amountCents
          || customerPaymentFingerprint(op.binding) !== customerPaymentFingerprint(value.binding)) {
          return workspaceFailure('PAYMENT_WORKSPACE_OBSERVATION_MISMATCH');
        }
        const { checkoutUrl: _checkoutUrl, ...facts } = value;
        const fingerprint = customerPaymentFingerprint(facts);
        const [inserted] = await tx.insert(customerPaymentLiveObservationSchema).values({
          id: randomUUID(),
          ...value.scope,
          operationId: op.id,
          fingerprint,
          facts,
          observedAt: new Date(value.observedAt),
        }).onConflictDoNothing().returning();
        if (!inserted) {
          return { state, replayed: true };
        }
        const conflict = op.providerObjectId !== null && op.providerObjectId !== value.objectId;
        if (conflict) {
          op.providerConflict = true;
        }
        const late = op.dispatchToken !== value.dispatchToken || op.state !== 'dispatching';
        op.providerObjectId ??= value.objectId;
        if (conflict || (late && op.state !== 'succeeded')) {
          op.state = 'review';
        } else if (op.state !== 'succeeded') {
          op.state = value.status === 'open' ? 'open' : 'pending';
        }
        op.dispatchUntil = null;
        const request = state.requests.find(item => item.id === op.id);
        const refund = state.refunds.find(item => item.id === op.id);
        if (request && request.state !== 'paid') {
          request.state = op.state === 'open' ? 'open' : op.state === 'review' ? 'uncertain' : 'processing';
        }
        if (refund && refund.state !== 'succeeded') {
          refund.state = op.state === 'review' ? 'under_review' : 'pending';
        }
        return save(tx, row, state, { requestId: randomUUID(), requestHash: fingerprint, actorId: 'system:payment-provider', action: conflict ? 'provider_object_conflict' : late ? 'provider_response_late' : 'provider_response' });
      });
    },
  };
}
