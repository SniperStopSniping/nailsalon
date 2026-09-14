/**
 * P8a operator backfill — G22 (plan §5 P8a; contract §3.1, §7.3, §20 step 6,
 * §21 step 9).
 *
 * `grantStarterCredits` is only reachable from the two live onboarding
 * transactions (`src/app/api/onboarding/luster/route.ts`,
 * `src/features/onboarding-v1-integration/persistence.server.ts`). There is
 * no operational path to grant the one-time 100-credit starter allowance to
 * a salon that predates the credit engine (Isla) or that otherwise never
 * went through onboarding's grant call site. This module is that path —
 * DB-only, no route/CLI concerns. The operator surface is
 * `src/app/api/super-admin/billing/starter-grant/route.ts` (a super-admin
 * API route — an earlier `scripts/grant-starter-credits.ts` tsx CLI was
 * deleted because it was structurally unrunnable for a real invocation:
 * `creditGrants.ts`'s module-scope `@/libs/DB` import pulls in `DB.ts`'s
 * top-level `await`, which tsx/esbuild cannot compile to CJS under this
 * repository's CommonJS-default `package.json`; the Next.js server process
 * the route runs in has no such limitation).
 *
 * `planStarterGrantBackfill` is read-only by construction: it resolves the
 * salon's identity signals against EXISTING business-identity links only
 * (`findBusinessIdentityByLink`), never `resolveOrCreateBusinessIdentity`
 * (which always creates on a miss). Nothing is ever inserted by a plan call.
 *
 * `applyStarterGrantBackfill` reuses the exact live call shape
 * (`src/app/api/onboarding/luster/route.ts` ~423-427): resolve/create the
 * identity, then `grantStarterCredits` — the SAME idempotent function the
 * live onboarding path calls, unedited. A second `apply` is a no-op
 * because `grantStarterCredits`'s `onConflictDoNothing` on
 * `billing_starter_grant.business_identity_id` is the once-per-business
 * fence; this module adds nothing to that fence.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import { logAuditEventTx } from '@/libs/auditLog';
import {
  computeEmailFingerprint,
  findBusinessIdentityByLink,
  resolveOrCreateBusinessIdentity,
} from '@/libs/billing/businessIdentity';
import { grantStarterCredits, STARTER_CREDITS } from '@/libs/billing/creditGrants';
import { billingStarterGrantSchema, salonSchema } from '@/models/Schema';

import type { BillingDbTransaction } from './creditLedger';

/** The minimal transaction-capable handle both entry points need. */
export type StarterGrantBackfillDb = {
  transaction: <T>(callback: (tx: BillingDbTransaction) => Promise<T>) => Promise<T>;
};

export type StarterGrantBackfillErrorCode = 'SALON_NOT_FOUND' | 'SALON_DELETED';

export class StarterGrantBackfillError extends Error {
  readonly code: StarterGrantBackfillErrorCode;

  constructor(code: StarterGrantBackfillErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'StarterGrantBackfillError';
    this.code = code;
  }
}

type SalonIdentityRow = {
  id: string;
  slug: string;
  ownerClerkUserId: string | null;
  ownerEmail: string | null;
  stripeCustomerId: string | null;
};

async function loadSalonBySlug(
  tx: BillingDbTransaction,
  salonSlug: string,
): Promise<SalonIdentityRow> {
  const rows = await tx
    .select({
      id: salonSchema.id,
      slug: salonSchema.slug,
      ownerClerkUserId: salonSchema.ownerClerkUserId,
      ownerEmail: salonSchema.ownerEmail,
      stripeCustomerId: salonSchema.stripeCustomerId,
      deletedAt: salonSchema.deletedAt,
    })
    .from(salonSchema)
    .where(eq(salonSchema.slug, salonSlug))
    .limit(1);
  const salon = rows[0];
  if (!salon) {
    throw new StarterGrantBackfillError('SALON_NOT_FOUND', `no salon with slug "${salonSlug}"`);
  }
  if (salon.deletedAt !== null) {
    throw new StarterGrantBackfillError('SALON_DELETED', `salon "${salonSlug}" is soft-deleted`);
  }
  return {
    id: salon.id,
    slug: salon.slug,
    ownerClerkUserId: salon.ownerClerkUserId,
    ownerEmail: salon.ownerEmail,
    stripeCustomerId: salon.stripeCustomerId,
  };
}

/**
 * Read-only identity resolution: contract §7.3 preference order (verified
 * Clerk owner id → durable salon link → Stripe customer id → versioned HMAC
 * email fallback), but checking EXISTING links only via
 * `findBusinessIdentityByLink` — never creating. Returns the first identity
 * an existing link resolves to, or null when no candidate signal has ever
 * been linked (the salon predates any business-identity resolution).
 */
async function findExistingBusinessIdentityId(
  tx: BillingDbTransaction,
  salon: SalonIdentityRow,
): Promise<string | null> {
  if (salon.ownerClerkUserId) {
    const id = await findBusinessIdentityByLink(tx, 'clerk_user', salon.ownerClerkUserId);
    if (id) {
      return id;
    }
  }

  const salonLinked = await findBusinessIdentityByLink(tx, 'salon', salon.id);
  if (salonLinked) {
    return salonLinked;
  }

  if (salon.stripeCustomerId) {
    const id = await findBusinessIdentityByLink(tx, 'stripe_customer', salon.stripeCustomerId);
    if (id) {
      return id;
    }
  }

  if (salon.ownerEmail) {
    const fingerprint = computeEmailFingerprint(salon.ownerEmail);
    if (fingerprint) {
      const id = await findBusinessIdentityByLink(tx, 'email_hmac', fingerprint.digest);
      if (id) {
        return id;
      }
    }
  }

  return null;
}

export type StarterGrantBackfillPlan = {
  salon: { id: string; slug: string };
  businessIdentityId: string | null;
  alreadyGranted: boolean;
  wouldGrant: boolean;
  credits: number;
};

/**
 * Read-only report: resolves the salon and its EXISTING business identity
 * (never creating one), and reports whether a starter grant already exists
 * for it. Writes nothing under any circumstance — every statement below is
 * a SELECT, and the surrounding transaction is used only for a consistent
 * read snapshot, never committed writes.
 */
export async function planStarterGrantBackfill(
  db: StarterGrantBackfillDb,
  input: { salonSlug: string },
): Promise<StarterGrantBackfillPlan> {
  return db.transaction(async (tx) => {
    const salon = await loadSalonBySlug(tx, input.salonSlug);
    const businessIdentityId = await findExistingBusinessIdentityId(tx, salon);

    let alreadyGranted = false;
    if (businessIdentityId) {
      const existing = await tx
        .select({ id: billingStarterGrantSchema.id })
        .from(billingStarterGrantSchema)
        .where(eq(billingStarterGrantSchema.businessIdentityId, businessIdentityId))
        .limit(1);
      alreadyGranted = existing.length > 0;
    }

    return {
      salon: { id: salon.id, slug: salon.slug },
      businessIdentityId,
      alreadyGranted,
      wouldGrant: !alreadyGranted,
      credits: STARTER_CREDITS,
    };
  });
}

export type StarterGrantBackfillResult = {
  granted: boolean;
  businessIdentityId: string;
  ledgerEvidence: { lotId: string; credits: number; bucket: 'starter' } | null;
};

/**
 * Applies the backfill inside ONE transaction: resolve-or-create the
 * business identity (the same call shape onboarding uses), then
 * `grantStarterCredits` (idempotent, unedited). On a genuine grant, writes a
 * `billing_starter_grant_backfilled` audit row atomically with the money
 * movement (`logAuditEventTx` — throws on failure, so a lost audit row can
 * never coexist with a committed grant). A replay (`granted: false`) writes
 * no audit row and is a true no-op, including for a salon whose grant
 * happened via the live onboarding path — the identity resolves to the same
 * row either way.
 */
export async function applyStarterGrantBackfill(
  db: StarterGrantBackfillDb,
  input: { salonSlug: string; actorId: string; now?: Date },
): Promise<StarterGrantBackfillResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const salon = await loadSalonBySlug(tx, input.salonSlug);
    const identity = await resolveOrCreateBusinessIdentity(tx, {
      clerkUserId: salon.ownerClerkUserId,
      salonId: salon.id,
      stripeCustomerId: salon.stripeCustomerId,
      verifiedEmail: salon.ownerEmail,
    });

    const grant = await grantStarterCredits(tx, {
      businessIdentityId: identity.businessIdentityId,
      salonId: salon.id,
      now,
    });

    if (!grant.granted) {
      return {
        granted: false,
        businessIdentityId: identity.businessIdentityId,
        ledgerEvidence: null,
      };
    }

    const evidenceRows = await tx
      .select({ ledgerId: billingStarterGrantSchema.ledgerId })
      .from(billingStarterGrantSchema)
      .where(eq(billingStarterGrantSchema.businessIdentityId, identity.businessIdentityId))
      .limit(1);
    const lotId = evidenceRows[0]?.ledgerId ?? null;
    if (!lotId) {
      throw new Error('starter grant backfill: granted but ledger evidence is missing');
    }

    await logAuditEventTx(tx, {
      salonId: salon.id,
      actorType: 'super_admin',
      actorId: input.actorId,
      action: 'billing_starter_grant_backfilled',
      entityType: 'billing_starter_grant',
      entityId: identity.businessIdentityId,
      metadata: {
        salonSlug: salon.slug,
        credits: STARTER_CREDITS,
        lotId,
      },
    });

    return {
      granted: true,
      businessIdentityId: identity.businessIdentityId,
      ledgerEvidence: { lotId, credits: STARTER_CREDITS, bucket: 'starter' },
    };
  });
}
