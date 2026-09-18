import type { PublicCatalogSnapshot } from '@/libs/catalogDomain';
import { canonicalizeCatalogPayload } from '@/libs/catalogFingerprint';

/**
 * Narrows the authoritative L1 snapshot to the menu a customer can actually
 * reach. Server authorization still uses the original snapshot; the public
 * presentation must preserve selection semantics without exposing excluded
 * catalog material or advertising orphaned options.
 */
export function projectPublicBookingCatalog(
  snapshot: PublicCatalogSnapshot,
  bookable: Set<string> | null,
): PublicCatalogSnapshot {
  const services = snapshot.services.filter(service => service.effectiveConfirmationMode !== 'consultation' && (bookable === null || bookable.has(service.id)));
  const serviceIds = new Set(services.map(service => service.id));
  const addOnsById = new Map(snapshot.addOns.map(addOn => [addOn.id, addOn]));
  const reachableByService = new Map<string, Set<string>>();

  for (const serviceId of serviceIds) {
    reachableByService.set(serviceId, new Set(snapshot.serviceAddOnBindings
      .filter(binding => binding.serviceId === serviceId && addOnsById.has(binding.addOnId))
      .map(binding => binding.addOnId)));
  }

  // Auto-add rules may chain. Evaluate their reachability for each concrete
  // bookable service, respecting a service-scoped projection on every hop.
  let changed = true;
  while (changed) {
    changed = false;
    for (const serviceId of serviceIds) {
      const reachable = reachableByService.get(serviceId)!;
      for (const projection of snapshot.ruleProjections) {
        if (projection.effect !== 'auto_add' || !projection.targetAddOnId
          || !addOnsById.has(projection.targetAddOnId)
          || (projection.serviceScopeId !== null && projection.serviceScopeId !== serviceId)) {
          continue;
        }
        const triggered = projection.trigger.subjectKind === 'service'
          ? projection.trigger.subjectId === serviceId
          : reachable.has(projection.trigger.subjectId);
        if (triggered && !reachable.has(projection.targetAddOnId)) {
          reachable.add(projection.targetAddOnId);
          changed = true;
        }
      }
    }
  }

  const reachableAddOnIds = new Set([...reachableByService.values()].flatMap(ids => [...ids]));
  const addOns = snapshot.addOns.filter(addOn => reachableAddOnIds.has(addOn.id));
  const serviceAddOnBindings = snapshot.serviceAddOnBindings.filter(binding => (
    serviceIds.has(binding.serviceId) && reachableAddOnIds.has(binding.addOnId)
  ));
  const addOnGroupIds = new Set(addOns.flatMap(addOn => addOn.groupId === null ? [] : [addOn.groupId]));
  const ruleProjections = snapshot.ruleProjections.filter((projection) => {
    if (projection.serviceScopeId !== null && !serviceIds.has(projection.serviceScopeId)) {
      return false;
    }
    if (projection.trigger.subjectKind === 'service' && !serviceIds.has(projection.trigger.subjectId)) {
      return false;
    }
    if (projection.trigger.subjectKind === 'addOn' && !reachableAddOnIds.has(projection.trigger.subjectId)) {
      return false;
    }
    // Retain public constraints even when their target is not selectable.
    // Removing an unsatisfiable required dependency would change validity.
    return true;
  });

  const projected = {
    generatedAt: snapshot.generatedAt,
    currency: snapshot.currency,
    services,
    addOnGroups: snapshot.addOnGroups.filter(group => addOnGroupIds.has(group.id)),
    addOns,
    serviceAddOnBindings,
    ruleProjections,
  };
  return { ...projected, revision: { canonical: canonicalizeCatalogPayload(projected) } };
}
