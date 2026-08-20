import type { AddOnGroup } from '@/models/Schema';
import type { AddOnGroupResponse } from '@/types/admin';

/**
 * Shared admin add-on-group serializer, mirroring `addOnPayload.ts` /
 * `servicePayload.ts`. `memberAddOnIds` is passed in rather than queried
 * here so a list endpoint can load every `add_on.group_id` for the salon
 * once instead of per group.
 */
export function buildAddOnGroupPayload(
  group: AddOnGroup,
  memberAddOnIds: string[] = [],
): AddOnGroupResponse {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    description: group.description ?? null,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections ?? null,
    sortOrder: group.sortOrder,
    isActive: group.isActive,
    templateKey: group.templateKey ?? null,
    memberAddOnIds,
  };
}

/** groupId → addOnIds, from a salon's full add-on set. */
export function groupMemberAddOnIds(
  addOns: Array<{ id: string; groupId: string | null }>,
): Map<string, string[]> {
  const byGroup = new Map<string, string[]>();
  for (const addOn of addOns) {
    if (!addOn.groupId) {
      continue;
    }
    const existing = byGroup.get(addOn.groupId);
    if (existing) {
      existing.push(addOn.id);
    } else {
      byGroup.set(addOn.groupId, [addOn.id]);
    }
  }
  return byGroup;
}
