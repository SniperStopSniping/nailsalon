/**
 * Low-balance warnings — Gate C4 (§10.3, contract §7.1 Rev 2.2).
 *
 * Durable dedupe rides the Migration-A columns on sms_credit_account:
 * `warning_epoch` (bumped by every grant/top-up/recovery in appendLotGrant,
 * which deterministically resets eligibility), `last_warning_tier` and
 * `last_warning_at`. Within one epoch the tier only ever moves DOWNWARD
 * (20pct → 10 → 0), so each tier warns AT MOST ONCE per epoch and a balance
 * hovering around a threshold cannot flap into a warning loop.
 *
 * Delivery is email + in-app only — NEVER SMS (§10.3: a warning about SMS
 * credits must not spend SMS credits, and a zero-credit account could not
 * send it anyway). The email sender is injected so tests never touch a
 * provider.
 */

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { computeAvailableBalance } from '@/libs/billing/creditLedger';
import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import { db } from '@/libs/DB';
import {
  billingSubscriptionSchema,
  salonSchema,
  smsCreditAccountSchema,
} from '@/models/Schema';

export type WarningTier = '20pct' | '10' | '0';

const TIER_RANK: Record<WarningTier, number> = { '20pct': 1, '10': 2, '0': 3 };

export type WarningEmailFn = (input: {
  salonId: string;
  ownerEmail: string;
  tier: WarningTier;
  availableCredits: number;
}) => Promise<void>;

/** The tier a balance sits in, or null when comfortably above every line. */
export function classifyWarningTier(available: number, monthlyAllowance: number): WarningTier | null {
  if (available <= 0) {
    return '0';
  }
  if (available <= 10) {
    return '10';
  }
  if (monthlyAllowance > 0 && available <= Math.floor(monthlyAllowance * 0.2)) {
    return '20pct';
  }
  return null;
}

export type LowBalanceEvaluation = {
  scanned: number;
  warned: Array<{ salonId: string; tier: WarningTier }>;
};

/**
 * One evaluation pass over accounts. Exactly-once per tier per epoch is
 * enforced by a CAS on (warning_epoch, last_warning_tier): a concurrent
 * evaluator loses the update and sends nothing.
 */
export async function evaluateLowBalanceWarnings(input: {
  sendWarningEmail: WarningEmailFn;
  salonId?: string;
  now?: Date;
}): Promise<LowBalanceEvaluation> {
  const now = input.now ?? new Date();
  const accounts = await db
    .select({
      salonId: smsCreditAccountSchema.salonId,
      warningEpoch: smsCreditAccountSchema.warningEpoch,
      lastWarningTier: smsCreditAccountSchema.lastWarningTier,
      ownerEmail: salonSchema.ownerEmail,
    })
    .from(smsCreditAccountSchema)
    .innerJoin(salonSchema, eq(smsCreditAccountSchema.salonId, salonSchema.id))
    .where(input.salonId !== undefined
      ? eq(smsCreditAccountSchema.salonId, input.salonId)
      : sql`true`)
    .limit(500);

  const result: LowBalanceEvaluation = { scanned: accounts.length, warned: [] };
  for (const account of accounts) {
    const balance = await db.transaction(async tx =>
      computeAvailableBalance(tx, account.salonId, now));
    const [subscription] = await db
      .select({ planDefinitionKey: billingSubscriptionSchema.planDefinitionKey })
      .from(billingSubscriptionSchema)
      .where(eq(billingSubscriptionSchema.salonId, account.salonId))
      .limit(1);
    const allowance = subscription !== undefined
      ? getPlanDefinition(subscription.planDefinitionKey)?.monthlySmsCredits ?? 0
      : 0;

    const tier = classifyWarningTier(balance.available, allowance);
    if (tier === null) {
      continue;
    }
    const lastRank = account.lastWarningTier !== null
      ? TIER_RANK[account.lastWarningTier as WarningTier] ?? 0
      : 0;
    if (TIER_RANK[tier] <= lastRank) {
      continue; // this tier (or a lower balance) already warned this epoch
    }

    // CAS: only the writer that still sees the same epoch+tier sends.
    const updated = await db
      .update(smsCreditAccountSchema)
      .set({ lastWarningTier: tier, lastWarningAt: now })
      .where(and(
        eq(smsCreditAccountSchema.salonId, account.salonId),
        eq(smsCreditAccountSchema.warningEpoch, account.warningEpoch),
        account.lastWarningTier === null
          ? sql`${smsCreditAccountSchema.lastWarningTier} IS NULL`
          : eq(smsCreditAccountSchema.lastWarningTier, account.lastWarningTier),
      ))
      .returning();
    if (updated.length !== 1) {
      continue;
    }
    if (account.ownerEmail) {
      try {
        await input.sendWarningEmail({
          salonId: account.salonId,
          ownerEmail: account.ownerEmail,
          tier,
          availableCredits: balance.available,
        });
      } catch {
        // The warning state is already durable; a failed email is retried
        // implicitly if the balance drops another tier, and the in-app
        // surface (usage API) shows the state regardless.
      }
    }
    result.warned.push({ salonId: account.salonId, tier });
  }
  return result;
}

/** Production email implementation — plain transactional copy, no SMS ever. */
export const sendLowBalanceWarningEmail: WarningEmailFn = async (input) => {
  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  const copy: Record<WarningTier, { subject: string; body: string }> = {
    '20pct': {
      subject: 'Your SMS credits are running low',
      body: `You have ${input.availableCredits} SMS credits remaining. You can buy more or upgrade your plan from Settings.`,
    },
    '10': {
      subject: 'Only a few SMS credits left',
      body: `You have ${input.availableCredits} SMS credits remaining. Text reminders will pause when they run out; email keeps working.`,
    },
    '0': {
      subject: 'SMS credits have run out',
      body: 'Text reminders are paused. Email confirmations and reminders continue, and bookings are unaffected. Buy more credits or upgrade from Settings to resume texts.',
    },
  };
  await sendTransactionalEmailDetailed({
    to: input.ownerEmail,
    subject: copy[input.tier].subject,
    text: copy[input.tier].body,
    html: `<p>${copy[input.tier].body}</p>`,
  });
};
