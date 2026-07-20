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

export type SeedResult = {
  createdServiceIds: string[];
  createdAddOnIds: string[];
  revivedServiceIds: string[];
  revivedAddOnIds: string[];
  skippedTemplateKeys: string[];
};

type ExistingCatalogRow = { id: string; templateKey: string | null; isActive: boolean | null };

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
 * Existing active records are skipped. Matching inactive template records are
 * reactivated without replacing any owner-edited fields. Never seeds
 * acrylic/dip unless explicitly requested by a library action.
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
      .select({ id: serviceSchema.id, templateKey: serviceSchema.templateKey, isActive: serviceSchema.isActive })
      .from(serviceSchema)
      .where(and(eq(serviceSchema.salonId, salonId), isNotNull(serviceSchema.templateKey))),
    db
      .select({ id: addOnSchema.id, templateKey: addOnSchema.templateKey, isActive: addOnSchema.isActive })
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
  const revivedServiceIds: string[] = [];
  const revivedAddOnIds: string[] = [];

  const maxSortRow = await db
    .select({ sortOrder: serviceSchema.sortOrder })
    .from(serviceSchema)
    .where(eq(serviceSchema.salonId, salonId));
  let nextSortOrder = Math.max(0, ...maxSortRow.map((row: { sortOrder: number | null }) => row.sortOrder ?? 0));

  const serviceTemplates = requested.filter(template => template.serviceType !== 'addon');
  const addOnTemplates = requested.filter(template => template.serviceType === 'addon');

  for (const template of serviceTemplates) {
    if (existingKeys.has(template.systemKey)) {
      const existing = existingServiceRows.find((row: ExistingCatalogRow) => row.templateKey === template.systemKey);
      if (existing?.id) {
        if (!existing.isActive) {
          await db
            .update(serviceSchema)
            .set({ isActive: true })
            .where(and(eq(serviceSchema.id, existing.id), eq(serviceSchema.salonId, salonId)));
          revivedServiceIds.push(existing.id);
        } else {
          skippedTemplateKeys.push(template.systemKey);
        }
      } else {
        skippedTemplateKeys.push(template.systemKey);
      }
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
      // Canonical position when the template declares one; otherwise append.
      sortOrder: template.sortOrder ?? nextSortOrder,
      featuredOrder: template.isFeaturedDefault ? template.sortOrder ?? nextSortOrder : null,
      isActive: override?.enabled ?? true,
    });

    createdServiceIds.push(id);

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
      const existing = existingAddOnRows.find((row: ExistingCatalogRow) => row.templateKey === template.systemKey);
      if (existing?.id) {
        if (!existing.isActive) {
          await db
            .update(addOnSchema)
            .set({ isActive: true })
            .where(and(eq(addOnSchema.id, existing.id), eq(addOnSchema.salonId, salonId)));
          revivedAddOnIds.push(existing.id);
        } else {
          skippedTemplateKeys.push(template.systemKey);
        }
      } else {
        skippedTemplateKeys.push(template.systemKey);
      }
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
  }

  await reconcileSalonServiceAddOnCompatibility(db, salonId);

  return {
    createdServiceIds,
    createdAddOnIds,
    revivedServiceIds,
    revivedAddOnIds,
    skippedTemplateKeys,
  };
}

/**
 * Reconciles catalog-defined compatibility against salon-owned IDs. Existing
 * mappings are never deleted, so custom owner links remain intact.
 */
export async function reconcileSalonServiceAddOnCompatibility(db: any, salonId: string): Promise<number> {
  const [services, addOns] = await Promise.all([
    db.select({ id: serviceSchema.id, templateKey: serviceSchema.templateKey })
      .from(serviceSchema)
      .where(and(eq(serviceSchema.salonId, salonId), isNotNull(serviceSchema.templateKey))),
    db.select({ id: addOnSchema.id, templateKey: addOnSchema.templateKey })
      .from(addOnSchema)
      .where(and(eq(addOnSchema.salonId, salonId), isNotNull(addOnSchema.templateKey))),
  ]);

  const serviceByKey = new Map(services.map((service: { id: string; templateKey: string | null }) => [service.templateKey, service.id]));
  const addOnByKey = new Map((addOns as Array<{ id: string; templateKey: string | null }>)
    .map(addOn => [addOn.templateKey, addOn.id]));
  const templatesByKey = new Map(SERVICE_TEMPLATES.map(template => [template.systemKey, template]));
  let inserted = 0;

  // Service→add-on is the authoritative direction: the declared array order
  // becomes display_order, so every surface renders add-ons deterministically.
  for (const [serviceKey, serviceId] of serviceByKey as Map<string, string>) {
    const serviceTemplate = templatesByKey.get(serviceKey);
    const declared = serviceTemplate?.compatibleAddOnKeys;
    if (!declared?.length) {
      continue;
    }

    for (const [index, addOnKey] of declared.entries()) {
      const addOnId = addOnByKey.get(addOnKey);
      if (!addOnId) {
        continue;
      }

      await db.insert(serviceAddOnSchema).values({
        // Derived from the service ROW id so a retired template copy holding
        // ids built from the same template key can never mask a new mapping.
        id: `svcaddon_${serviceId.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}_${addOnKey.replace(/_/g, '-')}`,
        salonId,
        serviceId,
        addOnId,
        selectionMode: 'optional',
        displayOrder: index,
      }).onConflictDoNothing();
      inserted += 1;
    }
  }

  for (const addOn of addOns as Array<{ id: string; templateKey: string | null }>) {
    const addOnTemplate = addOn.templateKey ? templatesByKey.get(addOn.templateKey) : undefined;
    if (!addOnTemplate?.compatibleTemplateKeys?.length) {
      continue;
    }

    const compatibleKeys = new Set(addOnTemplate.compatibleTemplateKeys);
    for (const combo of SERVICE_TEMPLATES.filter(template => template.serviceType === 'combo')) {
      if (combo.componentTemplateKeys?.some(component => compatibleKeys.has(component))) {
        compatibleKeys.add(combo.systemKey);
      }
    }

    for (const compatibleKey of compatibleKeys) {
      const serviceId = serviceByKey.get(compatibleKey);
      if (!serviceId) {
        continue;
      }

      // A service that declares its own add-on set is authoritative: the
      // legacy add-on-side list must not widen it (e.g. a no-colour service
      // must never inherit design add-ons).
      if (templatesByKey.get(compatibleKey)?.compatibleAddOnKeys?.length) {
        continue;
      }

      await db.insert(serviceAddOnSchema).values({
        id: `svcaddon_${sanitizeSalonId(salonId)}_${templateSlug(addOnTemplate)}_${compatibleKey.replace(/_/g, '-')}`,
        salonId,
        serviceId,
        addOnId: addOn.id,
        selectionMode: 'optional',
        displayOrder: 0,
      }).onConflictDoNothing();
      inserted += 1;
    }
  }

  return inserted;
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
