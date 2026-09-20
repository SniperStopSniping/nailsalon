import type { CustomerMenu } from './catalogue.server';

/**
 * Lossless prompt-only encoding of repeated binding keys. The resolver and
 * signed conversation always keep the canonical menu/selection shapes.
 */
export function projectCustomerInterpreterMenu(menu: CustomerMenu) {
  return {
    ...menu,
    bindings: {
      columns: ['serviceId', 'addOnId', 'required', 'defaultQuantity', 'maxQuantity'] as const,
      rows: menu.bindings.map(binding => [
        binding.serviceId,
        binding.addOnId,
        binding.required,
        binding.defaultQuantity,
        binding.maxQuantity,
      ] as const),
    },
  };
}
