import 'server-only';

import { and, eq } from 'drizzle-orm';

import type {
  CatalogEligibilityInput,
  CatalogResolutionResult,
  CatalogRuleCoreInput,
  CatalogSelectionInput,
  CatalogSnapshotResult,
  PublicCatalogSnapshot,
  ResolvedCatalogSelection,
} from '@/libs/catalogDomain';
import {
  buildPublicCatalogSnapshot,
  finalizeCatalogResolutionFingerprint,
  resolveCatalogSelection,
} from '@/libs/catalogResolverCore';
import { resolveOwnerPreviewContext } from '@/libs/ownerPreview';
import type { CatalogRule } from '@/models/Schema';
import { addOnGroupSchema, catalogRuleSchema, technicianCapabilitySchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

/**
 * Luster L1 PR3 — the server wrapper around the DB-free resolver core.
 *
 * This module owns everything `catalogDomain.ts` / `catalogResolverCore.ts`
 * / `catalogRuleGraph.ts` / `confirmationMode.ts` / `catalogFingerprint.ts`
 * deliberately do NOT: DB loading, tenant scoping, source-of-truth
 * (draft/live) authorization, and private capability enrichment narrowed to
 * the core's public-safe `{ technicianEligible }` signal. Nothing exported
 * here is imported by any booking path, owner surface, or API route in this
 * PR — see the PR3 report for the importer search that proves it.
 *
 * `import 'server-only'` matches every other `*.server.ts` split in this
 * codebase (`depositPolicy.server.ts`, `catalogFingerprint.server.ts`,
 * `ownerPreview.ts`, ...): this file may read the database and must never be
 * reachable from a client bundle.
 */

// =============================================================================
// SOURCE SELECTION — the security-critical part
// =============================================================================

/**
 * The catalog has NO draft/live staging today — unlike `bookingPage`
 * config/content (PR2), services/add-ons/groups/rules write straight to
 * their live rows. `'draft'` is named here so a later PR that DOES add
 * catalog staging only has to teach `authorizeCatalogSource` a second real
 * branch — the signature and every call site stay the same. Until that
 * lands, requesting `'draft'` always throws (see `authorizeCatalogSource`);
 * it never silently substitutes live data under a draft label, which would
 * mislead an owner into believing unpublished menu edits are being
 * previewed when nothing of the kind is possible yet.
 */
export const CATALOG_SOURCE_SELECTIONS = ['live', 'draft'] as const;
export type CatalogSourceSelection = typeof CATALOG_SOURCE_SELECTIONS[number];

/**
 * Thrown when `'draft'` is requested by a caller `resolveOwnerPreviewContext`
 * does not authorize for this salon. Fail-closed: draft data (once it
 * exists) must never reach an unauthenticated or cross-tenant caller.
 */
export class CatalogSourceAuthorizationError extends Error {
  constructor(salonId: string) {
    super(`Not authorized to preview the draft catalog source for salon ${salonId}.`);
    this.name = 'CatalogSourceAuthorizationError';
  }
}

/**
 * Thrown when an AUTHORIZED caller requests `'draft'` anyway. The catalog
 * has nothing to stage yet — see the module doc comment — so this is a
 * loud, explicit "not built yet", never a silent fallback to live data.
 */
export class CatalogSourceUnimplementedError extends Error {
  constructor() {
    super(
      'The catalog has no draft/live staging yet — services and add-ons write '
      + 'straight to live rows. Only bookingPage config/content (PR2) is staged. '
      + 'Requesting the draft catalog source is not yet implemented.',
    );
    this.name = 'CatalogSourceUnimplementedError';
  }
}

/**
 * The ONE authorization matrix for catalog source selection, reusing
 * `resolveOwnerPreviewContext` (`ownerPreview.ts`) rather than inventing a
 * second one. Every path either returns `'live'` or throws — there is no
 * third outcome, so a caller can never accidentally receive an
 * unauthorized or half-authorized result.
 *
 *   - `requestedSource: 'live'` -> always `'live'`, no authorization check
 *     at all. This is intentional: the live catalog is the same data every
 *     public booking surface already renders today: requiring a check here
 *     would be a NEW gate PR3 has no mandate to add, and `resolveCatalogSource`
 *     already exists purely for the draft branch.
 *   - `requestedSource: 'draft'`, caller not authorized for this salon ->
 *     `CatalogSourceAuthorizationError`.
 *   - `requestedSource: 'draft'`, caller IS authorized -> still throws
 *     `CatalogSourceUnimplementedError`, because there is no draft catalog
 *     to select yet.
 */
export async function authorizeCatalogSource(
  salonId: string,
  requestedSource: CatalogSourceSelection,
): Promise<'live'> {
  if (requestedSource === 'live') {
    return 'live';
  }

  const preview = await resolveOwnerPreviewContext(salonId);
  if (!preview.isPreviewing) {
    throw new CatalogSourceAuthorizationError(salonId);
  }

  throw new CatalogSourceUnimplementedError();
}

// =============================================================================
// SNAPSHOT ASSEMBLY — DB loading + tenant scoping + projection
// =============================================================================

/**
 * The one place a raw `catalog_rule` row is narrowed to
 * `CatalogRuleCoreInput`. `capabilityId` is read here and IMMEDIATELY
 * collapsed to the boolean `hasCapabilityRequirement` — nothing downstream
 * of this function ever sees the raw id (see the CAPABILITY PRIVACY note in
 * `catalogDomain.ts`).
 */
function toCatalogRuleCoreInput(rule: CatalogRule): CatalogRuleCoreInput {
  return {
    id: rule.id,
    ruleType: rule.ruleType,
    serviceScopeId: rule.serviceId,
    subjectServiceId: rule.subjectServiceId,
    subjectAddOnId: rule.subjectAddOnId,
    objectAddOnId: rule.objectAddOnId,
    hasCapabilityRequirement: rule.ruleType === 'requires_capability' && rule.capabilityId !== null,
    params: rule.params,
    priority: rule.priority,
    isActive: rule.isActive,
  };
}

export type ResolvePublicCatalogSnapshotArgs = {
  salonId: string;
  /**
   * Required, not defaulted: every call site must say explicitly which
   * source it wants rather than inherit an implicit default. See
   * `authorizeCatalogSource` for what each value means and how it is
   * authorized.
   */
  requestedSource: CatalogSourceSelection;
  now?: Date;
};

/**
 * Loads a salon's services/add-on groups/add-ons/bindings/rules and hands
 * them to the frozen, DB-free `buildPublicCatalogSnapshot`. This function is
 * the ONLY place in PR3 that reads `add_on_group` or `catalog_rule` rows —
 * both tables are otherwise unread anywhere in the codebase (confirmed by
 * search; see the PR3 report), so this is genuinely the first reader, not a
 * second one drifting from an existing query.
 *
 * `services`/`addOns` are loaded WITHOUT an `isActive` filter — the core
 * needs the inactive rows too, to tell "a rule references a real but
 * disabled object" (`inactive_referenced_object`) apart from "a rule
 * references nothing at all" (`missing_referenced_object`); it does its own
 * active-filtering when building the public arrays.
 *
 * Does not itself validate that `salonId` refers to a real, active salon —
 * callers that need a 404/authorization decision make it before calling
 * this (e.g. via `resolveDraftSalonAccess`); an unknown `salonId` here
 * simply resolves to an empty, valid snapshot rather than a special error,
 * since every query is scoped by `salonId` and an unmatched id returns no
 * rows.
 */
export async function resolvePublicCatalogSnapshot(
  args: ResolvePublicCatalogSnapshotArgs,
): Promise<CatalogSnapshotResult> {
  await authorizeCatalogSource(args.salonId, args.requestedSource);

  const { db } = await import('@/libs/DB');
  const {
    getAllAddOnsBySalonId,
    getAllServicesBySalonId,
    getSalonById,
    getServiceAddOnRulesBySalonId,
  } = await import('@/libs/queries');

  const [salon, services, addOns, serviceAddOnBindings, addOnGroups, rules] = await Promise.all([
    getSalonById(args.salonId),
    getAllServicesBySalonId(args.salonId),
    getAllAddOnsBySalonId(args.salonId),
    getServiceAddOnRulesBySalonId(args.salonId),
    db.select().from(addOnGroupSchema).where(eq(addOnGroupSchema.salonId, args.salonId)),
    // Ordered defensively, matching the ratified `(priority, id)` evaluation
    // order — but this is belt-and-suspenders, not the load-bearing fix:
    // `buildPublicCatalogSnapshot` (`catalogResolverCore.ts`) sorts `rules`
    // itself before doing anything else with them, precisely because a bare
    // `db.select()` carries no ORDER BY guarantee from Postgres (row order
    // is unspecified and can shift with plan changes on an unchanged
    // catalog), and the core must be correct regardless of what order its
    // caller hands it rules in.
    db.select().from(catalogRuleSchema).where(eq(catalogRuleSchema.salonId, args.salonId))
      .orderBy(catalogRuleSchema.priority, catalogRuleSchema.id),
  ]);

  return buildPublicCatalogSnapshot({
    salonSettings: (salon?.settings as SalonSettings | null | undefined) ?? null,
    services,
    addOnGroups,
    addOns,
    serviceAddOnBindings,
    rules: rules.map(toCatalogRuleCoreInput),
    now: args.now,
  });
}

// =============================================================================
// SELECTION RESOLUTION — private capability enrichment, narrowed
// =============================================================================

type DeriveCatalogEligibilityArgs = {
  salonId: string;
  serviceId: string;
  technicianId: string | null;
  /**
   * Every add-on id actually in play for this selection — the client's own
   * picks UNION whatever `include`-with-`autoAdd` added on top. Capability
   * requirements can attach to an auto-added add-on the client never typed,
   * so this must be the POST-expansion set, not the raw request.
   */
  finalAddOnIds: string[];
};

/**
 * Reads `catalog_rule` (`requires_capability` rows only) and
 * `technician_capability`, and narrows both down to the single boolean the
 * core's `CatalogEligibilityInput` accepts. This is the ONLY function in
 * PR3 that reads `technician_capability`, and the only one that reads a
 * `catalog_rule.capability_id` value for a purpose other than the
 * boolean-collapse in `toCatalogRuleCoreInput` above. Neither the
 * capability id nor the rule id is ever returned.
 */
async function deriveCatalogEligibility(
  args: DeriveCatalogEligibilityArgs,
): Promise<CatalogEligibilityInput> {
  const { db } = await import('@/libs/DB');

  const capabilityRules = await db
    .select()
    .from(catalogRuleSchema)
    .where(
      and(
        eq(catalogRuleSchema.salonId, args.salonId),
        eq(catalogRuleSchema.ruleType, 'requires_capability'),
        eq(catalogRuleSchema.isActive, true),
      ),
    );

  const finalAddOnIdSet = new Set(args.finalAddOnIds);
  const inScope = capabilityRules.filter((rule) => {
    // Mirrors the core's own scope test: `serviceScopeId === null` is
    // salon-wide, otherwise it must match the service being resolved.
    const scopeMatches = rule.serviceId === null || rule.serviceId === args.serviceId;
    if (!scopeMatches) {
      return false;
    }
    if (rule.subjectServiceId) {
      return rule.subjectServiceId === args.serviceId;
    }
    if (rule.subjectAddOnId) {
      return finalAddOnIdSet.has(rule.subjectAddOnId);
    }
    return false;
  });

  if (inScope.length === 0) {
    // Nothing in this selection carries a capability requirement — "no
    // opinion", exactly like the core's own `undefined` contract.
    return {};
  }

  if (!args.technicianId) {
    // A capability is required somewhere in this selection but no
    // technician has been chosen yet to evaluate it against. Fail closed
    // rather than assume eligibility.
    return { technicianEligible: false };
  }

  const requiredCapabilityIds = new Set(
    inScope
      .map(rule => rule.capabilityId)
      .filter((id): id is string => id !== null),
  );

  const held = await db
    .select({ capabilityId: technicianCapabilitySchema.capabilityId })
    .from(technicianCapabilitySchema)
    .where(
      and(
        eq(technicianCapabilitySchema.salonId, args.salonId),
        eq(technicianCapabilitySchema.technicianId, args.technicianId),
      ),
    );
  const heldCapabilityIds = new Set(held.map(row => row.capabilityId));

  const technicianEligible = [...requiredCapabilityIds].every(id => heldCapabilityIds.has(id));
  return { technicianEligible };
}

export type ResolveCatalogSelectionForSalonArgs = {
  salonId: string;
  snapshot: PublicCatalogSnapshot;
  selection: CatalogSelectionInput;
};

/**
 * The wrapper's selection entry point: resolves a client's selection against
 * an already-built public snapshot, informed by private capability data the
 * core structurally cannot see.
 *
 * Runs `resolveCatalogSelection` TWICE rather than re-implementing auto-add
 * closure here:
 *   1. A provisional pass with no eligibility opinion, purely to discover
 *      which add-ons are actually in play once `include`/`autoAdd` has
 *      expanded the client's explicit picks (`provisional.selection.addOns`
 *      already carries that closure — see `catalogResolverCore.ts`).
 *   2. The real pass, using that closure to compute
 *      `eligibility.technicianEligible` and hand it to the core.
 *
 * If the provisional pass itself fails closed (corrupt catalog data), that
 * failure is returned immediately — there is nothing to enrich.
 */
export async function resolveCatalogSelectionForSalon(
  args: ResolveCatalogSelectionForSalonArgs,
): Promise<CatalogResolutionResult> {
  const provisional = resolveCatalogSelection(args.snapshot, args.selection, {});
  if (!provisional.ok) {
    return provisional;
  }

  const eligibility = await deriveCatalogEligibility({
    salonId: args.salonId,
    serviceId: args.selection.serviceId,
    technicianId: args.selection.technicianId ?? null,
    finalAddOnIds: provisional.selection.addOns.map(line => line.addOnId),
  });

  return resolveCatalogSelection(args.snapshot, args.selection, eligibility);
}

// =============================================================================
// SELECTION-LEVEL RESOLUTION FINGERPRINT — server-side convenience
// =============================================================================

/**
 * A thin server-side convenience over the core's own
 * `finalizeCatalogResolutionFingerprint` (`catalogResolverCore.ts`) — the
 * `CatalogResolutionFingerprint` gates the `409 CATALOG_SELECTION_CHANGED`
 * conflict for THIS customer's configuration, as distinct from
 * `CatalogRevision`, which gates a coarser snapshot-level conflict.
 *
 * This function exists purely so a server caller does not need to know
 * which hasher to inject: it always uses `hashCatalogFingerprintNode`
 * (`catalogFingerprint.server.ts`). A browser caller uses the core function
 * directly with `hashCatalogFingerprintWebCrypto` instead — both paths
 * canonicalize and hash identically (same frozen `canonicalizeCatalogPayload`,
 * same SHA-256 rails), which is what makes the two agree byte-for-byte.
 * Not wired into any submission flow in this PR — purely inert.
 */
export async function finalizeCatalogResolutionFingerprintNode(
  snapshot: PublicCatalogSnapshot,
  selection: ResolvedCatalogSelection,
) {
  const { hashCatalogFingerprintNode } = await import('@/libs/catalogFingerprint.server');
  return finalizeCatalogResolutionFingerprint(snapshot, selection, hashCatalogFingerprintNode);
}
