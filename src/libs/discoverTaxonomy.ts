/**
 * Discover browsing taxonomy — service families and nail lengths.
 *
 * IMPORTANT BOUNDARY. A Discover service family is *photo browsing metadata*.
 * It is NOT a booking category and it is NOT the authoritative service
 * identity. `VISIBLE_BOOKING_CATEGORIES` in `@/libs/bookingCategory` remains
 * the authority for the three main categories a booking surface may show
 * (manicure / pedicure / combo); nothing here widens that set, and nothing
 * here may be used to decide what is bookable, what it costs, how long it
 * takes, or who can perform it. The service catalogue stays in control.
 *
 * The family values are derived from the real catalogue rather than invented:
 * they mirror `TEMPLATE_KEY_FAMILY_PREFIXES` in `@/libs/serviceImage`, which
 * is the existing longest-prefix mapping from `templateKey` to a nail-work
 * family. Keeping the two aligned means an owner's tag choices can be
 * suggested from the services they actually offer.
 */

import type { Service } from '@/models/Schema';

export const DISCOVER_SERVICE_FAMILIES = [
  'gel_x',
  'acrylic',
  'builder_gel',
  'hard_gel',
  'polygel',
  'dip_powder',
  'manicure',
  'pedicure',
  'unspecified',
] as const;

export type DiscoverServiceFamily = (typeof DISCOVER_SERVICE_FAMILIES)[number];

export const DISCOVER_NAIL_LENGTHS = [
  'short',
  'medium',
  'long',
  'xl',
  'unspecified',
] as const;

export type DiscoverNailLength = (typeof DISCOVER_NAIL_LENGTHS)[number];

/**
 * Families an owner may actually assign. `unspecified` is the untagged state,
 * not a choice — a photo left unspecified is not Discover-eligible.
 */
export const ASSIGNABLE_DISCOVER_SERVICE_FAMILIES = DISCOVER_SERVICE_FAMILIES.filter(
  (family): family is Exclude<DiscoverServiceFamily, 'unspecified'> =>
    family !== 'unspecified',
);

export const ASSIGNABLE_DISCOVER_NAIL_LENGTHS = DISCOVER_NAIL_LENGTHS.filter(
  (length): length is Exclude<DiscoverNailLength, 'unspecified'> =>
    length !== 'unspecified',
);

const DISCOVER_SERVICE_FAMILY_LABELS: Record<DiscoverServiceFamily, string> = {
  gel_x: 'Gel-X',
  acrylic: 'Acrylic',
  builder_gel: 'Builder Gel / BIAB',
  hard_gel: 'Hard Gel',
  polygel: 'Polygel',
  dip_powder: 'Dip Powder',
  manicure: 'Manicure',
  pedicure: 'Pedicure',
  unspecified: 'Not tagged',
};

const DISCOVER_NAIL_LENGTH_LABELS: Record<DiscoverNailLength, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
  xl: 'XL',
  unspecified: 'Not tagged',
};

export function discoverServiceFamilyLabel(family: DiscoverServiceFamily): string {
  return DISCOVER_SERVICE_FAMILY_LABELS[family];
}

export function discoverNailLengthLabel(length: DiscoverNailLength): string {
  return DISCOVER_NAIL_LENGTH_LABELS[length];
}

export function isDiscoverServiceFamily(value: unknown): value is DiscoverServiceFamily {
  return (
    typeof value === 'string'
    && (DISCOVER_SERVICE_FAMILIES as readonly string[]).includes(value)
  );
}

export function isDiscoverNailLength(value: unknown): value is DiscoverNailLength {
  return (
    typeof value === 'string'
    && (DISCOVER_NAIL_LENGTHS as readonly string[]).includes(value)
  );
}

/**
 * Longest-prefix first, mirroring `TEMPLATE_KEY_FAMILY_PREFIXES`. Order
 * matters: `gel_x_` must beat any shorter `gel` prefix, and `builder_gel_`
 * must not be read as `gel`.
 */
const TEMPLATE_KEY_FAMILY_PREFIXES: readonly [string, DiscoverServiceFamily][] = [
  ['gel_x_', 'gel_x'],
  ['hard_gel_', 'hard_gel'],
  ['polygel_', 'polygel'],
  ['acrylic_', 'acrylic'],
  ['dip_powder_', 'dip_powder'],
  ['builder_gel_', 'builder_gel'],
  ['biab_', 'builder_gel'],
  ['structured_gel_', 'builder_gel'],
  ['luster_mani', 'manicure'],
  ['luster_pedi', 'pedicure'],
];

const SERVICE_NAME_FAMILY_RULES: readonly [RegExp, DiscoverServiceFamily][] = [
  [/\bgel[\s-]?x\b/, 'gel_x'],
  [/\bhard gel\b/, 'hard_gel'],
  [/\bpoly ?gel\b/, 'polygel'],
  [/\bdip\b|\bdip powder\b/, 'dip_powder'],
  [/\bacrylic\b/, 'acrylic'],
  [/\bbiab\b|\bbuilder\b|\bstructured\b/, 'builder_gel'],
  [/\bpedicure\b|\btoe\b/, 'pedicure'],
  [/\bmanicure\b|\bmani\b/, 'manicure'],
];

function normalizeServiceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Best-effort family for a catalogue service. Template key wins because it is
 * structured; a salon-authored service carries no template key, so the display
 * name is all there is. Returns null when nothing matches — callers must treat
 * that as "no family", never as a default.
 */
export function serviceDiscoverFamily(service: {
  templateKey?: string | null;
  name?: string | null;
}): DiscoverServiceFamily | null {
  const templateKey = service.templateKey?.trim();

  if (templateKey) {
    const prefix = TEMPLATE_KEY_FAMILY_PREFIXES.find(([p]) => templateKey.startsWith(p));

    if (prefix) {
      return prefix[1];
    }

    if (templateKey.includes('pedicure') || templateKey.includes('toe')) {
      return 'pedicure';
    }

    if (templateKey.includes('manicure')) {
      return 'manicure';
    }
  }

  const name = service.name ? normalizeServiceName(service.name) : '';

  if (!name) {
    return null;
  }

  const rule = SERVICE_NAME_FAMILY_RULES.find(([pattern]) => pattern.test(name));

  return rule ? rule[1] : null;
}

/**
 * The set of families a salon may tag photos with, derived from the services
 * it CURRENTLY offers and can actually be booked for.
 *
 * This is the enforcement primitive behind the brief's rule that a Discover
 * family must map to at least one currently active, publicly bookable service.
 * It exists so a client who filters "Acrylic" never discovers a business that
 * stopped offering acrylic — without photo tags ever becoming booking logic.
 */
export function bookableDiscoverFamilies(
  services: Pick<Service, 'templateKey' | 'name' | 'isActive'>[],
): Set<DiscoverServiceFamily> {
  const families = new Set<DiscoverServiceFamily>();

  for (const service of services) {
    if (!service.isActive) {
      continue;
    }

    const family = serviceDiscoverFamily(service);

    if (family) {
      families.add(family);
    }
  }

  return families;
}
