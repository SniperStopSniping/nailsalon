/**
 * Shared-sender global consent — the STOP/START suppression log reader and
 * writer. Keyed on (logical sender identity, normalized recipient); the
 * current state is the highest seq row. Append-only; salon-free by design.
 */

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { smsGlobalConsentEventSchema } from '@/models/Schema';

/** Normalize to bare digits with the leading 1 stripped (matches the per-salon consent convention). */
export function normalizeConsentRecipient(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export async function hasGlobalSuppression(
  senderIdentity: string,
  recipient: string,
): Promise<boolean> {
  const normalized = normalizeConsentRecipient(recipient);
  const rows = await db
    .select({ state: smsGlobalConsentEventSchema.state })
    .from(smsGlobalConsentEventSchema)
    .where(and(
      eq(smsGlobalConsentEventSchema.senderIdentity, senderIdentity),
      eq(smsGlobalConsentEventSchema.recipient, normalized),
    ))
    .orderBy(sql`${smsGlobalConsentEventSchema.seq} DESC`)
    .limit(1);
  return rows[0]?.state === 'suppressed';
}

export async function appendGlobalConsentEvent(input: {
  senderIdentity: string;
  recipient: string;
  state: 'suppressed' | 'restored';
  keywordClassification?: string | null;
  optOutType?: string | null;
  source: 'twilio_inbound' | 'twilio_advanced_opt_out' | 'operator' | 'import';
  providerSid?: string | null;
  occurredAt?: Date;
}): Promise<{ appended: boolean }> {
  const inserted = await db
    .insert(smsGlobalConsentEventSchema)
    .values({
      id: `sgc_${crypto.randomUUID()}`,
      senderIdentity: input.senderIdentity,
      recipient: normalizeConsentRecipient(input.recipient),
      state: input.state,
      keywordClassification: input.keywordClassification ?? null,
      optOutType: input.optOutType ?? null,
      source: input.source,
      providerSid: input.providerSid ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing()
    .returning();
  return { appended: inserted.length === 1 };
}
