/**
 * Luster L1 PR6 — owner/admin catalog configuration surface.
 *
 * Shared, browser-safe types and pure formatting helpers reused across the
 * "Catalog" tab's panels (`CatalogConfigTab.tsx` and its siblings).
 *
 * Every server-side vocabulary import below is `import type` ONLY. Several
 * of the owner-catalog libraries this UI mirrors (`ownerCatalogRules.server.ts`,
 * `ownerCatalogFamilies.server.ts`) are `.server.ts` files (or `import
 * 'server-only'` themselves) — a VALUE import would break both the client
 * bundle and `architectureClientServerBoundary.test.ts` (H3). `import type`
 * is erased at compile time and stays exempt, matching the same pattern
 * `SalonProvider.tsx` and `src/types/admin.ts` already use. Runtime
 * vocabulary this file needs (the six owner rule intents, the family-change
 * field set) is therefore duplicated here as plain literals, typed against
 * the imported types so a drift in the server vocabulary fails to compile
 * rather than silently going stale.
 */

import type { CatalogViolation, CatalogViolationAnchor } from '@/libs/catalogDomain';
import type { CatalogRuleType } from '@/libs/catalogRuleContract';
import { formatMoney } from '@/libs/formatMoney';
import type { ServiceFamilyChange, ServiceFamilyWarning } from '@/libs/ownerCatalogFamilies.server';
import type { OwnerRuleIntent } from '@/libs/ownerCatalogRules.server';
import type {
  AddOnResponse,
  ServiceResponse,
} from '@/types/admin';
import { formatDuration } from '@/utils/Helpers';

// Re-exported so panels never need their own import of the underlying
// (partially server-adjacent) module just for a type name.
export type { OwnerRuleIntent };

export type TechnicianOption = {
  id: string;
  name: string;
  isActive: boolean;
};

/**
 * Mirrors `ADD_ON_CATEGORIES` (`Schema.ts`). Duplicated here rather than
 * imported — `Schema.ts` pulls in drizzle-orm's pg-core, which is not meant
 * to reach a client bundle; `ServicesModal.tsx`'s own (private)
 * `ADD_ON_CATEGORY_LABELS` follows the same convention.
 */
export const ADD_ON_CATEGORIES = ['nail_art', 'repair', 'removal', 'pedicure_addon'] as const;
export type AddOnCategoryOption = typeof ADD_ON_CATEGORIES[number];

export const ADD_ON_CATEGORY_LABELS: Record<string, string> = {
  nail_art: 'Nail art',
  repair: 'Repair',
  removal: 'Removal',
  pedicure_addon: 'Pedicure add-on',
};

// =============================================================================
// FORMATTING
// =============================================================================

/** Platform currency defaults to CAD, mirroring ServicesModal's own formatCurrency. */
export function formatCurrency(cents: number): string {
  return formatMoney(cents);
}

export { formatDuration };

// =============================================================================
// OWNER RULE INTENT VOCABULARY (mirrors `ownerCatalogRules.server.ts`, UI side)
// =============================================================================

export const OWNER_RULE_INTENTS: OwnerRuleIntent[] = [
  'bundle_add_on',
  'exclude_add_on',
  'require_add_on',
  'prevent_combination',
  'limit_add_on_quantity',
  'require_capability',
];

export const INTENT_LABELS: Record<OwnerRuleIntent, string> = {
  bundle_add_on: 'Bundle an add-on',
  exclude_add_on: 'Hide an add-on',
  require_add_on: 'Require an add-on',
  prevent_combination: 'Block a combination',
  limit_add_on_quantity: 'Limit a quantity',
  require_capability: 'Require a skill',
};

export const INTENT_DESCRIPTIONS: Record<OwnerRuleIntent, string> = {
  bundle_add_on: 'When a service or add-on is selected, include another add-on with it.',
  exclude_add_on: 'When a service or add-on is selected, hide an add-on from clients.',
  require_add_on: 'When a service or add-on is selected, make another add-on required.',
  prevent_combination: 'Stop two add-ons from being booked together.',
  limit_add_on_quantity: 'Cap how many of an add-on a client can select.',
  require_capability: 'Only let technicians with a specific skill perform this.',
};

/** Mirrors `ownerCatalogRules.server.ts`'s (private) INTENT_TO_RULE_TYPE. */
const INTENT_TO_RULE_TYPE: Record<OwnerRuleIntent, CatalogRuleType> = {
  bundle_add_on: 'include',
  exclude_add_on: 'exclude',
  require_add_on: 'requires',
  prevent_combination: 'mutually_exclusive',
  limit_add_on_quantity: 'max_quantity',
  require_capability: 'requires_capability',
};

const RULE_TYPE_TO_INTENT = Object.fromEntries(
  Object.entries(INTENT_TO_RULE_TYPE).map(([intent, ruleType]) => [ruleType, intent]),
) as Record<CatalogRuleType, OwnerRuleIntent>;

export function intentForRuleType(ruleType: CatalogRuleType): OwnerRuleIntent {
  return RULE_TYPE_TO_INTENT[ruleType];
}

/** Absurdity ceiling mirrored from `catalogRuleContract.ts`'s MAX_QUANTITY_CEILING (a value import would trip the client/server boundary guard). */
export const MAX_ADD_ON_QUANTITY = 99;

// =============================================================================
// NAME RESOLUTION — never render a raw id; always resolve to a name first.
// =============================================================================

export function serviceName(services: ServiceResponse[], id: string | null | undefined): string {
  if (!id) {
    return 'a service';
  }
  return services.find(service => service.id === id)?.name ?? 'a removed service';
}

export function addOnName(addOns: AddOnResponse[], id: string | null | undefined): string {
  if (!id) {
    return 'an add-on';
  }
  return addOns.find(addOn => addOn.id === id)?.name ?? 'a removed add-on';
}

export function capabilityName(
  capabilities: Array<{ id: string; name: string }>,
  id: string | null | undefined,
): string {
  if (!id) {
    return 'a skill';
  }
  return capabilities.find(capability => capability.id === id)?.name ?? 'a removed skill';
}

export function technicianName(technicians: TechnicianOption[], id: string | null | undefined): string {
  if (!id) {
    return 'a technician';
  }
  return technicians.find(technician => technician.id === id)?.name ?? 'a former team member';
}

// =============================================================================
// RULE SENTENCES — the sentence-style presentation §28/HC3 requires. Never
// "subject → ruleType → object → params → priority"; always a readable
// sentence naming the resolved subject/object/capability.
// =============================================================================

export type RuleSentenceInput = {
  intent: OwnerRuleIntent;
  subjectLabel: string;
  addOnLabel?: string;
  capabilityLabel?: string;
  maxQuantity?: number;
  autoAdd?: boolean;
};

export function ruleSentence(input: RuleSentenceInput): string {
  switch (input.intent) {
    case 'bundle_add_on':
      return input.autoAdd
        ? `When ${input.subjectLabel} is selected, automatically include ${input.addOnLabel}.`
        : `When ${input.subjectLabel} is selected, offer ${input.addOnLabel} as an included option.`;
    case 'exclude_add_on':
      return `When ${input.subjectLabel} is selected, ${input.addOnLabel} is hidden.`;
    case 'require_add_on':
      return `When ${input.subjectLabel} is selected, ${input.addOnLabel} is required.`;
    case 'prevent_combination':
      return `${input.subjectLabel} cannot be combined with ${input.addOnLabel}.`;
    case 'limit_add_on_quantity':
      return `Limit ${input.addOnLabel} to at most ${input.maxQuantity} when ${input.subjectLabel} is selected.`;
    case 'require_capability':
      return `Only technicians who can do ${input.capabilityLabel} may perform ${input.subjectLabel}.`;
    default:
      return '';
  }
}

// =============================================================================
// SERVICE FAMILY CHANGE / WARNING SENTENCES (C — "group these services")
// =============================================================================

export function describeFamilyChange(change: ServiceFamilyChange, services: ServiceResponse[]): string {
  const subject = serviceName(services, change.serviceId);
  switch (change.field) {
    case 'parentServiceId':
      return change.to
        ? `${subject} becomes a variant of ${serviceName(services, change.to)}.`
        : `${subject} is no longer a variant of ${change.from ? serviceName(services, change.from) : 'its parent'}.`;
    case 'variantLabel':
      return change.to
        ? `${subject}'s variant label will be set to "${change.to}".`
        : `${subject}'s variant label will be cleared.`;
    case 'variantKind':
      return `${subject}'s variants will be organized by "${change.to}".`;
    case 'selectionMode':
      return `${subject}'s variant picker will show as ${change.to === 'guided' ? 'a guided chooser' : 'a direct list'}.`;
    default:
      return `${subject} will change.`;
  }
}

export function describeFamilyWarning(warning: Pick<ServiceFamilyWarning, 'message'>): string {
  return warning.message;
}

// =============================================================================
// CATALOG PREVIEW VIOLATIONS (G — "preview and test")
// =============================================================================

function anchorSubject(
  anchor: CatalogViolationAnchor,
  ctx: { services: ServiceResponse[]; addOns: AddOnResponse[] },
): string {
  switch (anchor.kind) {
    case 'service':
    case 'variant':
    case 'family':
      return serviceName(ctx.services, anchor.serviceId);
    case 'addOn':
    case 'quantity':
      return addOnName(ctx.addOns, anchor.addOnId);
    case 'group':
      return 'This add-on group';
    case 'technician':
      return 'The selected technician';
    case 'summary':
    default:
      return 'This selection';
  }
}

export function describeCatalogViolation(
  violation: CatalogViolation,
  ctx: { services: ServiceResponse[]; addOns: AddOnResponse[] },
): string {
  const subject = anchorSubject(violation.anchor, ctx);
  switch (violation.code) {
    case 'addon_unavailable':
      return `${subject} is not available with this selection.`;
    case 'quantity_exceeded':
      return `${subject} is limited to ${violation.limit} (you selected ${violation.attempted}).`;
    case 'group_selection_below_minimum':
      return `Pick at least ${violation.minimum} from ${subject} (currently ${violation.selected}).`;
    case 'group_selection_above_maximum':
      return `Pick at most ${violation.maximum} from ${subject} (currently ${violation.selected}).`;
    case 'required_dependency_unmet':
      return `${subject} needs another selection that is missing.`;
    case 'mutually_exclusive_conflict':
      return `${subject} conflicts with another selected item.`;
    case 'capability_unavailable':
      return `No available technician can perform ${subject}.`;
    default:
      return `${subject} has an issue with this selection.`;
  }
}

export const CATALOG_PREVIEW_CODE_MESSAGES: Record<string, string> = {
  missing_referenced_object: 'This catalog references something that no longer exists. Review recent changes to services, add-ons, or rules.',
  inactive_referenced_object: 'This catalog references something that is no longer active. Review recent changes to services or add-ons.',
  cyclic_auto_add: 'Two or more bundling rules automatically include each other in a loop. Edit or remove one of them.',
  invalid_group_bounds: 'An add-on group has an invalid selection limit. Open Add-ons & groups to fix it.',
  invalid_rule_params: 'A rule is missing information it needs. Open Rules to review it.',
  unknown_rule_type: 'A rule uses an option this version does not understand.',
  invalid_subject_shape: 'A rule is missing what it applies to.',
  invalid_object_shape: 'A rule is missing what it affects.',
};

export function describeCatalogPreviewFailureCode(code: string): string {
  return CATALOG_PREVIEW_CODE_MESSAGES[code] ?? 'This selection could not be evaluated. Try again.';
}

// =============================================================================
// API ERROR EXTRACTION
// =============================================================================

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    anchor?: unknown;
  };
};

export async function extractApiError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as ApiErrorBody | null;
  return payload?.error?.message ?? fallback;
}
