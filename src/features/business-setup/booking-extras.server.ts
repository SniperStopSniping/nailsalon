import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { hasEmailInfrastructure } from '@/libs/bookingNotificationSettings';
import { mergeCommunicationSettings, resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import type { prepareDepositActivation } from '@/libs/depositActivation.server';
import { DEPOSIT_COLLECTION_LIVE, hasLegacyDepositEntitlement, readStoredDepositSettings, resolveDepositEntitlement, salonDepositSettingsSchema } from '@/libs/depositPolicy';
import { EXPECTED_LIVEMODE } from '@/libs/depositPolicy.server';
import { getSalonSmsReadiness } from '@/libs/integrationHealth';
import { readNoShowProtection } from '@/libs/networkNoShow';
import { type Salon, salonStripeAccountSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import type { SetupChange, SetupDocument } from './contracts';
import { SetupError } from './contracts';
import type { SetupTransaction } from './drafts.server';

type Activation = Extract<Awaited<ReturnType<typeof prepareDepositActivation>>, { ok: true }>;
export function setupBookingExtrasFromSettings(salon: Pick<Salon, 'settings'>) {
  const deposit = readStoredDepositSettings(salon.settings);
  const communication = resolveCommunicationSettingsFromSettings(salon.settings);
  return { deposit: { enabled: deposit.enabled === true, amountCents: deposit.amountCents ?? null }, reminders: { rules: communication.reminders.rules, quietHours: communication.quietHours } };
}
export function setupDepositActivationNeeded(salon: Pick<Salon, 'settings' | 'features'>, draft: SetupDocument) {
  const current = readStoredDepositSettings(salon.settings);
  return Boolean(draft.depositEditedFields?.includes('enabled') && draft.deposit?.enabled && (current.enabled !== true || (!current.activationConfirmed && !hasLegacyDepositEntitlement(salon.features))));
}

/** Private input to the review hash; provider refresh timestamps are excluded. */
export async function setupDepositApprovalAccount(tx: SetupTransaction, salonId: string) {
  const [account] = await tx.select({ id: salonStripeAccountSchema.id, accountId: salonStripeAccountSchema.stripeAccountId, livemode: salonStripeAccountSchema.livemode }).from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, salonId), isNull(salonStripeAccountSchema.revokedAt)));
  return account ?? null;
}

/** Exact canonical side effects are reviewed; the model cannot author them. */
export function setupBookingExtraEffects(salon: Salon, draft: SetupDocument) {
  const changes: SetupChange[] = [];
  const notices: string[] = [];
  if (!draft.depositEditedFields?.length) {
    return { changes, notices };
  }
  const old = readStoredDepositSettings(salon.settings);
  const dormant = !old.activationConfirmed && !hasLegacyDepositEntitlement(salon.features);
  const activating = setupDepositActivationNeeded(salon, draft);
  const protection = readNoShowProtection(salon.settings);
  if (activating && dormant && protection !== 'warn_only') {
    changes.push({ path: 'deposit.activationEffect.noShowProtection', before: protection, after: 'warn_only' });
    notices.push('Your previous no-show deposit rule was never activated. Enabling regular deposits leaves no-show protection at Warn only. You can choose enforcement separately in Payments.');
  } else if (protection !== 'warn_only') {
    notices.push('Existing no-show deposit protection is kept. Turning off regular deposits does not turn that protection off.');
  }
  if (!activating && dormant && draft.deposit?.enabled) {
    notices.push('The amount will be saved without activating collection. Explicitly enabling deposits and passing the payment checks is still required.');
  }
  if ([draft.bookingPolicy?.text, draft.bookingPolicy?.acknowledgment?.text, ...(draft.website.content.websiteDetails?.sections.map(section => section.text) ?? [])].some(text => typeof text === 'string' && /deposit/iu.test(text))) {
    notices.push('Your own website or agreement wording mentions a deposit. Check it against the proposed amount and collection choice; booking uses the approved payment settings.');
  }
  return { changes, notices };
}

/** Provider-free checklist. Real provider verification is reserved for approved publication. */
export async function setupBookingExtraBlockers(tx: SetupTransaction, salon: Salon, draft: SetupDocument) {
  const blockers: string[] = [];
  const networkProtection = readNoShowProtection(salon.settings) !== 'warn_only';
  if ((networkProtection || readStoredDepositSettings(salon.settings).enabled) && draft.booking.currency !== 'CAD' && draft.booking.currency !== (salon.settings?.booking?.currency ?? 'CAD')) {
    blockers.push('Disable your existing deposit requirements in Payments before changing currency.');
  }
  if (draft.depositEditedFields?.includes('amountCents') && draft.deposit?.amountCents === null && networkProtection) {
    blockers.push('Keep a deposit amount while no-show protection is enabled. Review that protection in Payments first.');
  }
  if (!setupDepositActivationNeeded(salon, draft)) {
    return blockers;
  }
  if (!DEPOSIT_COLLECTION_LIVE || !resolveDepositEntitlement(salon.features)) {
    blockers.push('Deposit collection is not available for this account. Keep deposits off to publish, or contact support.');
  }
  if (EXPECTED_LIVEMODE === null) {
    blockers.push('Payment collection is not configured in this environment. Keep deposits off for now.');
  }
  const [account] = await tx.select({ chargesEnabled: salonStripeAccountSchema.chargesEnabled, livemode: salonStripeAccountSchema.livemode, lastSyncedAt: salonStripeAccountSchema.lastSyncedAt }).from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, salon.id), isNull(salonStripeAccountSchema.revokedAt)));
  if (!account) {
    blockers.push('Connect your payment account before enabling deposits. Your proposed amount is saved.');
  } else if (!account.chargesEnabled || account.livemode !== EXPECTED_LIVEMODE || account.lastSyncedAt === null) {
    blockers.push('Finish payment-account setup before enabling deposits. Your proposed amount is saved.');
  }
  return blockers;
}

/** Only a caller holding the exact approved publication may pass provider proof. */
export async function setupPublishedBookingExtras(tx: SetupTransaction, salon: Salon, draft: SetupDocument, activation: Activation | null): Promise<Partial<SalonSettings>> {
  const result: Partial<SalonSettings> = {};
  if (draft.depositEditedFields?.length && draft.deposit) {
    salonDepositSettingsSchema.parse(Object.fromEntries(draft.depositEditedFields.filter(key => key !== 'amountCents' || draft.deposit?.amountCents !== null).map(key => [key, draft.deposit![key]])));
    const old = readStoredDepositSettings(salon.settings);
    const next = { ...old };
    const activating = setupDepositActivationNeeded(salon, draft);
    if (activating) {
      if (!activation) {
        throw new SetupError('NOT_READY', 'Confirm your payment account before enabling deposits.');
      }
      const proof = activation.readiness.binding;
      const [current] = await tx.select().from(salonStripeAccountSchema).where(and(eq(salonStripeAccountSchema.salonId, salon.id), eq(salonStripeAccountSchema.id, proof.id))).for('update');
      if (!current || current.revokedAt || !current.chargesEnabled || current.livemode !== EXPECTED_LIVEMODE || current.lastSyncedAt === null || current.lastSyncedAt.getTime() !== proof.lastSyncedAt?.getTime()) {
        throw new SetupError('STALE', 'Your payment account changed. Check its connection and review the setup again.');
      }
      if (!DEPOSIT_COLLECTION_LIVE || !resolveDepositEntitlement(salon.features) || draft.booking.currency !== 'CAD') {
        throw new SetupError('NOT_READY', 'Deposit collection is not ready for this business.');
      }
      next.activationConfirmed = true;
      if (!old.activationConfirmed && !hasLegacyDepositEntitlement(salon.features)) {
        next.noShowProtection = 'warn_only';
      }
    }
    if (draft.depositEditedFields.includes('enabled')) {
      next.enabled = draft.deposit.enabled;
    }
    if (draft.depositEditedFields.includes('amountCents')) {
      if (draft.deposit.amountCents === null) {
        delete next.amountCents;
      } else {
        next.amountCents = draft.deposit.amountCents;
      }
    }
    result.payments = { ...(salon.settings?.payments ?? {}), deposit: { ...(salon.settings?.payments?.deposit ?? {}), ...next } };
    if (draft.deposit.amountCents === null && draft.depositEditedFields.includes('amountCents')) {
      delete result.payments.deposit!.amountCents;
    }
  }
  if (draft.remindersEditedFields?.length && draft.reminders) {
    const current = resolveCommunicationSettingsFromSettings(salon.settings);
    const merged = mergeCommunicationSettings(current, { ...(draft.remindersEditedFields.includes('rules') ? { reminders: { rules: draft.reminders.rules } } : {}), ...(draft.remindersEditedFields.includes('quietHours') ? { quietHours: draft.reminders.quietHours } : {}) });
    result.communications = { ...(salon.settings?.communications ?? {}), ...(current.killSwitch ? { killSwitch: true } : {}), ...(draft.remindersEditedFields.includes('rules') ? { reminders: merged.reminders } : {}), ...(draft.remindersEditedFields.includes('quietHours') ? { quietHours: merged.quietHours } : {}) };
  }
  return result;
}

/** Uses the original delivery-health projection after the draft transaction closes. */
export async function setupReminderNotices(salonId: string, draft: SetupDocument) {
  if (!draft.remindersEditedFields?.length || !draft.reminders) {
    return [];
  }
  const active = draft.reminders.rules.filter(rule => rule.enabled);
  const notices = ['These preferences can reschedule reminders for existing upcoming appointments. Publication itself sends no messages. Channel switches, consent and sending controls are kept.'];
  if (active.some(rule => rule.channels !== 'email')) {
    try {
      const health = await getSalonSmsReadiness(salonId);
      if (!health.automaticEnabled) {
        notices.push(`Text delivery is not ready: ${health.detail}`);
      }
    } catch {
      notices.push('Text delivery could not be confirmed. Your reminder preferences can be saved without enabling texts.');
    }
  }
  if (active.some(rule => rule.channels !== 'sms') && !hasEmailInfrastructure()) {
    notices.push('Email delivery is not configured in this environment. Saving a reminder does not enable delivery.');
  }
  return notices;
}
