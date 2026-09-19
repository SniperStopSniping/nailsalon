import type { CustomerMenu } from './catalogue.server';
import type { CustomerSelection } from './contracts';

export function validateCustomerMenuDraft(menu: CustomerMenu, selection: CustomerSelection): void {
  if (!menu.services.some(service => service.id === selection.baseServiceId)) {
    throw new Error('CUSTOMER_SELECTION_CHANGED');
  }
  const ids = new Set<string>();
  for (const choice of selection.selectedAddOns) {
    const addOn = menu.addOns.find(item => item.id === choice.addOnId);
    const binding = menu.bindings.find(item => item.serviceId === selection.baseServiceId && item.addOnId === choice.addOnId);
    if (!addOn || (!binding && !menu.l1) || ids.has(choice.addOnId)
      || !Number.isInteger(choice.quantity) || choice.quantity < 1
      || choice.quantity > (binding?.maxQuantity ?? addOn.maxQuantity) || (addOn.pricingType !== 'per_unit' && choice.quantity !== 1)) {
      throw new Error('CUSTOMER_SELECTION_CHANGED');
    }
    ids.add(choice.addOnId);
  }
}

export function validateCustomerMenuSelection(menu: CustomerMenu, selection: CustomerSelection): void {
  validateCustomerMenuDraft(menu, selection);
  const ids = new Set(selection.selectedAddOns.map(item => item.addOnId));
  // Match the service page's required-option defaults, but never silently add
  // or clamp a model choice. Ask again if the proposed set is incomplete.
  if (!menu.l1 && menu.bindings.some(binding => binding.serviceId === selection.baseServiceId && binding.required && !ids.has(binding.addOnId))) {
    throw new Error('CUSTOMER_SELECTION_CHANGED');
  }
}
