import 'server-only';

/**
 * Owner preview context primitive (Luster UI/UX plan rev 3, PR 3).
 *
 * This is the ONE place that decides whether the current request is allowed
 * to see a salon's unpublished state — a draft salon (pre-publish) or the
 * `bookingPage.draft` side of an otherwise-published salon's config. Plan
 * engineering risk 5: "the owner-preview bypass touches the public 404 gate,
 * a mistake publishes drafts to the world" — hence one primitive, one tested
 * authorization matrix, reused everywhere a preview bypass is needed (PR 5,
 * PR 11), rather than ad-hoc checks growing independently per call site.
 *
 * FAIL-CLOSED CONTRACT (do not weaken without updating ownerPreview.test.ts):
 *   - No admin session                                -> not previewing.
 *   - Admin session exists but belongs to a different
 *     salon's owner, with no active impersonation      -> not previewing.
 *   - Admin session is expired or has been revoked
 *     (deleted server-side)                             -> not previewing,
 *     indistinguishable from "no session" by construction (getAdminSession
 *     only returns a session that is present AND unexpired).
 *   - A super admin without an active, salon-matching
 *     impersonation session                             -> not previewing.
 *     Bare `admin.isSuperAdmin` is intentionally NOT sufficient here, unlike
 *     requireAdmin()'s API-route behaviour — see the module-level decision
 *     note below.
 *   - Any thrown error anywhere in resolution            -> not previewing.
 *     The default is always "not previewing"; every success path must
 *     explicitly earn `isPreviewing: true` by passing a real check. Nothing
 *     in this module may let an exception be interpreted as an allow.
 *
 * DECISION RECORDED (conservative call, not silently guessed):
 * `src/libs/adminAuth.ts`'s `requireAdmin(salonId)` treats *any* super admin
 * (impersonating or not) as authorized for *every* salon, because that guard
 * protects the owner-dashboard API surface a super admin is expected to
 * operate broadly. A public preview bypass is a different, more sensitive
 * surface — the PR3 spec's authorization matrix names only "an authorized
 * impersonating* super admin" as a passing actor, and the plan's whole
 * rationale for this primitive is to avoid ad-hoc drift on the 404 gate. So
 * this module deliberately does NOT reuse requireAdmin's bare-super-admin
 * shortcut: a super admin must have started impersonation for this specific
 * salon (via the existing `sa_impersonate` signed cookie, validated by
 * `getAdminImpersonationForAdmin`) before a draft page or draft config
 * becomes visible to them. This is stricter than requireAdmin, intentionally.
 */
import { getAdminImpersonationForAdmin, getAdminSession } from '@/libs/adminAuth';

export type OwnerPreviewActorType = 'owner' | 'super_admin' | null;

/**
 * Machine-readable reason the resolution landed where it did. Not
 * user-facing copy — purely for logs/tests/debugging a security-sensitive
 * path without having to re-derive "why" from booleans alone.
 */
export type OwnerPreviewReason =
  | 'no_salon_id'
  | 'no_session'
  | 'owner_match'
  | 'wrong_owner'
  | 'impersonation_match'
  | 'impersonation_wrong_salon'
  | 'super_admin_not_impersonating'
  | 'error';

export type OwnerPreviewContext = {
  /** True only when every fail-closed check has explicitly passed. */
  isPreviewing: boolean;
  /** Which kind of authorized actor this is, or null when not previewing. */
  actorType: OwnerPreviewActorType;
  reason: OwnerPreviewReason;
};

const DENY_NO_SESSION: OwnerPreviewContext = {
  isPreviewing: false,
  actorType: null,
  reason: 'no_session',
};

function deny(reason: OwnerPreviewReason): OwnerPreviewContext {
  return { isPreviewing: false, actorType: null, reason };
}

/**
 * Resolve whether the current request (owner session, or an authorized
 * impersonating super admin, taken from cookies exactly like
 * `requireAdmin`/`requireAdminSalon` do) may preview unpublished state for
 * `salonId`.
 *
 * Signature mirrors `requireAdmin(salonId: string)` in `adminAuth.ts` — the
 * existing admin-auth pattern this codebase already uses for "is this
 * session authorized for this specific salon" checks — rather than
 * inventing a new shape.
 */
export async function resolveOwnerPreviewContext(
  salonId: string,
): Promise<OwnerPreviewContext> {
  if (!salonId) {
    return deny('no_salon_id');
  }

  try {
    const admin = await getAdminSession();

    // Covers anonymous visitors (no cookie at all) AND an expired or
    // revoked session cookie: getAdminSession() only returns a session row
    // that both exists and has not passed its expiresAt, so all three
    // collapse to the same safe "no admin" outcome here.
    if (!admin) {
      return DENY_NO_SESSION;
    }

    const isOwnerOfThisSalon = admin.salons.some(
      membership => membership.salonId === salonId,
    );
    if (isOwnerOfThisSalon) {
      return { isPreviewing: true, actorType: 'owner', reason: 'owner_match' };
    }

    if (!admin.isSuperAdmin) {
      // Authenticated, but neither a member of this salon nor a super
      // admin — e.g. the owner of a *different* salon. Fail closed.
      return deny('wrong_owner');
    }

    // Super admin: only an active impersonation session locked to this
    // exact salon authorizes the preview (see the module-level decision
    // note above). getAdminImpersonationForAdmin re-validates the signed
    // cookie against this admin id and confirms the impersonated salon
    // still exists, so a stale or forged cookie value resolves to null.
    const impersonation = await getAdminImpersonationForAdmin(admin);
    if (!impersonation) {
      return deny('super_admin_not_impersonating');
    }
    if (impersonation.salonId !== salonId) {
      return deny('impersonation_wrong_salon');
    }

    return {
      isPreviewing: true,
      actorType: 'super_admin',
      reason: 'impersonation_match',
    };
  } catch (error) {
    // An error here must never be interpretable as an allow. Log for
    // visibility (this guards a public 404 gate) and fail closed.
    console.error('Error resolving owner preview context:', error);
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(error, { tags: { scope: 'resolveOwnerPreviewContext' } });
    } catch {
      // Telemetry failing must never change the fail-closed outcome.
    }
    return deny('error');
  }
}

// =============================================================================
// Draft-salon 404 gate + draft-config selection
// =============================================================================

/**
 * The minimal salon shape this module needs — deliberately narrow (not the
 * full `Salon` row) so callers (and tests) don't have to construct or seed
 * every column just to exercise the gate.
 */
export type OwnerPreviewSalonInput = {
  id: string;
  publicationStatus: string;
  freeSoloEnabled: boolean;
};

export type DraftSalonGateResult =
  | { allowed: false; reason: OwnerPreviewReason }
  | {
    allowed: true;
    /** True when this salon itself is unpublished (pre-publish draft). */
    isPreviewingDraftSalon: boolean;
    /**
     * True when the `bookingPage.draft` side (not `.live`) should be
     * resolved for rendering — always true when `isPreviewingDraftSalon`
     * is true, and also true on an otherwise-published salon when an
     * authorized actor is previewing config changes.
     */
    isPreviewingDraftConfig: boolean;
    actorType: OwnerPreviewActorType;
  };

/**
 * The single call site `[locale]/[slug]/layout.tsx` uses to decide both:
 *   1. Whether an unpublished salon 404s (matches today's gate exactly for
 *      anonymous/unauthorized visitors) or renders for its owner / an
 *      authorized impersonating super admin.
 *   2. Which side of the PR2 `bookingPage` draft/live pair should be
 *      resolved for rendering — draft only for the same two actor types,
 *      live for everyone else, on an already-published salon.
 *
 * Both decisions are driven by the exact same `resolveOwnerPreviewContext`
 * call so there is only one authorization matrix to reason about, per the
 * plan's stated rationale for this primitive.
 *
 * Today's draft-salon condition — `freeSoloEnabled && publicationStatus !==
 * 'published'` — is copied verbatim from the existing gate in
 * `src/app/[locale]/[slug]/layout.tsx` (non-free-solo salons default to
 * `publicationStatus: 'published'` and have never been gated), so this
 * function changes nothing about *which* salons are considered draft, only
 * who may see one.
 */
export async function resolveDraftSalonAccess(
  salon: OwnerPreviewSalonInput,
): Promise<DraftSalonGateResult> {
  const isDraftSalon = salon.freeSoloEnabled && salon.publicationStatus !== 'published';

  const preview = await resolveOwnerPreviewContext(salon.id);

  if (isDraftSalon) {
    if (!preview.isPreviewing) {
      return { allowed: false, reason: preview.reason };
    }

    return {
      allowed: true,
      isPreviewingDraftSalon: true,
      isPreviewingDraftConfig: true,
      actorType: preview.actorType,
    };
  }

  // Already published (or never gated): anonymous and unauthorized visitors
  // still see the live page — only the bookingPage side changes for an
  // authorized previewer, never whether the page renders at all.
  return {
    allowed: true,
    isPreviewingDraftSalon: false,
    isPreviewingDraftConfig: preview.isPreviewing,
    actorType: preview.actorType,
  };
}
