import type { CustomerMenu } from './catalogue.server';

/**
 * Lossless prompt-only encoding of repeated binding keys and opaque IDs. The resolver and
 * signed conversation always keep the canonical menu/selection shapes.
 */
export function projectCustomerInterpreterMenu(menu: CustomerMenu) {
  const serviceIds = [...new Set(menu.bindings.map(binding => binding.serviceId))];
  const addOnIds = [...new Set(menu.bindings.map(binding => binding.addOnId))];
  const serviceIndices = new Map(serviceIds.map((id, index) => [id, index]));
  const addOnIndices = new Map(addOnIds.map((id, index) => [id, index]));
  return {
    ...menu,
    bindings: {
      serviceIds,
      addOnIds,
      columns: ['serviceIndex', 'addOnIndex', 'required', 'defaultQuantity', 'maxQuantity', 'priceMode'] as const,
      rows: menu.bindings.map(binding => [
        serviceIndices.get(binding.serviceId)!,
        addOnIndices.get(binding.addOnId)!,
        binding.required,
        binding.defaultQuantity,
        binding.maxQuantity,
        binding.priceMode ?? 'catalog_priced',
      ] as const),
    },
  };
}
