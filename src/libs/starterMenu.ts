import { and, eq, isNotNull } from 'drizzle-orm';

import {
  addOnSchema,
  serviceAddOnSchema,
  serviceSchema,
  technicianServicesSchema,
} from '@/models/Schema';

import {
  getStarterTemplates,
  SERVICE_TEMPLATES,
  type ServiceTemplate,
} from './serviceTemplateCatalog';

export type StarterMenuOverride = {
  templateKey: string;
  priceCents?: number;
  durationMinutes?: number;
  /** false leaves the record created but not bookable. */
  enabled?: boolean;
};

type SeedResult = {
  createdServiceIds: string[];
  createdAddOnIds: string[];
  skippedTemplateKeys: string[];
};

function sanitizeSalonId(salonId: string): string {
  return salonId.replace(/[^a-z0-9]/gi, '_');
}

function templateSlug(template: ServiceTemplate): string {
  return template.systemKey.replace(/_/g, '-');
}

/**
 * Seeds the recommended starter menu (services + add-ons + compatibility
 * rules) as salon-owned records tagged with their template keys.
 *
 * Skip-by-templateKey makes this idempotent AND makes owner deletions stick:
 * it only ever runs at salon creation (`mode: 'initial'`) or through the
 * explicit "Restore recommended services" / library actions
 * (`mode: 'restore'`), and existing keys — active or not — are never touched,
 * so a starter record the owner disabled or removed is not resurrected or
 * reactivated. Never seeds acrylic/dip (the catalog marks no such template as
 * a starter).
 */
export async function seedStarterMenuForSalon(args: {
  db: any;
  salonId: string;
  technicianId?: string | null;
  overrides?: StarterMenuOverride[];
  mode: 'initial' | 'restore';
  /**
   * Seed exactly these catalog keys (library adds — any template qualifies);
   * omitted ⇒ the recommended starter menu.
   */
  templateKeys?: string[];
}): Promise<SeedResult> {
  const { db, salonId, technicianId = null, overrides = [], templateKeys } = args;

  const requested = templateKeys
    ? SERVICE_TEMPLATES.filter(template => templateKeys.includes(template.systemKey))
    : getStarterTemplates();
  const overridesByKey = new Map(overrides.map(override => [override.templateKey, override]));

  const [existingServiceRows, existingAddOnRows] = await Promise.all([
    db
      .select({ templateKey: serviceSchema.templateKey })
      .from(serviceSchema)
      .where(and(eq(serviceSchema.salonId, salonId), isNotNull(serviceSchema.templateKey))),
    db
      .select({ templateKey: addOnSchema.templateKey })
      .from(addOnSchema)
      .where(and(eq(addOnSchema.salonId, salonId), isNotNull(addOnSchema.templateKey))),
  ]);
  const existingKeys = new Set<string>([
    ...existingServiceRows.map((row: { templateKey: string | null }) => row.templateKey),
    ...existingAddOnRows.map((row: { templateKey: string | null }) => row.templateKey),
  ].filter(Boolean) as string[]);

  const skippedTemplateKeys: string[] = [];
  const createdServiceIds: string[] = [];
  const createdAddOnIds: string[] = [];
  const serviceIdsByKey = new Map<string, string>();

  const maxSortRow = await db
    .select({ sortOrder: serviceSchema.sortOrder })
    .from(serviceSchema)
    .where(eq(serviceSchema.salonId, salonId));
  let nextSortOrder = Math.max(0, ...maxSortRow.map((row: { sortOrder: number | null }) => row.sortOrder ?? 0));

  const serviceTemplates = requested.filter(template => template.serviceType !== 'addon');
  const addOnTemplates = requested.filter(template => template.serviceType === 'addon');

  for (const template of serviceTemplates) {
    if (existingKeys.has(template.systemKey)) {
      skippedTemplateKeys.push(template.systemKey);
      continue;
    }

    const override = overridesByKey.get(template.systemKey);
    const id = `svc_${sanitizeSalonId(salonId)}_${templateSlug(template)}`;
    nextSortOrder += 1;

    await db.insert(serviceSchema).values({
      id,
      salonId,
      name: template.name,
      slug: templateSlug(template),
      description: template.description,
      descriptionItems: template.description ? [template.description] : null,
      price: override?.priceCents ?? template.defaultPriceCents,
      priceDisplayText: template.priceDisplayText,
      isIntroPrice: template.isIntroPrice ?? false,
      introPriceLabel: template.isIntroPrice ? template.introPriceLabel ?? null : null,
      durationMinutes: override?.durationMinutes ?? template.defaultDurationMinutes,
      category: template.serviceCategory,
      bookingCategory: template.bookingCategory,
      templateKey: template.systemKey,
      sortOrder: nextSortOrder,
      isActive: override?.enabled ?? true,
    });

    createdServiceIds.push(id);
    serviceIdsByKey.set(template.systemKey, id);

    if (technicianId) {
      await db.insert(technicianServicesSchema).values({
        technicianId,
        serviceId: id,
        priority: nextSortOrder,
        enabled: true,
      });
    }
  }

  let addOnDisplayOrder = 0;
  for (const template of addOnTemplates) {
    addOnDisplayOrder += 1;
    if (existingKeys.has(template.systemKey)) {
      skippedTemplateKeys.push(template.systemKey);
      continue;
    }

    const override = overridesByKey.get(template.systemKey);
    const id = `addon_${sanitizeSalonId(salonId)}_${templateSlug(template)}`;

    await db.insert(addOnSchema).values({
      id,
      salonId,
      name: template.name,
      slug: templateSlug(template),
      category: template.addOnCategory ?? 'nail_art',
      descriptionItems: template.description ? [template.description] : null,
      priceCents: override?.priceCents ?? template.defaultPriceCents,
      priceDisplayText: template.priceDisplayText,
      durationMinutes: override?.durationMinutes ?? template.defaultDurationMinutes,
      pricingType: template.pricingType ?? 'fixed',
      unitLabel: template.unitLabel ?? null,
      maxQuantity: template.maxQuantity ?? null,
      templateKey: template.systemKey,
      isActive: override?.enabled ?? true,
      displayOrder: addOnDisplayOrder,
    });

    createdAddOnIds.push(id);

    for (const compatibleKey of template.compatibleTemplateKeys ?? []) {
      const serviceId = serviceIdsByKey.get(compatibleKey)
        ?? await lookupSalonServiceIdByTemplateKey(db, salonId, compatibleKey);
      if (!serviceId) {
        continue;
      }

      await db.insert(serviceAddOnSchema).values({
        id: `svcaddon_${sanitizeSalonId(salonId)}_${templateSlug(template)}_${compatibleKey.replace(/_/g, '-')}`,
        salonId,
        serviceId,
        addOnId: id,
        selectionMode: 'optional',
        displayOrder: addOnDisplayOrder,
      });
    }
  }

  return { createdServiceIds, createdAddOnIds, skippedTemplateKeys };
}

async function lookupSalonServiceIdByTemplateKey(
  db: any,
  salonId: string,
  templateKey: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: serviceSchema.id })
    .from(serviceSchema)
    .where(and(eq(serviceSchema.salonId, salonId), eq(serviceSchema.templateKey, templateKey)))
    .limit(1);
  return row?.id ?? null;
}

/** Template keys already present on the salon menu (services or add-ons). */
export async function getSalonTemplateKeys(db: any, salonId: string): Promise<Set<string>> {
  const [serviceRows, addOnRows] = await Promise.all([
    db
      .select({ templateKey: serviceSchema.templateKey })
      .from(serviceSchema)
      .where(and(eq(serviceSchema.salonId, salonId), isNotNull(serviceSchema.templateKey))),
    db
      .select({ templateKey: addOnSchema.templateKey })
      .from(addOnSchema)
      .where(and(eq(addOnSchema.salonId, salonId), isNotNull(addOnSchema.templateKey))),
  ]);
  return new Set(
    [...serviceRows, ...addOnRows]
      .map((row: { templateKey: string | null }) => row.templateKey)
      .filter((key: string | null): key is string => Boolean(key)),
  );
}
