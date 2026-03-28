import { eq } from 'drizzle-orm';

import { type BookingConfig, DEFAULT_BOOKING_CONFIG } from '@/libs/bookingConfig';
import { descriptionItemsToLegacyText } from '@/libs/bookingCatalog';
import {
  addOnSchema,
  salonSchema,
  serviceAddOnSchema,
  serviceSchema,
} from '@/models/Schema';

type DefaultServiceTemplate = {
  name: string;
  slug: string;
  category: 'manicure' | 'builder_gel' | 'extensions' | 'pedicure';
  priceCents: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  descriptionItems: string[];
  isIntroPrice?: boolean;
  introPriceLabel?: string | null;
};

type DefaultAddOnTemplate = {
  name: string;
  slug: string;
  category: 'nail_art' | 'repair' | 'removal' | 'pedicure_addon';
  priceCents: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  pricingType: 'fixed' | 'per_unit';
  unitLabel?: string | null;
  maxQuantity?: number | null;
  descriptionItems?: string[];
};

const DEFAULT_SERVICES: DefaultServiceTemplate[] = [
  {
    name: 'Russian Manicure (No Color)',
    slug: 'russian-manicure-no-color',
    category: 'manicure',
    priceCents: 3500,
    durationMinutes: 45,
    descriptionItems: [
      'Dry manicure',
      'Detailed cuticle work',
      'Nail shaping',
      'Natural buff finish',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Gel Manicure',
    slug: 'gel-manicure',
    category: 'manicure',
    priceCents: 4000,
    durationMinutes: 60,
    descriptionItems: [
      'Russian manicure prep',
      'Gel color',
      'Cuticle oil finish',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'BIAB (Builder Gel on Natural Nails)',
    slug: 'biab-natural-nails',
    category: 'builder_gel',
    priceCents: 5000,
    durationMinutes: 75,
    descriptionItems: [
      'Strengthening overlay',
      'Natural nail protection',
      'Clean structured finish',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'BIAB + Gel Color',
    slug: 'biab-gel-color',
    category: 'builder_gel',
    priceCents: 6000,
    durationMinutes: 90,
    descriptionItems: [
      'Strengthening overlay with gel color',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Gel X / Hard Gel Extensions',
    slug: 'gel-x-hard-gel-extensions',
    category: 'extensions',
    priceCents: 7000,
    priceDisplayText: '$70+',
    durationMinutes: 120,
    descriptionItems: [
      'Full set',
      'Natural length',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Classic Pedicure',
    slug: 'classic-pedicure',
    category: 'pedicure',
    priceCents: 4000,
    durationMinutes: 45,
    descriptionItems: [
      'Warm soak with lavender salts',
      'Cuticle care',
      'Light callus removal',
      'Nail shaping',
      'Regular polish',
      'Hydrating cream',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Lavender Spa Pedicure',
    slug: 'lavender-spa-pedicure',
    category: 'pedicure',
    priceCents: 5000,
    durationMinutes: 60,
    descriptionItems: [
      'Lavender soak + bath bomb',
      'Cuticle care',
      'Callus treatment',
      'Exfoliating scrub',
      'Relaxing massage',
      'Regular polish',
      'Cuticle oil finish',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Deluxe Lavender Pedicure',
    slug: 'deluxe-lavender-pedicure',
    category: 'pedicure',
    priceCents: 6000,
    durationMinutes: 75,
    descriptionItems: [
      'Lavender soak + bath bomb',
      'Dried lavender flowers',
      'Lavender essential oil',
      'Full callus removal',
      'Scrub + hydrating mask',
      'Hot towel therapy',
      'Extended relaxing massage',
      'Regular polish',
      'Cuticle oil finish',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
];

const DEFAULT_ADD_ONS: DefaultAddOnTemplate[] = [
  {
    name: 'Simple Nail Art',
    slug: 'simple-nail-art',
    category: 'nail_art',
    priceCents: 1000,
    priceDisplayText: '$10+',
    durationMinutes: 15,
    pricingType: 'fixed',
  },
  {
    name: '3D / Charms',
    slug: '3d-charms',
    category: 'nail_art',
    priceCents: 1500,
    priceDisplayText: '$15+',
    durationMinutes: 20,
    pricingType: 'fixed',
  },
  {
    name: 'Nail Repair',
    slug: 'nail-repair',
    category: 'repair',
    priceCents: 500,
    priceDisplayText: '$5 per nail',
    durationMinutes: 10,
    pricingType: 'per_unit',
    unitLabel: 'per nail',
    maxQuantity: 10,
  },
  {
    name: 'Gel Removal',
    slug: 'gel-removal',
    category: 'removal',
    priceCents: 1000,
    durationMinutes: 15,
    pricingType: 'fixed',
  },
  {
    name: 'Extensions Removal',
    slug: 'extensions-removal',
    category: 'removal',
    priceCents: 1500,
    durationMinutes: 30,
    pricingType: 'fixed',
  },
  {
    name: 'Add Gel Polish',
    slug: 'add-gel-polish',
    category: 'pedicure_addon',
    priceCents: 1500,
    durationMinutes: 15,
    pricingType: 'fixed',
  },
];

const DEFAULT_SERVICE_ADD_ONS: Array<{
  serviceSlug: string;
  addOnSlug: string;
  selectionMode?: 'optional' | 'required' | 'conditional';
  displayOrder: number;
}> = [
  { serviceSlug: 'russian-manicure-no-color', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'russian-manicure-no-color', addOnSlug: 'nail-repair', displayOrder: 2 },
  { serviceSlug: 'russian-manicure-no-color', addOnSlug: 'gel-removal', displayOrder: 3 },
  { serviceSlug: 'gel-manicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'gel-manicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'gel-manicure', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'gel-manicure', addOnSlug: 'gel-removal', displayOrder: 4 },
  { serviceSlug: 'biab-natural-nails', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'biab-natural-nails', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'biab-natural-nails', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'biab-natural-nails', addOnSlug: 'gel-removal', displayOrder: 4 },
  { serviceSlug: 'biab-gel-color', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'biab-gel-color', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'biab-gel-color', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'biab-gel-color', addOnSlug: 'gel-removal', displayOrder: 4 },
  { serviceSlug: 'gel-x-hard-gel-extensions', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'gel-x-hard-gel-extensions', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'gel-x-hard-gel-extensions', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'gel-x-hard-gel-extensions', addOnSlug: 'gel-removal', displayOrder: 4 },
  { serviceSlug: 'gel-x-hard-gel-extensions', addOnSlug: 'extensions-removal', displayOrder: 5 },
  { serviceSlug: 'classic-pedicure', addOnSlug: 'add-gel-polish', displayOrder: 1 },
  { serviceSlug: 'lavender-spa-pedicure', addOnSlug: 'add-gel-polish', displayOrder: 1 },
  { serviceSlug: 'deluxe-lavender-pedicure', addOnSlug: 'add-gel-polish', displayOrder: 1 },
];

export function getDefaultCatalogTemplate() {
  return {
    services: DEFAULT_SERVICES,
    addOns: DEFAULT_ADD_ONS,
    serviceAddOns: DEFAULT_SERVICE_ADD_ONS,
    bookingConfig: DEFAULT_BOOKING_CONFIG satisfies BookingConfig,
  };
}

function buildServiceId(salonId: string, slug: string): string {
  return `svc_${salonId.replace(/[^a-z0-9]/gi, '_')}_${slug}`;
}

function buildAddOnId(salonId: string, slug: string): string {
  return `addon_${salonId.replace(/[^a-z0-9]/gi, '_')}_${slug}`;
}

function buildServiceAddOnId(salonId: string, serviceSlug: string, addOnSlug: string): string {
  return `svcaddon_${salonId.replace(/[^a-z0-9]/gi, '_')}_${serviceSlug}_${addOnSlug}`;
}

export async function seedDefaultCatalogForSalon(args: {
  db: any;
  salonId: string;
  onlyIfEmpty?: boolean;
}) {
  const { db, salonId, onlyIfEmpty = true } = args;

  const [existingServices, existingAddOns] = await Promise.all([
    db.select({ id: serviceSchema.id }).from(serviceSchema).where(eq(serviceSchema.salonId, salonId)).limit(1),
    db.select({ id: addOnSchema.id }).from(addOnSchema).where(eq(addOnSchema.salonId, salonId)).limit(1),
  ]);

  if (onlyIfEmpty && (existingServices.length > 0 || existingAddOns.length > 0)) {
    return { seeded: false };
  }

  const template = getDefaultCatalogTemplate();
  const serviceIdsBySlug = new Map<string, string>();
  const addOnIdsBySlug = new Map<string, string>();

  for (const [index, service] of template.services.entries()) {
    const id = buildServiceId(salonId, service.slug);
    serviceIdsBySlug.set(service.slug, id);
    await db
      .insert(serviceSchema)
      .values({
        id,
        salonId,
        name: service.name,
        slug: service.slug,
        description: descriptionItemsToLegacyText(service.descriptionItems),
        descriptionItems: service.descriptionItems,
        price: service.priceCents,
        priceDisplayText: service.priceDisplayText ?? null,
        durationMinutes: service.durationMinutes,
        isIntroPrice: service.isIntroPrice ?? false,
        introPriceLabel: service.introPriceLabel ?? null,
        category: service.category,
        sortOrder: index + 1,
        isActive: true,
      });
  }

  for (const [index, addOn] of template.addOns.entries()) {
    const id = buildAddOnId(salonId, addOn.slug);
    addOnIdsBySlug.set(addOn.slug, id);
    await db
      .insert(addOnSchema)
      .values({
        id,
        salonId,
        name: addOn.name,
        slug: addOn.slug,
        category: addOn.category,
        descriptionItems: addOn.descriptionItems ?? null,
        priceCents: addOn.priceCents,
        priceDisplayText: addOn.priceDisplayText ?? null,
        durationMinutes: addOn.durationMinutes,
        pricingType: addOn.pricingType,
        unitLabel: addOn.unitLabel ?? null,
        maxQuantity: addOn.maxQuantity ?? null,
        isActive: true,
        displayOrder: index + 1,
      });
  }

  for (const mapping of template.serviceAddOns) {
    const serviceId = serviceIdsBySlug.get(mapping.serviceSlug);
    const addOnId = addOnIdsBySlug.get(mapping.addOnSlug);
    if (!serviceId || !addOnId) {
      continue;
    }

    await db
      .insert(serviceAddOnSchema)
      .values({
        id: buildServiceAddOnId(salonId, mapping.serviceSlug, mapping.addOnSlug),
        salonId,
        serviceId,
        addOnId,
        selectionMode: mapping.selectionMode ?? 'optional',
        displayOrder: mapping.displayOrder,
      });
  }

  const [salon] = await db
    .select({ settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  await db
    .update(salonSchema)
    .set({
      settings: {
        ...(salon?.settings ?? {}),
        booking: {
          ...DEFAULT_BOOKING_CONFIG,
        },
      },
    })
    .where(eq(salonSchema.id, salonId));

  return { seeded: true };
}

