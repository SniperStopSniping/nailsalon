import type { CustomerMenu } from '../catalogue.server';
import type { CustomerPublicFacts } from '../publicFacts.server';

const opaqueId = (kind: 'service' | 'addon', index: number) => `${kind}_${String(index).padStart(2, '0')}_7d0b1d72-81a0-4b2f-9ce0-f2e497a0f1c9_catalogue_identity`;
const publicDescription = (kind: string, index: number, size: number) => `${kind} ${index}: ${'A public, customer-facing nail service description with practical finish and upkeep context. 💅 '.repeat(size)}`;

const services = Array.from({ length: 11 }, (_, index) => ({
  id: opaqueId('service', index),
  name: index === 10 ? 'Gel-X Extensions' : `Synthetic service ${index + 1}`,
  description: publicDescription('Service', index + 1, 4),
  category: index === 10 ? 'gel_x' : index % 2 === 0 ? 'extensions' : 'manicure',
}));

const addOns = Array.from({ length: 13 }, (_, index) => ({
  id: opaqueId('addon', index),
  name: index === 11 ? 'French Tips' : index === 12 ? 'Medium Length' : `Synthetic add-on ${index + 1}`,
  description: publicDescription('Add-on', index + 1, 3),
  category: index === 11 ? 'nail_art' : 'length',
  pricingType: index % 2 === 0 ? 'fixed' : 'per_unit',
  maxQuantity: index % 2 === 0 ? 1 : 10,
}));

const bindings = [
  { serviceId: services[10]!.id, addOnId: addOns[11]!.id, required: false, defaultQuantity: 1, maxQuantity: 1 },
  { serviceId: services[10]!.id, addOnId: addOns[12]!.id, required: false, defaultQuantity: 1, maxQuantity: 1 },
  ...Array.from({ length: 50 }, (_, index) => ({
    serviceId: services[index % services.length]!.id,
    addOnId: addOns[(index * 5 + 1) % addOns.length]!.id,
    required: index % 7 === 0,
    defaultQuantity: index % 4 === 0 ? 2 : 1,
    maxQuantity: index % 3 === 0 ? 3 : 1,
  })),
];

export const REALISTIC_OPAQUE_MENU: CustomerMenu = { services, addOns, bindings };

export const REALISTIC_OPAQUE_PUBLIC_FACTS: CustomerPublicFacts = {
  salon: {
    name: 'Synthetic Public Nail Studio',
    description: publicDescription('Salon', 1, 7),
    hours: { weekly: Array.from({ length: 7 }, (_, index) => ({ day: `Synthetic day ${index + 1}`, value: '9:00 AM–6:00 PM' })) },
    policies: Array.from({ length: 3 }, (_, index) => ({ label: `Synthetic policy ${index + 1}`, text: publicDescription('Policy', index + 1, 3) })),
  },
  catalogue: {
    currency: 'CAD',
    services: services.map((service, index) => ({
      ...service,
      description: service.description.slice(0, 120),
      durationMinutes: 45 + index * 5,
      price: { baseCents: 4500 + index * 500, baseDisplay: `$${45 + index * 5}.00`, displayLabel: null, range: null },
    })),
    addOns: addOns.map((addOn, index) => ({
      ...addOn,
      description: addOn.description.slice(0, 90),
      durationMinutes: 5 + index,
      price: { baseCents: 500 + index * 100, baseDisplay: `$${5 + index}.00`, displayLabel: null, range: null },
    })),
  },
};

export const REALISTIC_OPAQUE_SELECTION = {
  baseServiceId: services[10]!.id,
  selectedAddOns: [{ addOnId: addOns[11]!.id, quantity: 1 }, { addOnId: addOns[12]!.id, quantity: 1 }],
};
