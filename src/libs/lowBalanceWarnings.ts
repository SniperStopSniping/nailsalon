/** Durable owner email warnings. No page-load sends and no SMS consumption. */
import 'server-only';

import { eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { computeAvailableBalance, lockCreditAccount } from '@/libs/billing/creditLedger';
import { db } from '@/libs/DB';
import { resolveSalonEmailNotificationSettings, resolveSalonNotificationRecipient } from '@/libs/salonNotificationEmailSettings';
import { smsCreditStatus } from '@/libs/smsCreditStatus';
import { type IntegrationOutboxJob, integrationOutboxSchema, salonSchema, smsCreditAccountSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// The stored name "20pct" is retained for compatibility with existing rows and
// their CHECK constraint; it now represents the shared fixed 25-credit threshold.
export type WarningTier = '20pct' | '10' | '0';
const TIER_RANK: Record<WarningTier, number> = { '20pct': 1, '10': 2, '0': 3 };
export function classifyWarningTier(available: number): WarningTier | null {
  return { healthy: null, low: '20pct', critical: '10', empty: '0' }[smsCreditStatus(available)] as WarningTier | null;
}
export type LowBalanceEvaluation = { scanned: number; warned: Array<{ salonId: string; tier: WarningTier }> };

/** Account lock + outbox insert + warning marker are one transaction. */
export async function evaluateLowBalanceWarnings(input: { salonId?: string; now?: Date } = {}): Promise<LowBalanceEvaluation> {
  const now = input.now ?? new Date();
  const result: LowBalanceEvaluation = { scanned: 0, warned: [] };
  let after: string | null = null;
  for (;;) {
    const accounts = await db.select({ salonId: smsCreditAccountSchema.salonId }).from(smsCreditAccountSchema)
      .where(input.salonId ? eq(smsCreditAccountSchema.salonId, input.salonId) : after ? gt(smsCreditAccountSchema.salonId, after) : undefined)
      .orderBy(smsCreditAccountSchema.salonId).limit(500);
    for (const account of accounts) {
      result.scanned += 1;
      const queued = await db.transaction(async (tx) => {
        await lockCreditAccount(tx, account.salonId);
        const [current] = await tx.select({ epoch: smsCreditAccountSchema.warningEpoch, lastTier: smsCreditAccountSchema.lastWarningTier, ownerEmail: salonSchema.ownerEmail, email: salonSchema.email, settings: salonSchema.settings }).from(smsCreditAccountSchema)
          .innerJoin(salonSchema, eq(salonSchema.id, smsCreditAccountSchema.salonId)).where(eq(smsCreditAccountSchema.salonId, account.salonId));
        if (!current) {
          return null;
        }
        const balance = await computeAvailableBalance(tx, account.salonId, now);
        const tier = classifyWarningTier(balance.available);
        if (!tier || TIER_RANK[tier] <= (current.lastTier ? TIER_RANK[current.lastTier as WarningTier] ?? 0 : 0)) {
          return null;
        }
        // An account that has never held credits has not crossed a threshold.
        const activity = await tx.execute(sql`SELECT 1 FROM sms_credit_ledger WHERE salon_id = ${account.salonId} AND amount > 0 LIMIT 1`);
        if (!activity.rows.length) {
          return null;
        }
        const settings = resolveSalonEmailNotificationSettings(current.settings as SalonSettings | null);
        const recipient = resolveSalonNotificationRecipient({ recipientEmail: settings.recipientEmail, ownerEmail: current.ownerEmail, salonEmail: current.email });
        if (!settings.lowSmsBalance || !recipient.email) {
          return null;
        }
        const copy = warningCopy(tier);
        await tx.insert(integrationOutboxSchema).values({
          id: `io_${crypto.randomUUID()}`,
          salonId: account.salonId,
          provider: 'email',
          operation: 'sms_low_balance',
          dedupeKey: `sms-low-balance:${account.salonId}:${current.epoch}:${tier}`,
          payload: { epoch: current.epoch, tier, to: recipient.email, ...copy },
          createdAt: now,
          availableAt: now,
        }).onConflictDoNothing({ target: integrationOutboxSchema.dedupeKey });
        await tx.update(smsCreditAccountSchema).set({ lastWarningTier: tier, lastWarningAt: now }).where(eq(smsCreditAccountSchema.salonId, account.salonId));
        return tier;
      });
      if (queued) {
        result.warned.push({ salonId: account.salonId, tier: queued });
      }
    }
    if (input.salonId || accounts.length < 500) {
      break;
    }
    after = accounts[accounts.length - 1]!.salonId;
  }
  return result;
}

function warningCopy(tier: WarningTier) {
  const subject = tier === '0' ? 'Your Luster texts need more credits' : tier === '10' ? 'Your Luster text balance is almost out' : 'Your Luster text balance is running low';
  const text = `${tier === '0' ? 'Your salon has run out of available text credits.' : tier === '10' ? 'Your salon reached 10 or fewer text credits.' : 'Your salon reached 25 or fewer text credits.'} Open More in Luster to check your latest balance and choose Buy More Texts. Online booking, email and your core app remain available. You can manage these emails in Settings → Notifications.`;
  return { subject, text, html: `<p>${text}</p>` };
}
const warningPayload = z.object({ epoch: z.number().int().nonnegative(), tier: z.enum(['20pct', '10', '0']), to: z.string().email(), subject: z.string(), text: z.string(), html: z.string() });

/** The outbox owns retries; stable payload/key prevents duplicate provider sends. */
export async function deliverLowBalanceWarning(job: IntegrationOutboxJob, options: { now?: Date; signal?: AbortSignal } = {}): Promise<'sent' | 'cancelled' | 'expired'> {
  const now = options.now ?? new Date();
  // Resend deduplicates for 24h. Never retry across that boundary after an
  // uncertain delivery; leave an explicit failed job for operator review.
  if (now.getTime() - job.createdAt.getTime() >= 23 * 60 * 60 * 1000) {
    return 'expired';
  }
  const payload = warningPayload.parse(job.payload);
  const [current] = await db.select({ epoch: smsCreditAccountSchema.warningEpoch, settings: salonSchema.settings, ownerEmail: salonSchema.ownerEmail, email: salonSchema.email }).from(smsCreditAccountSchema)
    .innerJoin(salonSchema, eq(salonSchema.id, smsCreditAccountSchema.salonId)).where(eq(smsCreditAccountSchema.salonId, job.salonId));
  if (!current || current.epoch !== payload.epoch) {
    return 'cancelled';
  }
  const settings = resolveSalonEmailNotificationSettings(current.settings as SalonSettings | null);
  const recipient = resolveSalonNotificationRecipient({ recipientEmail: settings.recipientEmail, ownerEmail: current.ownerEmail, salonEmail: current.email });
  if (!settings.lowSmsBalance || recipient.email !== payload.to) {
    return 'cancelled';
  }
  const balance = await db.transaction(tx => computeAvailableBalance(tx, job.salonId, now));
  const tier = classifyWarningTier(balance.available);
  if (!tier || TIER_RANK[tier] < TIER_RANK[payload.tier]) {
    return 'cancelled';
  }
  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  const result = await sendTransactionalEmailDetailed({ to: payload.to, subject: payload.subject, text: payload.text, html: payload.html }, { signal: options.signal, idempotencyKey: `luster-sms-warning/${job.id}` });
  if (!result.ok) {
    throw new Error(result.errorCode ?? 'LOW_BALANCE_EMAIL_FAILED');
  }
  return 'sent';
}
