import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { serviceAddOnRowId } from '@/libs/starterMenu';
import { addOnSchema, serviceAddOnSchema } from '@/models/Schema';

import { changesProtectedAddOnChoices } from './add-ons';
import { type SetupDocument, SetupError } from './contracts';
import type { readSetupSnapshot, SetupTransaction } from './drafts.server';

/** Run inside the approved publication transaction, after the locked stale check. */
export async function publishSetupAddOns(tx: SetupTransaction, salonId: string, current: Awaited<ReturnType<typeof readSetupSnapshot>>, draft: SetupDocument, serviceIds: Record<string, string>, resolveIdentity: (kind: 'addOns', id: string) => string | null) {
  const identities: Record<string, string> = {};
  const used = new Set<string>();
  for (const addOn of draft.addOns ?? []) {
    if (identities[addOn.id]) {
      throw new SetupError('INVALID', 'An add-on appears twice in this draft. Review your extras before publishing.');
    }
    if (!addOn.confirmed || addOn.priceCents === null || addOn.durationMinutes === null || addOn.priceLabelNeedsReview) {
      throw new SetupError('NOT_READY', 'Review all add-on prices and extra times first.');
    }
    const recordId = resolveIdentity('addOns', addOn.id);
    const previous = current.document.addOns?.find(item => item.id === recordId);
    if (recordId && (!previous || used.has(recordId))) {
      throw new SetupError('INVALID', 'An add-on is missing or repeated. Review your current extras before publishing.');
    }
    const selected = addOn.serviceIds.map(id => serviceIds[id]);
    if (selected.some(id => !id)) {
      throw new SetupError('INVALID', 'An add-on’s service does not belong to this business draft.');
    }
    if (previous && changesProtectedAddOnChoices(previous, { ...addOn, serviceIds: selected as string[] })) {
      throw new SetupError('INVALID', 'This extra has existing selection rules. Keep its service choices and quantity rules, or change them in your service library.');
    }
    const values = { name: addOn.name, category: addOn.category, descriptionItems: addOn.descriptionItems, priceCents: addOn.priceCents, ...(addOn.priceDisplayText !== undefined ? { priceDisplayText: addOn.priceDisplayText } : {}), durationMinutes: addOn.durationMinutes, pricingType: addOn.pricingType, unitLabel: addOn.unitLabel, maxQuantity: addOn.maxQuantity, isActive: addOn.isActive };
    let savedId = recordId;
    if (previous) {
      used.add(previous.id);
      // No template, slug, group, display order or private metadata is replaced.
      if (Object.entries(values).some(([key, value]) => JSON.stringify(previous[key as keyof typeof previous]) !== JSON.stringify(value))) {
        await tx.update(addOnSchema).set(values).where(and(eq(addOnSchema.salonId, salonId), eq(addOnSchema.id, previous.id)));
      }
    } else if (!recordId && addOn.id.startsWith('draft_')) {
      savedId = randomUUID();
      await tx.insert(addOnSchema).values({ id: savedId, salonId, slug: `extra-${savedId}`, ...values });
    } else {
      throw new SetupError('INVALID', 'An add-on does not belong to this business.');
    }
    identities[addOn.id] = savedId!;
    const links = current.addOnLinks.filter(link => link.addOnId === savedId);
    // Remove only explicitly omitted, known active-service links. Never erase
    // hidden/inactive-service relationships or a concurrent inserted link.
    for (const link of links.filter(link => previous?.serviceIds.includes(link.serviceId) && !selected.includes(link.serviceId))) {
      await tx.delete(serviceAddOnSchema).where(and(eq(serviceAddOnSchema.id, link.id), eq(serviceAddOnSchema.salonId, salonId)));
    }
    for (const serviceId of selected as string[]) {
      if (!links.some(link => link.serviceId === serviceId)) {
        const inserted = await tx.insert(serviceAddOnSchema).values({ id: serviceAddOnRowId(serviceId, savedId!), salonId, serviceId, addOnId: savedId!, selectionMode: 'optional', priceMode: 'catalog_priced' }).onConflictDoNothing().returning();
        if (!inserted.length) {
          throw new SetupError('STALE', 'An add-on’s service choices changed elsewhere. Review the newer choices before publishing.');
        }
      }
    }
  }
  return identities;
}
