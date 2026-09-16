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
 *
 * Y9 (final handoff §6.2): the identity signals this module supplies are
 * `clerk_user`, `salon`, `stripe_customer` and — only when the owner's
 * `admin_user` row carries a non-null `email_verified_at` — that row's
 * verified email. The legacy free-text `salon.owner_email` is NEVER an
 * identity signal here; see `SalonIdentityRow`. A genuine multi-identity
 * collision propagates as `BusinessIdentityError('IDENTITY_CONFLICT')` out
 * of `applyStarterGrantBackfill` (the whole transaction rolls back, so no
 * credits move and no audit row is written) and the operator route answers
 * a typed 409 rather than a masked 500.
 */

import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { logAuditEventTx } from '@/libs/auditLog';
import {
  computeEmailFingerprint,
  findBusinessIdentityByLink,
  resolveOrCreateBusinessIdentity,
} from '@/libs/billing/businessIdentity';
import { grantStarterCredits, STARTER_CREDITS } from '@/libs/billing/creditGrants';
import {
  adminSalonMembershipSchema,
  adminUserSchema,
  billingStarterGrantSchema,
  salonSchema,
} from '@/models/Schema';

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

/**
 * Y9 (final handoff §6.2): deliberately NO `ownerEmail`.
 *
 * `salon.owner_email` is a free-text contact column — nothing in the product
 * ever proves that the person holding that mailbox asked for it to be there.
 * `businessIdentity.ts:81-90` turns ANY non-empty `verifiedEmail` signal into
 * a durable `email_hmac` link, and `billing_identity_link_value_uniq` makes
 * one link value belong to exactly one identity GLOBALLY. So feeding the
 * legacy column in would merge two unrelated salons that happen to share an
 * owner email into a single business identity, and because the starter grant
 * is fenced per identity, the second salon's grant would silently report
 * `granted: false` — or the resolution would raise `IDENTITY_CONFLICT`
 * (`businessIdentity.ts:140-145`). Live onboarding
 * (`src/app/api/onboarding/luster/route.ts:418-421`,
 * `src/features/onboarding-v1-integration/persistence.server.ts:1979-1982`)
 * passes a genuinely Clerk-VERIFIED address, so the two paths must agree on
 * what "verified" means or they do not resolve the same identity.
 *
 * The verified address therefore comes from `admin_user` — the row that
 * actually carries the verification marker — and never from the salon row,
 * which is why the salon projection below drops `ownerEmail` entirely: what
 * this type cannot hold, a later edit cannot accidentally pass on.
 */
type SalonIdentityRow = {
  id: string;
  slug: string;
  ownerClerkUserId: string | null;
  /**
   * `admin_user.email` of the salon's owner, and ONLY when that row's
   * `email_verified_at` is non-null. `null` whenever the owner has no
   * admin row, no email, or an unverified one — the `clerk_user`, `salon`
   * and `stripe_customer` signals carry the resolution in that case.
   */
  ownerVerifiedEmail: string | null;
  stripeCustomerId: string | null;
};

/**
 * The owner's verified email address, or null.
 *
 * `admin_user.email_verified_at` is the ONLY verified-email marker this
 * schema has (`src/models/Schema.ts:2065`); it attests `admin_user.email`,
 * so that is the address returned — never `salon.owner_email`, which no
 * marker covers.
 *
 * Two lookups, in preference order:
 *  1. `admin_user.clerk_user_id = salon.owner_clerk_user_id` — the Clerk-first
 *     owner. Onboarding writes the SAME Clerk id to both columns
 *     (`onboarding/luster/route.ts:346` and `:407`), so this is an exact
 *     identity, not a heuristic.
 *  2. the `admin_salon_membership` row with `role = 'owner'` — the canonical
 *     owner relation for a legacy phone-OTP salon whose `owner_clerk_user_id`
 *     was never populated. Ordered by `admin_user.created_at`, then by `id`,
 *     so a salon that somehow carries two owner rows resolves deterministically
 *     to the founding one rather than to whichever row the planner happened to
 *     emit. The id tiebreak is load-bearing: `created_at` defaults to `now()`,
 *     which is the TRANSACTION timestamp, so two owners created in one
 *     transaction share it exactly and ordering on the timestamp alone would
 *     still be arbitrary — and an arbitrary owner means an arbitrary verified
 *     address attached to this business identity.
 */
async function loadOwnerVerifiedEmail(
  tx: BillingDbTransaction,
  salon: { id: string; ownerClerkUserId: string | null },
): Promise<string | null> {
  let owner: { email: string | null; emailVerifiedAt: Date | null } | undefined;

  if (salon.ownerClerkUserId) {
    const byClerk = await tx
      .select({ email: adminUserSchema.email, emailVerifiedAt: adminUserSchema.emailVerifiedAt })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.clerkUserId, salon.ownerClerkUserId))
      .limit(1);
    owner = byClerk[0];
  }

  if (!owner) {
    const byMembership = await tx
      .select({ email: adminUserSchema.email, emailVerifiedAt: adminUserSchema.emailVerifiedAt })
      .from(adminUserSchema)
      .innerJoin(adminSalonMembershipSchema, eq(adminSalonMembershipSchema.adminId, adminUserSchema.id))
      .where(and(
        eq(adminSalonMembershipSchema.salonId, salon.id),
        eq(adminSalonMembershipSchema.role, 'owner'),
      ))
      .orderBy(asc(adminUserSchema.createdAt), asc(adminUserSchema.id))
      .limit(1);
    owner = byMembership[0];
  }

  if (!owner || owner.emailVerifiedAt === null || !owner.email) {
    return null;
  }
  return owner.email;
}

async function loadSalonBySlug(
  tx: BillingDbTransaction,
  salonSlug: string,
): Promise<SalonIdentityRow> {
  const rows = await tx
    .select({
      id: salonSchema.id,
      slug: salonSchema.slug,
      ownerClerkUserId: salonSchema.ownerClerkUserId,
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
    ownerVerifiedEmail: await loadOwnerVerifiedEmail(tx, salon),
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

  // Y9: the SAME verified-email signal `applyStarterGrantBackfill` uses.
  // Fingerprinting the unverified `salon.owner_email` here would let `plan`
  // report an identity (and therefore an `alreadyGranted`) belonging to a
  // DIFFERENT salon that merely shares the address, and then disagree with
  // the identity `apply` actually resolves.
  if (salon.ownerVerifiedEmail) {
    const fingerprint = computeEmailFingerprint(salon.ownerVerifiedEmail);
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
    // Y9: `verifiedEmail` is the owner's VERIFIED `admin_user.email` or null
    // — never `salon.owner_email`. See `SalonIdentityRow` above for why an
    // unverified address must never become a durable `email_hmac` link.
    const identity = await resolveOrCreateBusinessIdentity(tx, {
      clerkUserId: salon.ownerClerkUserId,
      salonId: salon.id,
      stripeCustomerId: salon.stripeCustomerId,
      verifiedEmail: salon.ownerVerifiedEmail,
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
