/**
 * Add-on category vocabulary — the four values of the `add_on_category` enum.
 *
 * One map, imported by every owner surface that names an add-on category (the
 * Service Library shelf, the Add-ons tab list, the add-on editors). Keeping a
 * second copy per surface is how two views of one catalogue drift apart
 * (AG-services-06).
 */

import type { AddOnCategory } from '@/models/serviceCatalogTypes';

export const ADD_ON_CATEGORY_LABELS: Record<string, string> = {
  nail_art: 'Nail art',
  repair: 'Repair',
  removal: 'Removal',
  pedicure_addon: 'Pedicure add-on',
};

/** Rail order for the Add-ons segment; unknown values fall back to nail art. */
export const ADD_ON_CATEGORY_ORDER: AddOnCategory[] = [
  'nail_art',
  'repair',
  'removal',
  'pedicure_addon',
];

export function addOnCategoryLabel(category: string | null | undefined): string {
  if (!category) {
    return ADD_ON_CATEGORY_LABELS.nail_art!;
  }
  return ADD_ON_CATEGORY_LABELS[category] ?? category;
}
