/**
 * Durable business identity — contract §7.3.
 *
 * Starter grants and founding-promotion claims attach to ONE durable
 * identity resolved through versioned links. Preference order: verified
 * Clerk owner id → salon id → Stripe customer id → keyed, versioned HMAC
 * of the verified email (fail-closed: without the dedicated secret the
 * email link is simply unavailable — never an unkeyed hash). HMAC rotation
 * attaches a NEW versioned link to the SAME identity; owner transfer and
 * salon recreation never reset eligibility.
 */

import 'server-only';

import { createHmac } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { Env } from '@/libs/Env';
import {
  billingBusinessIdentityLinkSchema,
  billingBusinessIdentitySchema,
  type BillingIdentityLinkType,
} from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

/**
 * Contract §7.3 email normalization: trim ASCII whitespace, NFC-normalize,
 * lowercase the DOMAIN only, never strip +tags or local-part dots, no
 * provider-specific equivalence games.
 */
export function normalizeEmailForHmac(email: string): string | null {
  const trimmed = email.trim().normalize('NFC');
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return null;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  return `${local}@${domain}`;
}

export type EmailFingerprint = { digest: string; version: number };

/** Fail-closed: null when the dedicated secret/version are not configured. */
export function computeEmailFingerprint(email: string): EmailFingerprint | null {
  const secret = Env.BILLING_IDENTITY_HMAC_SECRET;
  const version = Env.BILLING_IDENTITY_HMAC_VERSION;
  if (!secret || !version) {
    return null;
  }
  const normalized = normalizeEmailForHmac(email);
  if (normalized === null) {
    return null;
  }
  const digest = createHmac('sha256', secret).update(normalized, 'utf8').digest('hex');
  return { digest, version };
}

export type IdentitySignals = {
  clerkUserId?: string | null;
  salonId?: string | null;
  stripeCustomerId?: string | null;
  verifiedEmail?: string | null;
};

type CandidateLink = { linkType: BillingIdentityLinkType; linkValue: string; hmacKeyVersion: number | null };

function candidateLinks(signals: IdentitySignals): CandidateLink[] {
  const links: CandidateLink[] = [];
  if (signals.clerkUserId) {
    links.push({ linkType: 'clerk_user', linkValue: signals.clerkUserId, hmacKeyVersion: null });
  }
  if (signals.salonId) {
    links.push({ linkType: 'salon', linkValue: signals.salonId, hmacKeyVersion: null });
  }
  if (signals.stripeCustomerId) {
    links.push({ linkType: 'stripe_customer', linkValue: signals.stripeCustomerId, hmacKeyVersion: null });
  }
  if (signals.verifiedEmail) {
    const fingerprint = computeEmailFingerprint(signals.verifiedEmail);
    if (fingerprint !== null) {
      links.push({
        linkType: 'email_hmac',
        linkValue: fingerprint.digest,
        hmacKeyVersion: fingerprint.version,
      });
    }
  }
  return links;
}

export class BusinessIdentityError extends Error {
  constructor(public readonly code: 'NO_IDENTITY_SIGNALS' | 'IDENTITY_CONFLICT', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'BusinessIdentityError';
  }
}

/**
 * Resolve the durable identity for the given signals, creating it (and any
 * missing links) if none exists. Signals resolving to DIFFERENT existing
 * identities is a conflict surfaced loudly — an audited business split is
 * future controlled tooling, never an implicit merge.
 */
export async function resolveOrCreateBusinessIdentity(
  tx: BillingDbTransaction,
  signals: IdentitySignals,
): Promise<{ businessIdentityId: string; created: boolean }> {
  const links = candidateLinks(signals);
  if (links.length === 0) {
    throw new BusinessIdentityError('NO_IDENTITY_SIGNALS', 'at least one durable signal is required');
  }

  // Serialize per link-value (sorted, so overlapping signal sets cannot
  // deadlock): without this, two concurrent resolutions both see no links,
  // both mint identities, and the loser returns a PHANTOM identity that owns
  // zero links — which would sail past the once-per-business starter and
  // promotion fences.
  const lockKeys = links.map(link => `${link.linkType}:${link.linkValue}`).sort();
  for (const key of lockKeys) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 42))`);
  }

  const existing = await tx
    .select({
      businessIdentityId: billingBusinessIdentityLinkSchema.businessIdentityId,
      linkType: billingBusinessIdentityLinkSchema.linkType,
      linkValue: billingBusinessIdentityLinkSchema.linkValue,
    })
    .from(billingBusinessIdentityLinkSchema)
    .where(inArray(
      billingBusinessIdentityLinkSchema.linkValue,
      links.map(link => link.linkValue),
    ));
  const matches = existing.filter(row =>
    links.some(link => link.linkType === row.linkType && link.linkValue === row.linkValue));
  const identityIds = [...new Set(matches.map(row => row.businessIdentityId))];
  if (identityIds.length > 1) {
    throw new BusinessIdentityError(
      'IDENTITY_CONFLICT',
      `signals resolve to ${identityIds.length} distinct identities`,
    );
  }

  let businessIdentityId: string;
  let created = false;
  if (identityIds.length === 1) {
    businessIdentityId = identityIds[0]!;
  } else {
    businessIdentityId = `bbi_${crypto.randomUUID()}`;
    await tx.insert(billingBusinessIdentitySchema).values({ id: businessIdentityId });
    created = true;
  }

  for (const link of links) {
    await tx
      .insert(billingBusinessIdentityLinkSchema)
      .values({
        id: `bbil_${crypto.randomUUID()}`,
        businessIdentityId,
        linkType: link.linkType,
        linkValue: link.linkValue,
        hmacKeyVersion: link.hmacKeyVersion,
      })
      .onConflictDoNothing();
  }
  return { businessIdentityId, created };
}

export async function findBusinessIdentityByLink(
  tx: BillingDbTransaction,
  linkType: BillingIdentityLinkType,
  linkValue: string,
): Promise<string | null> {
  const rows = await tx
    .select({ businessIdentityId: billingBusinessIdentityLinkSchema.businessIdentityId })
    .from(billingBusinessIdentityLinkSchema)
    .where(and(
      eq(billingBusinessIdentityLinkSchema.linkType, linkType),
      eq(billingBusinessIdentityLinkSchema.linkValue, linkValue),
    ))
    .limit(1);
  return rows[0]?.businessIdentityId ?? null;
}
