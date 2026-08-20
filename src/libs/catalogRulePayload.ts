import type { CatalogRuleType } from '@/libs/catalogRuleContract';
import type { CatalogRule } from '@/models/Schema';
import type { CatalogRuleResponse } from '@/types/admin';

/**
 * Shared admin catalog-rule serializer. `catalog_rule` is a brand-new table
 * (migration 0073) whose ONLY writer is `ownerCatalogRules.server.ts` — every
 * row was itself produced by `catalogRuleWriteSchema`, so the cast below
 * carries no legacy-drift risk the way re-validating an old row on read
 * normally would (`catalogRuleContract.ts`'s own doc comment).
 */
export function buildCatalogRuleResponse(rule: CatalogRule): CatalogRuleResponse {
  return {
    id: rule.id,
    ruleType: rule.ruleType as CatalogRuleType,
    serviceScopeId: rule.serviceId,
    subjectServiceId: rule.subjectServiceId,
    subjectAddOnId: rule.subjectAddOnId,
    objectAddOnId: rule.objectAddOnId,
    capabilityId: rule.capabilityId,
    params: rule.params,
    priority: rule.priority,
    isActive: rule.isActive,
    note: rule.note,
  };
}
