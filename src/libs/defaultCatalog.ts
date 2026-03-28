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
  category: 'manicure' | 'builder_gel' | 'extensions' | 'pedicure' | 'combo';
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
  {
    name: 'BIAB + Classic Pedicure',
    slug: 'biab-classic-pedicure',
    category: 'combo',
    priceCents: 8500,
    durationMinutes: 110,
    descriptionItems: [
      'Builder gel overlay with a classic pedicure pairing',
      'Strength for nails plus a polished foot refresh',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'BIAB + Lavender Spa Pedicure',
    slug: 'biab-lavender-spa-pedicure',
    category: 'combo',
    priceCents: 9500,
    durationMinutes: 125,
    descriptionItems: [
      'Builder gel overlay paired with a lavender spa pedicure',
      'Structured nails and a longer relaxing pedi treatment',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'BIAB + Deluxe Lavender Pedicure',
    slug: 'biab-deluxe-lavender-pedicure',
    category: 'combo',
    priceCents: 10500,
    durationMinutes: 140,
    descriptionItems: [
      'Builder gel overlay with the full deluxe lavender pedicure',
      'Hands and feet finished in one extended combo appointment',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Gel X / Hard Gel Extensions + Classic Pedicure',
    slug: 'gel-x-hard-gel-extensions-classic-pedicure',
    category: 'combo',
    priceCents: 10500,
    priceDisplayText: '$105+',
    durationMinutes: 155,
    descriptionItems: [
      'Full Gel X or hard gel extensions with a classic pedicure',
      'Length and shape plus a polished pedi refresh',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Gel X / Hard Gel Extensions + Lavender Spa Pedicure',
    slug: 'gel-x-hard-gel-extensions-lavender-spa-pedicure',
    category: 'combo',
    priceCents: 11500,
    priceDisplayText: '$115+',
    durationMinutes: 170,
    descriptionItems: [
      'Full Gel X or hard gel extensions with a lavender spa pedicure',
      'Extension set paired with a longer spa-style pedi service',
    ],
    isIntroPrice: true,
    introPriceLabel: 'Founding Client Price',
  },
  {
    name: 'Gel X / Hard Gel Extensions + Deluxe Lavender Pedicure',
    slug: 'gel-x-hard-gel-extensions-deluxe-lavender-pedicure',
    category: 'combo',
    priceCents: 12500,
    priceDisplayText: '$125+',
    durationMinutes: 185,
    descriptionItems: [
      'Full Gel X or hard gel extensions with the deluxe lavender pedicure',
      'Maximum length, structure, and a premium pedicure in one visit',
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
  { serviceSlug: 'biab-classic-pedicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'biab-classic-pedicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'biab-classic-pedicure', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'biab-lavender-spa-pedicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'biab-lavender-spa-pedicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'biab-lavender-spa-pedicure', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'biab-deluxe-lavender-pedicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'biab-deluxe-lavender-pedicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'biab-deluxe-lavender-pedicure', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'gel-x-hard-gel-extensions-classic-pedicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'gel-x-hard-gel-extensions-classic-pedicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'gel-x-hard-gel-extensions-classic-pedicure', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'gel-x-hard-gel-extensions-lavender-spa-pedicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'gel-x-hard-gel-extensions-lavender-spa-pedicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'gel-x-hard-gel-extensions-lavender-spa-pedicure', addOnSlug: 'nail-repair', displayOrder: 3 },
  { serviceSlug: 'gel-x-hard-gel-extensions-deluxe-lavender-pedicure', addOnSlug: 'simple-nail-art', displayOrder: 1 },
  { serviceSlug: 'gel-x-hard-gel-extensions-deluxe-lavender-pedicure', addOnSlug: '3d-charms', displayOrder: 2 },
  { serviceSlug: 'gel-x-hard-gel-extensions-deluxe-lavender-pedicure', addOnSlug: 'nail-repair', displayOrder: 3 },
];

const DEFAULT_COMBO_SERVICE_SLUGS = new Set(
  DEFAULT_SERVICES
    .filter(service => service.category === 'combo')
    .map(service => service.slug),
);

const DEFAULT_COMBO_SERVICES = DEFAULT_SERVICES.filter(service => DEFAULT_COMBO_SERVICE_SLUGS.has(service.slug));
const DEFAULT_COMBO_SERVICE_ADD_ONS = DEFAULT_SERVICE_ADD_ONS.filter(mapping => DEFAULT_COMBO_SERVICE_SLUGS.has(mapping.serviceSlug));

export function getDefaultCatalogTemplate() {
  return {
    services: DEFAULT_SERVICES,
    addOns: DEFAULT_ADD_ONS,
    serviceAddOns: DEFAULT_SERVICE_ADD_ONS,
    bookingConfig: DEFAULT_BOOKING_CONFIG satisfies BookingConfig,
  };
}

export function getDefaultComboCatalogTemplate() {
  return {
    services: DEFAULT_COMBO_SERVICES,
    serviceAddOns: DEFAULT_COMBO_SERVICE_ADD_ONS,
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

export async function backfillMissingDefaultComboServicesForSalon(args: {
  db: any;
  salonId: string;
}) {
  const { db, salonId } = args;
  const comboTemplate = getDefaultComboCatalogTemplate();

  type ExistingServiceRow = {
    id: string;
    slug: string | null;
    sortOrder: number | null;
  };
  type ExistingAddOnRow = {
    id: string;
    slug: string;
  };
  type ExistingMappingRow = {
    serviceId: string;
    addOnId: string;
  };

  const [existingServicesRaw, existingAddOnsRaw, existingMappingsRaw] = await Promise.all([
    db
      .select({
        id: serviceSchema.id,
        slug: serviceSchema.slug,
        sortOrder: serviceSchema.sortOrder,
      })
      .from(serviceSchema)
      .where(eq(serviceSchema.salonId, salonId)),
    db
      .select({
        id: addOnSchema.id,
        slug: addOnSchema.slug,
      })
      .from(addOnSchema)
      .where(eq(addOnSchema.salonId, salonId)),
    db
      .select({
        serviceId: serviceAddOnSchema.serviceId,
        addOnId: serviceAddOnSchema.addOnId,
      })
      .from(serviceAddOnSchema)
      .where(eq(serviceAddOnSchema.salonId, salonId)),
  ]);

  const existingServices = existingServicesRaw as ExistingServiceRow[];
  const existingAddOns = existingAddOnsRaw as ExistingAddOnRow[];
  const existingMappings = existingMappingsRaw as ExistingMappingRow[];

  const existingServiceBySlug = new Map<string, ExistingServiceRow>(
    existingServices
      .filter(service => typeof service.slug === 'string' && service.slug.length > 0)
      .map(service => [service.slug as string, service]),
  );
  const existingAddOnBySlug = new Map<string, ExistingAddOnRow>(
    existingAddOns.map(addOn => [addOn.slug, addOn]),
  );
  const existingMappingKeys = new Set(
    existingMappings.map(mapping => `${mapping.serviceId}:${mapping.addOnId}`),
  );

  let nextSortOrder = Math.max(0, ...existingServices.map(service => service.sortOrder ?? 0)) + 1;
  let insertedServices = 0;
  let insertedMappings = 0;

  for (const service of comboTemplate.services) {
    if (existingServiceBySlug.has(service.slug)) {
      continue;
    }

    const id = buildServiceId(salonId, service.slug);
    const insertedService = await db
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
        sortOrder: nextSortOrder,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning({ id: serviceSchema.id });

    if (insertedService.length === 0) {
      continue;
    }

    existingServiceBySlug.set(service.slug, {
      id,
      slug: service.slug,
      sortOrder: nextSortOrder,
    });
    nextSortOrder += 1;
    insertedServices += 1;
  }

  for (const mapping of comboTemplate.serviceAddOns) {
    const service = existingServiceBySlug.get(mapping.serviceSlug);
    const addOn = existingAddOnBySlug.get(mapping.addOnSlug);
    if (!service || !addOn) {
      continue;
    }

    const mappingKey = `${service.id}:${addOn.id}`;
    if (existingMappingKeys.has(mappingKey)) {
      continue;
    }

    const insertedMapping = await db
      .insert(serviceAddOnSchema)
      .values({
        id: buildServiceAddOnId(salonId, mapping.serviceSlug, mapping.addOnSlug),
        salonId,
        serviceId: service.id,
        addOnId: addOn.id,
        selectionMode: mapping.selectionMode ?? 'optional',
        displayOrder: mapping.displayOrder,
      })
      .onConflictDoNothing()
      .returning({ serviceId: serviceAddOnSchema.serviceId });

    if (insertedMapping.length === 0) {
      continue;
    }

    existingMappingKeys.add(mappingKey);
    insertedMappings += 1;
  }

  return {
    insertedServices,
    insertedMappings,
  };
}
