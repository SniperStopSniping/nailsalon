import 'server-only';

import Stripe from 'stripe';

import { createPaymentReturnUrl } from '../server/paymentReturnToken';
import type { PaymentProviderBinding, PaymentWorkspaceScope, WorkspaceOperation } from '../server/workspaceContract';
import { workspaceFailure } from '../server/workspaceContract';
import type { WorkspaceDispatchClaim, WorkspaceReconciliationClaim } from '../server/workspaceRepository';

const API_VERSION = '2024-06-20';
export type WorkspaceProviderObservation = Readonly<{
  scope: PaymentWorkspaceScope;
  operationId: string;
  dispatchToken: string;
  binding: PaymentProviderBinding;
  kind: 'payment' | 'refund';
  objectId: string;
  amountCents: number;
  status: 'open' | 'pending' | 'succeeded' | 'failed' | 'canceled' | 'expired';
  observedAt: number;
  /** Only returned to the authenticated requester; never placed in audit JSON. */
  checkoutUrl: string | null;
  financialPostingAllowed: false;
}>;
const observations = new WeakSet<object>();

export type WorkspaceVerifiedOutcome = Readonly<{
  scope: PaymentWorkspaceScope;
  operationId: string;
  expectedRevision: number;
  operationFingerprint: string;
  binding: PaymentProviderBinding;
  kind: 'payment' | 'refund';
  objectId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  amountCents: number;
  status: 'open' | 'pending' | 'succeeded' | 'failed' | 'canceled' | 'expired' | 'review';
  observedAt: number;
  checkoutUrl: string | null;
}>;
const outcomes = new WeakSet<object>();

/** Only independent SDK reads can produce a financial outcome. */
export function assertWorkspaceVerifiedOutcome(value: unknown): asserts value is WorkspaceVerifiedOutcome {
  if (!value || typeof value !== 'object' || !outcomes.has(value)
    || Date.now() < (value as WorkspaceVerifiedOutcome).observedAt
    || Date.now() - (value as WorkspaceVerifiedOutcome).observedAt > 120_000) {
    workspaceFailure('PAYMENT_WORKSPACE_VERIFIED_OUTCOME_REQUIRED');
  }
}

export function assertWorkspaceProviderObservation(value: unknown): asserts value is WorkspaceProviderObservation {
  if (!value || typeof value !== 'object' || !observations.has(value)) {
    workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_PROOF_REQUIRED');
  }
}

function runtime(binding: PaymentProviderBinding, secretKey: string, executing = true) {
  const production = process.env.APP_ENV === 'production';
  if ((executing && process.env.CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED !== 'true')
    || !['production', 'preview', 'development', 'test'].includes(process.env.APP_ENV ?? '')
    || (process.env.VERCEL === '1' && !['preview', 'production'].includes(process.env.VERCEL_ENV ?? ''))
    || (process.env.VERCEL_ENV === 'production' && !production)
    || (process.env.VERCEL_ENV === 'preview' && production)
    || (production && process.env.NODE_ENV !== 'production')
    || production !== binding.livemode
    || !secretKey.startsWith(binding.livemode ? 'sk_live_' : 'sk_test_')
    || (binding.livemode && !binding.returnOrigin.startsWith('https://'))) {
    workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_DISABLED');
  }
}

function amount(operation: WorkspaceOperation) {
  const total = operation.principalCents + operation.tipCents;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 50_000_000) {
    workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_AMOUNT_INVALID');
  }
  return total;
}

/**
 * Real SDK transport. It accepts only a committed, unconsumed database permit;
 * no HTTP client, Stripe host, operation amount or account comes from a request.
 * This separate client leaves subscription billing retry/timeout behavior intact.
 */
export function createWorkspaceStripeProvider(secretKey: string) {
  const client = new Stripe(secretKey, { apiVersion: API_VERSION, maxNetworkRetries: 0, timeout: 10000, telemetry: false });
  function options(binding: PaymentProviderBinding, connected = true): Stripe.RequestOptions {
    return { apiVersion: API_VERSION, maxNetworkRetries: 0, ...(connected ? { stripeAccount: binding.connectedAccountId } : {}) };
  }
  function responseScope(response: { lastResponse?: Stripe.Response<unknown>['lastResponse'] }, binding: PaymentProviderBinding, connected: boolean, idempotencyKey?: string) {
    const context = response.lastResponse;
    if (!context || context.statusCode !== 200
      || (context.apiVersion !== undefined && context.apiVersion !== API_VERSION)
      || (context.stripeAccount !== undefined && context.stripeAccount !== (connected ? binding.connectedAccountId : binding.platformAccountId))
      || (idempotencyKey !== undefined && context.idempotencyKey !== undefined && context.idempotencyKey !== idempotencyKey)) {
      workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_SCOPE_MISMATCH');
    }
  }
  async function preflight(binding: PaymentProviderBinding, collecting: boolean, executing = true) {
    runtime(binding, secretKey, executing);
    const platform = await client.accounts.retrieve({}, options(binding, false));
    responseScope(platform, binding, false);
    if (platform.id !== binding.platformAccountId || platform.object !== 'account') {
      workspaceFailure('PAYMENT_WORKSPACE_PLATFORM_MISMATCH');
    }
    const platformBalance = await client.balance.retrieve({}, options(binding, false));
    responseScope(platformBalance, binding, false);
    const account = await client.accounts.retrieve(binding.connectedAccountId, {}, options(binding, false));
    responseScope(account, binding, false);
    const controller = account.controller;
    if (account.id !== binding.connectedAccountId || account.country !== 'CA' || account.default_currency !== 'cad'
      || controller?.stripe_dashboard?.type !== 'full' || controller?.fees?.payer !== 'account'
      || controller?.losses?.payments !== 'stripe' || controller?.requirement_collection !== 'stripe') {
      workspaceFailure('PAYMENT_WORKSPACE_ACCOUNT_SCOPE_MISMATCH');
    }
    if (collecting && (!account.charges_enabled || !account.payouts_enabled || !account.details_submitted
      || account.capabilities?.card_payments !== 'active' || account.requirements?.disabled_reason
      || !account.requirements || account.requirements.currently_due?.length
      || account.requirements.past_due?.length || account.requirements.pending_verification?.length || account.requirements.errors?.length)) {
      workspaceFailure('PAYMENT_WORKSPACE_ACCOUNT_NOT_READY');
    }
    const connectedBalance = await client.balance.retrieve({}, options(binding));
    responseScope(connectedBalance, binding, true);
    if (platformBalance.livemode !== binding.livemode || connectedBalance.livemode !== binding.livemode) {
      workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_MODE_MISMATCH');
    }
  }

  async function refundsKnown(chargeId: string, claim: WorkspaceReconciliationClaim): Promise<boolean> {
    const refunds = await client.refunds.list({ charge: chargeId, limit: 100 }, options(claim.operation.binding));
    responseScope(refunds, claim.operation.binding, true);
    // An external pending refund has not changed amount_refunded yet. Include
    // the actual refund list so that it cannot be mistaken for unused credit.
    return !refunds.has_more && refunds.data.length === claim.knownRefunds.length
      && new Set(refunds.data.map(item => item.id)).size === refunds.data.length
      && refunds.data.every(item => claim.knownRefunds.some(known => known.objectId === item.id
        && known.operationId === item.metadata?.luster_payment_operation && known.amountCents === item.amount
        && item.charge === chargeId && item.currency === 'cad'));
  }

  return Object.freeze({
    async expire(claim: WorkspaceDispatchClaim): Promise<void> {
      const { assertWorkspaceDispatchClaim } = await import('../server/workspaceRepository');
      assertWorkspaceDispatchClaim(claim);
      const op = claim.operation;
      if (claim.action !== 'expire' || op.kind !== 'payment' || !op.providerObjectId) {
        workspaceFailure('PAYMENT_WORKSPACE_EXPIRY_PERMIT_REQUIRED');
      }
      await preflight(op.binding, false, false);
      assertWorkspaceDispatchClaim(claim, true);
      const session = await client.checkout.sessions.expire(op.providerObjectId, {}, { ...options(op.binding), idempotencyKey: claim.idempotencyKey });
      responseScope(session, op.binding, true, claim.idempotencyKey);
      if (session.id !== op.providerObjectId || session.livemode !== op.binding.livemode || session.status !== 'expired'
        || session.metadata?.luster_payment_operation !== op.id) {
        workspaceFailure('PAYMENT_WORKSPACE_SESSION_MISMATCH');
      }
      // This mutation response releases no money hold. The caller must retrieve
      // Session/Intent/Charge independently before recognizing cancellation.
    },

    /** Locate an unknown response with GETs; a candidate is not a settlement. */
    async discover(claim: WorkspaceReconciliationClaim): Promise<WorkspaceProviderObservation | null> {
      const { assertWorkspaceReconciliationClaim } = await import('../server/workspaceRepository');
      assertWorkspaceReconciliationClaim(claim);
      const op = claim.operation;
      if (op.providerObjectId || op.firstDispatchAt === null || !op.dispatchToken || (op.kind === 'refund' && !op.parentChargeId)) {
        return workspaceFailure('PAYMENT_WORKSPACE_DISCOVERY_HELD');
      }
      await preflight(op.binding, false, false);
      const created = { gte: Math.max(0, Math.floor(op.firstDispatchAt / 1000) - 300), lte: Math.floor(Date.now() / 1000) };
      const matches = new Set<string>();
      let cursor: string | undefined;
      let exhausted = false;
      // Bound account-wide discovery. A partial scan can never establish a
      // unique match or absence, and never authorizes a replacement request.
      for (let page = 0; page < 3; page++) {
        assertWorkspaceReconciliationClaim(claim);
        const params = { limit: 100, created, ...(cursor ? { starting_after: cursor } : {}) };
        const response = op.kind === 'payment'
          ? await client.checkout.sessions.list(params, options(op.binding))
          : await client.refunds.list({ ...params, charge: op.parentChargeId! }, options(op.binding));
        responseScope(response, op.binding, true);
        if (!Array.isArray(response.data) || typeof response.has_more !== 'boolean') {
          return workspaceFailure('PAYMENT_WORKSPACE_DISCOVERY_INVALID');
        }
        for (const candidate of response.data) {
          if (candidate.metadata?.luster_payment_operation !== op.id) {
            continue;
          }
          const valid = candidate.object === 'checkout.session'
            ? op.kind === 'payment' && candidate.client_reference_id === op.id && candidate.livemode === op.binding.livemode && candidate.amount_total === amount(op) && candidate.currency === 'cad' && /^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(candidate.id)
            : op.kind === 'refund' && candidate.object === 'refund' && candidate.charge === op.parentChargeId && candidate.amount === amount(op) && candidate.currency === 'cad' && /^re_[A-Za-z0-9]+$/.test(candidate.id);
          if (!valid) {
            return workspaceFailure('PAYMENT_WORKSPACE_DISCOVERY_MISMATCH');
          }
          matches.add(candidate.id);
        }
        if (matches.size > 1) {
          return workspaceFailure('PAYMENT_WORKSPACE_DISCOVERY_AMBIGUOUS');
        }
        if (!response.has_more) {
          exhausted = true;
          break;
        }
        const next = response.data.at(-1)?.id;
        if (!next || next === cursor) {
          return workspaceFailure('PAYMENT_WORKSPACE_DISCOVERY_INVALID');
        }
        cursor = next;
      }
      assertWorkspaceReconciliationClaim(claim);
      if (!exhausted || matches.size !== 1) {
        return null;
      }
      const result: WorkspaceProviderObservation = Object.freeze({ scope: Object.freeze({ ...claim.scope }), binding: Object.freeze({ ...op.binding }), operationId: op.id, dispatchToken: op.dispatchToken, kind: op.kind, objectId: [...matches][0]!, amountCents: amount(op), status: 'pending', observedAt: Date.now(), checkoutUrl: null, financialPostingAllowed: false });
      observations.add(result);
      return result;
    },

    async reconcile(claim: WorkspaceReconciliationClaim): Promise<WorkspaceVerifiedOutcome> {
      const { assertWorkspaceReconciliationClaim } = await import('../server/workspaceRepository');
      assertWorkspaceReconciliationClaim(claim);
      const op = claim.operation;
      if (!op.providerObjectId) {
        workspaceFailure('PAYMENT_WORKSPACE_PROVIDER_OBJECT_REQUIRED');
      }
      // Disabling new collection must never disable accounting for existing money.
      await preflight(op.binding, false, false);
      assertWorkspaceReconciliationClaim(claim);
      let status: WorkspaceVerifiedOutcome['status'] = 'pending';
      let paymentIntentId: string | null = null;
      let chargeId: string | null = null;
      let checkoutUrl: string | null = null;
      if (op.kind === 'payment') {
        const session = await client.checkout.sessions.retrieve(op.providerObjectId, {}, options(op.binding));
        responseScope(session, op.binding, true);
        if (session.id !== op.providerObjectId || session.object !== 'checkout.session'
          || session.mode !== 'payment' || session.livemode !== op.binding.livemode
          || session.currency !== 'cad' || session.amount_total !== amount(op) || session.amount_subtotal !== amount(op)
          || session.metadata?.luster_payment_operation !== op.id || session.client_reference_id !== op.id
          || session.expires_at !== op.sessionExpiresAt! / 1000 || session.automatic_tax?.enabled !== false
          || session.total_details?.amount_discount !== 0 || session.total_details.amount_shipping !== 0 || session.total_details.amount_tax !== 0) {
          workspaceFailure('PAYMENT_WORKSPACE_SESSION_MISMATCH');
        }
        paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
        if (session.status === 'open' && session.payment_status === 'unpaid' && paymentIntentId === null) {
          status = 'open';
          if (session.url) {
            const url = new URL(session.url);
            if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password
              || url.pathname !== `/c/pay/${session.id}`) {
              workspaceFailure('PAYMENT_WORKSPACE_CHECKOUT_URL_REJECTED');
            }
            checkoutUrl = session.url;
          }
        } else if (session.status === 'expired' && session.payment_status === 'unpaid' && paymentIntentId === null) {
          status = 'expired';
        } else if (paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
          const intent = await client.paymentIntents.retrieve(paymentIntentId, {}, options(op.binding));
          responseScope(intent, op.binding, true);
          if (intent.id !== paymentIntentId || intent.object !== 'payment_intent' || intent.livemode !== op.binding.livemode
            || intent.currency !== 'cad' || intent.amount !== amount(op) || intent.metadata.luster_payment_operation !== op.id
            || intent.capture_method !== 'automatic' || intent.application_fee_amount !== null || intent.transfer_data !== null
            || intent.on_behalf_of !== null) {
            workspaceFailure('PAYMENT_WORKSPACE_INTENT_MISMATCH');
          }
          chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id ?? null;
          if (intent.status === 'succeeded' && intent.amount_received === amount(op)
            && session.status === 'complete' && session.payment_status === 'paid' && chargeId) {
            const charge = await client.charges.retrieve(chargeId, {}, options(op.binding));
            responseScope(charge, op.binding, true);
            if (charge.id !== chargeId || charge.object !== 'charge' || charge.payment_intent !== paymentIntentId
              || charge.livemode !== op.binding.livemode || charge.currency !== 'cad' || charge.amount !== amount(op)
              || charge.amount_captured !== amount(op) || !charge.paid || !charge.captured || charge.status !== 'succeeded'
              || charge.application_fee !== null || charge.application_fee_amount !== null || charge.transfer_data !== null
              || charge.on_behalf_of !== null || charge.metadata.luster_payment_operation !== op.id) {
              workspaceFailure('PAYMENT_WORKSPACE_CHARGE_MISMATCH');
            }
            status = charge.disputed || charge.review !== null || charge.amount_refunded !== claim.expectedRefundedCents
            || !await refundsKnown(chargeId, claim)
              ? 'review'
              : 'succeeded';
          } else if (session.status === 'expired' && session.payment_status === 'unpaid'
            && intent.status === 'canceled' && intent.amount_received === 0 && chargeId === null) {
            status = 'expired';
          }
        }
      } else {
        if (!op.parentChargeId || !op.approvedBy) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_APPROVAL_REQUIRED');
        }
        const refund = await client.refunds.retrieve(op.providerObjectId, {}, options(op.binding));
        responseScope(refund, op.binding, true);
        if (refund.id !== op.providerObjectId || refund.object !== 'refund' || refund.currency !== 'cad'
          || refund.amount !== amount(op) || refund.charge !== op.parentChargeId
          || refund.metadata?.luster_payment_operation !== op.id) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_MISMATCH');
        }
        const charge = await client.charges.retrieve(op.parentChargeId, {}, options(op.binding));
        responseScope(charge, op.binding, true);
        if (charge.id !== op.parentChargeId || charge.object !== 'charge' || charge.livemode !== op.binding.livemode
          || charge.currency !== 'cad' || !charge.paid || !charge.captured || charge.amount_captured !== claim.parentAmountCents) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_PARENT_MISMATCH');
        }
        chargeId = charge.id;
        paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null;
        if (refund.payment_intent !== paymentIntentId || !paymentIntentId) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_PARENT_MISMATCH');
        }
        const expected = claim.expectedRefundedCents + (refund.status === 'succeeded' && !claim.alreadySettled ? amount(op) : 0);
        if (charge.disputed || charge.amount_refunded !== expected || !await refundsKnown(chargeId, claim)) {
          status = 'review';
        } else if (['succeeded', 'failed', 'canceled'].includes(refund.status ?? '')) {
          status = refund.status as 'succeeded' | 'failed' | 'canceled';
        }
      }
      assertWorkspaceReconciliationClaim(claim);
      const outcome: WorkspaceVerifiedOutcome = Object.freeze({
        scope: Object.freeze({ ...claim.scope }),
        binding: Object.freeze({ ...op.binding }),
        operationId: op.id,
        expectedRevision: claim.expectedRevision,
        operationFingerprint: claim.operationFingerprint,
        kind: op.kind,
        objectId: op.providerObjectId,
        paymentIntentId,
        chargeId,
        amountCents: amount(op),
        status,
        observedAt: Date.now(),
        checkoutUrl,
      });
      outcomes.add(outcome);
      return outcome;
    },

    async dispatch(claim: WorkspaceDispatchClaim): Promise<WorkspaceProviderObservation> {
      const { assertWorkspaceDispatchClaim } = await import('../server/workspaceRepository');
      assertWorkspaceDispatchClaim(claim);
      const op = claim.operation;
      if (claim.action !== 'create') {
        workspaceFailure('PAYMENT_WORKSPACE_CREATE_PERMIT_REQUIRED');
      }
      runtime(op.binding, secretKey);
      await preflight(op.binding, op.kind === 'payment');
      let objectId: string;
      let status: WorkspaceProviderObservation['status'];
      let checkoutUrl: string | null = null;
      if (op.kind === 'payment') {
        if (op.sessionExpiresAt === null || Date.now() + 30 * 60 * 1000 >= op.sessionExpiresAt) {
          workspaceFailure('PAYMENT_WORKSPACE_SESSION_WINDOW_EXPIRED');
        }
        runtime(op.binding, secretKey);
        const returnUrl = createPaymentReturnUrl(claim.scope, op);
        assertWorkspaceDispatchClaim(claim, true);
        const session = await client.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          client_reference_id: op.id,
          success_url: returnUrl,
          cancel_url: returnUrl,
          expires_at: op.sessionExpiresAt / 1000,
          automatic_tax: { enabled: false },
          allow_promotion_codes: false,
          line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: amount(op), product_data: { name: 'Appointment payment' } } }],
          metadata: { luster_payment_operation: op.id },
          payment_intent_data: { capture_method: 'automatic', metadata: { luster_payment_operation: op.id } },
        }, { ...options(op.binding), idempotencyKey: claim.idempotencyKey });
        responseScope(session, op.binding, true, claim.idempotencyKey);
        if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(session.id) || session.mode !== 'payment' || session.livemode !== op.binding.livemode
          || session.currency !== 'cad' || session.amount_total !== amount(op) || session.amount_subtotal !== amount(op)
          || session.metadata?.luster_payment_operation !== op.id || session.client_reference_id !== op.id
          || session.expires_at !== op.sessionExpiresAt / 1000 || session.automatic_tax?.enabled !== false
          || session.total_details?.amount_discount !== 0 || session.total_details.amount_shipping !== 0 || session.total_details.amount_tax !== 0
          || !['open', 'complete', 'expired'].includes(session.status ?? '') || !['paid', 'unpaid'].includes(session.payment_status)) {
          workspaceFailure('PAYMENT_WORKSPACE_SESSION_MISMATCH');
        }
        objectId = session.id;
        status = session.payment_status === 'paid' ? 'succeeded' : session.status === 'expired' ? 'expired' : session.status === 'open' ? 'open' : 'pending';
        if (status === 'open' && session.url) {
          const url = new URL(session.url);
          if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password
            || url.pathname !== `/c/pay/${session.id}`) {
            workspaceFailure('PAYMENT_WORKSPACE_CHECKOUT_URL_REJECTED');
          }
          checkoutUrl = session.url;
        }
      } else {
        if (!op.approvedBy || !op.parentChargeId) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_APPROVAL_REQUIRED');
        }
        const charge = await client.charges.retrieve(op.parentChargeId, {}, options(op.binding));
        responseScope(charge, op.binding, true);
        if (charge.id !== op.parentChargeId || charge.currency !== 'cad' || charge.livemode !== op.binding.livemode
          || !charge.paid || !charge.captured || charge.disputed || charge.amount_captured < amount(op)) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_PARENT_MISMATCH');
        }
        runtime(op.binding, secretKey);
        assertWorkspaceDispatchClaim(claim, true);
        const refund = await client.refunds.create({ charge: op.parentChargeId, amount: amount(op), reason: 'requested_by_customer', metadata: { luster_payment_operation: op.id } }, { ...options(op.binding), idempotencyKey: claim.idempotencyKey });
        responseScope(refund, op.binding, true, claim.idempotencyKey);
        if (!/^re_[A-Za-z0-9]+$/.test(refund.id) || refund.currency !== 'cad' || refund.amount !== amount(op)
          || refund.charge !== op.parentChargeId || refund.metadata?.luster_payment_operation !== op.id
          || !['succeeded', 'pending', 'failed', 'canceled', 'requires_action'].includes(refund.status ?? '')) {
          workspaceFailure('PAYMENT_WORKSPACE_REFUND_MISMATCH');
        }
        objectId = refund.id;
        status = refund.status === 'requires_action' ? 'pending' : refund.status as 'succeeded' | 'pending' | 'failed' | 'canceled';
      }
      const result: WorkspaceProviderObservation = Object.freeze({
        scope: Object.freeze({ ...claim.scope }),
        binding: Object.freeze({ ...op.binding }),
        operationId: op.id,
        dispatchToken: claim.dispatchToken,
        kind: op.kind,
        objectId,
        amountCents: amount(op),
        status,
        observedAt: Date.now(),
        checkoutUrl,
        financialPostingAllowed: false,
      });
      observations.add(result);
      return result;
    },
  });
}
