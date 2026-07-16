import 'server-only';

import { createHmac } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { googleEventReviewPatternSchema } from '@/models/Schema';

export type GoogleEventReviewDecision = 'busy_time' | 'free_event' | 'appointment';

export function normalizeGoogleEventTitle(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleFingerprint(value: string): string {
  const secret = Env.OAUTH_STATE_SECRET || Env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('Google event review fingerprinting is not configured');
  }
  return createHmac('sha256', secret).update(value).digest('hex');
}

export async function recordGoogleEventReviewDecision(args: {
  salonId: string;
  title: string | null;
  decision: GoogleEventReviewDecision;
}) {
  const normalized = normalizeGoogleEventTitle(args.title);
  if (!normalized) {
    return;
  }
  const fingerprint = titleFingerprint(normalized);
  await db.insert(googleEventReviewPatternSchema).values({
    id: `grp_${crypto.randomUUID()}`,
    salonId: args.salonId,
    titleFingerprint: fingerprint,
    lastDecision: args.decision,
  }).onConflictDoUpdate({
    target: [googleEventReviewPatternSchema.salonId, googleEventReviewPatternSchema.titleFingerprint],
    set: {
      lastDecision: args.decision,
      decisionCount: sql`${googleEventReviewPatternSchema.decisionCount} + 1`,
      lastDecisionAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function getRecordedGoogleEventDecision(salonId: string, title: string | null) {
  const normalized = normalizeGoogleEventTitle(title);
  if (!normalized) {
    return null;
  }
  const [pattern] = await db.select({
    decision: googleEventReviewPatternSchema.lastDecision,
    count: googleEventReviewPatternSchema.decisionCount,
  }).from(googleEventReviewPatternSchema).where(and(
    eq(googleEventReviewPatternSchema.salonId, salonId),
    eq(googleEventReviewPatternSchema.titleFingerprint, titleFingerprint(normalized)),
  )).limit(1);
  return pattern || null;
}
