import 'server-only';

import * as Sentry from '@sentry/nextjs';

import {
  getBindingsByStripeAccountId,
  revokeBinding,
} from '@/libs/stripeConnect/binding';
import {
  StripeConnectUnavailableError,
  syncAccountReadiness,
} from '@/libs/stripeConnect/readiness';
import {
  finalizeRetryable,
  finalizeTerminal,
  finalizeWebhookEvent,
  UNBOUND_MAX_ATTEMPTS,
  unboundBackoffMs,
} from '@/libs/stripeConnect/webhookEvents';

export type AccountWebhookClaim = { id: string; attempts: number };

export type AccountWebhookDispatchResult = 'ok' | 'retry' | 'unhandled';

/**
 * The shared D2 account-lifecycle routing table.
 *
 * Live deliveries and D5's stored-event sweep must execute the same handler.
 * Keeping this outside the HTTP route prevents a due `account.*` receipt from
 * falling through to the Checkout Session projection parser merely because it
 * is being driven by the sweep rather than by Stripe redelivery.
 */
export async function dispatchAccountWebhook(input: {
  type: string;
  eventId: string;
  account: string;
  claim: AccountWebhookClaim;
  expectedLivemode: boolean;
}): Promise<AccountWebhookDispatchResult> {
  if (input.type === 'account.updated') {
    return handleAccountUpdated(input);
  }
  if (input.type === 'account.application.deauthorized') {
    return handleDeauthorized(input);
  }
  return 'unhandled';
}

async function handleAccountUpdated(input: {
  eventId: string;
  account: string;
  claim: AccountWebhookClaim;
  expectedLivemode: boolean;
}): Promise<'ok' | 'retry'> {
  const { account, claim, eventId, expectedLivemode } = input;
  const bindings = await getBindingsByStripeAccountId(account);

  if (bindings.length === 0) {
    // `accounts.create` can return immediately before the binding INSERT lands.
    if (claim.attempts >= UNBOUND_MAX_ATTEMPTS) {
      Sentry.captureMessage('stripe_connect_unbound_unresolved', {
        level: 'error',
        tags: { webhook: 'stripe-connect' },
        extra: { eventId, account },
      });
      await finalizeTerminal({
        id: claim.id,
        attempts: claim.attempts,
        outcome: 'unbound_unresolved',
      });
      return 'ok';
    }
    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'unbound_account',
      availableAt: new Date(Date.now() + unboundBackoffMs(claim.attempts)),
    });
    return 'retry';
  }

  const live = bindings.find(binding => binding.revokedAt === null);

  if (!live) {
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_revoked_binding',
    });
    return 'ok';
  }

  if (live.livemode !== expectedLivemode) {
    Sentry.captureMessage('stripe_connect_mode_mismatch', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId, bindingId: live.id },
    });
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_livemode',
      lastError: 'binding_livemode_mismatch',
    });
    return 'ok';
  }

  try {
    await syncAccountReadiness(live);
  } catch (error) {
    if (
      error instanceof StripeConnectUnavailableError
      && error.code === 'PROVIDER_PERMANENT'
    ) {
      await revokeBinding(live.id, 'deauthorized', {
        actorId: 'system:stripe-connect-webhook',
        viaSuperAdminWithoutMembership: false,
        salonId: live.salonId,
        stripeAccountId: live.stripeAccountId,
        matchStripeAccountId: account,
      });
      await finalizeTerminal({
        id: claim.id,
        attempts: claim.attempts,
        outcome: 'permanent_provider_error',
      });
      return 'ok';
    }

    await finalizeRetryable({
      id: claim.id,
      attempts: claim.attempts,
      outcome: null,
      lastError: 'provider_unreachable',
      availableAt: new Date(Date.now() + unboundBackoffMs(claim.attempts)),
    });
    return 'retry';
  }

  await finalizeWebhookEvent({
    id: claim.id,
    attempts: claim.attempts,
    status: 'processed',
    outcome: 'processed',
    processedAt: new Date(),
  });
  return 'ok';
}

async function handleDeauthorized(input: {
  eventId: string;
  account: string;
  claim: AccountWebhookClaim;
}): Promise<'ok'> {
  const { account, claim, eventId } = input;
  const bindings = await getBindingsByStripeAccountId(account);

  if (bindings.length === 0) {
    Sentry.captureMessage('stripe_connect_unbound_unresolved', {
      level: 'error',
      tags: { webhook: 'stripe-connect' },
      extra: { eventId, account },
    });
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'unbound_unresolved',
    });
    return 'ok';
  }

  const live = bindings.find(binding => binding.revokedAt === null);

  if (!live) {
    await finalizeTerminal({
      id: claim.id,
      attempts: claim.attempts,
      outcome: 'ignored_revoked_binding',
    });
    return 'ok';
  }

  await revokeBinding(live.id, 'deauthorized', {
    actorId: 'system:stripe-connect-webhook',
    viaSuperAdminWithoutMembership: false,
    salonId: live.salonId,
    stripeAccountId: live.stripeAccountId,
    matchStripeAccountId: account,
  });

  await finalizeWebhookEvent({
    id: claim.id,
    attempts: claim.attempts,
    status: 'processed',
    outcome: 'processed',
    processedAt: new Date(),
  });
  return 'ok';
}
