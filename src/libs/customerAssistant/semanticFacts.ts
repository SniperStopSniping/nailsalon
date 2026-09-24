import { z } from 'zod';

const treatmentSchema = z.enum(['gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown']);
const desiredApplicationSchema = z.enum(['natural_nails', 'extensions', 'unknown']);
const maintenanceSchema = z.enum(['new_set', 'refill', 'unknown']);
const lengthSchema = z.enum(['short', 'medium', 'long', 'extra_long', 'unknown']);
const designPreferenceSchema = z.enum(['unknown', 'selected', 'plain', 'skip']);
const frenchSchema = z.enum(['yes', 'no', 'unknown']);
const existingProductSchema = z.enum(['none', 'gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown']);
const originSchema = z.enum(['this_salon', 'other_salon', 'unknown']);
const removalSchema = z.enum(['yes', 'no', 'unknown']);
const repairCountSchema = z.union([z.number().int().min(0).max(20), z.literal('unknown')]);

/** Bounded, non-contact semantic state for the customer conversation. */
export const factsSchema = z.object({
  schemaVersion: z.literal(1),
  treatment: treatmentSchema,
  desiredApplication: desiredApplicationSchema,
  maintenance: maintenanceSchema,
  length: lengthSchema,
  lengthChoice: z.literal('base').optional(),
  french: frenchSchema,
  designPreference: designPreferenceSchema.optional(),
  designChoiceIds: z.array(z.string().min(1).max(100)).max(20).optional(),
  existingProduct: existingProductSchema,
  currentProductUncertain: z.boolean().optional(),
  origin: originSchema,
  removal: removalSchema,
  repairCount: repairCountSchema,
}).strict();

/**
 * `null` means this turn did not mention a fact and preserves prior state.
 * Explicit `unknown` and `none` are state values and therefore clear a prior
 * concrete fact instead of being treated as absent.
 */
export const patchSchema = z.object({
  schemaVersion: z.literal(1),
  treatment: treatmentSchema.nullable(),
  desiredApplication: desiredApplicationSchema.nullable(),
  maintenance: maintenanceSchema.nullable(),
  length: lengthSchema.nullable(),
  lengthChoice: z.literal('base').nullable().default(null),
  french: frenchSchema.nullable(),
  designPreference: designPreferenceSchema.nullable().default(null),
  existingProduct: existingProductSchema.nullable(),
  currentProductUncertain: z.boolean().nullable().default(null),
  origin: originSchema.nullable(),
  removal: removalSchema.nullable(),
  repairCount: repairCountSchema.nullable(),
}).strict();

export const patchJSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'treatment', 'desiredApplication', 'maintenance', 'length', 'lengthChoice', 'french', 'designPreference', 'existingProduct', 'currentProductUncertain', 'origin', 'removal', 'repairCount'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    treatment: { type: ['string', 'null'], enum: ['gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown', null] },
    desiredApplication: {
      type: ['string', 'null'],
      enum: ['natural_nails', 'extensions', 'unknown', null],
      description: 'The requested result: natural-nail overlay or added extensions. It is distinct from existingProduct, which records the appointment starting condition, including an explicitly confirmed pre-visit removal.',
    },
    maintenance: { type: ['string', 'null'], enum: ['new_set', 'refill', 'unknown', null] },
    length: { type: ['string', 'null'], enum: ['short', 'medium', 'long', 'extra_long', 'unknown', null] },
    lengthChoice: { type: ['string', 'null'], enum: ['base', null], description: 'base only when the customer explicitly chooses the base service / no length upgrade option. Never infer Short from this. Null when unmentioned.' },
    french: { type: ['string', 'null'], enum: ['yes', 'no', 'unknown', null] },
    designPreference: { type: ['string', 'null'], enum: ['unknown', 'selected', 'plain', 'skip', null], description: 'selected for an explicit requested design; plain for no designs/no extras/plain nails; skip only for explicitly skipping the optional design question. No French alone is not plain or skip. Null when unmentioned.' },
    currentProductUncertain: { type: ['boolean', 'null'], description: 'True only when the customer explicitly says they do not know what is currently on their nails. Null when unmentioned. Missing information is not explicit uncertainty.' },
    existingProduct: { type: ['string', 'null'], enum: ['none', 'gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown', null] },
    origin: { type: ['string', 'null'], enum: ['this_salon', 'other_salon', 'unknown', null] },
    removal: { type: ['string', 'null'], enum: ['yes', 'no', 'unknown', null] },
    repairCount: { anyOf: [{ type: 'integer', minimum: 0, maximum: 20 }, { type: 'string', const: 'unknown' }, { type: 'null' }] },
  },
} as const;

export type Facts = z.infer<typeof factsSchema>;
export type Patch = z.input<typeof patchSchema>;

/** A same-system polish refresh needs no extra removal decision from the caller. */
export function isGelPolishRefresh(facts: Facts): boolean {
  return facts.treatment === 'gel_polish' && facts.existingProduct === 'gel_polish'
    && facts.maintenance !== 'refill' && facts.removal === 'unknown';
}

export const emptyFacts = (): Facts => ({
  schemaVersion: 1,
  treatment: 'unknown',
  desiredApplication: 'unknown',
  maintenance: 'unknown',
  length: 'unknown',
  french: 'unknown',
  existingProduct: 'unknown',
  origin: 'unknown',
  removal: 'unknown',
  repairCount: 'unknown',
});

export function mergeFacts(previous: Facts, patch: Patch): Facts {
  const current = factsSchema.parse(previous);
  const next = patchSchema.parse(patch);
  // A model may be uncertain which service to recommend. That must not be
  // reclassified as uncertainty about the product currently on the nails.
  // Only an explicit unknown current-product patch can set this blocker.
  const currentProductUncertain = next.currentProductUncertain === true && next.existingProduct === 'unknown';
  const currentProductUncertaintyCleared = next.currentProductUncertain === false
    || (next.existingProduct !== null && next.existingProduct !== 'unknown');
  return factsSchema.parse({
    schemaVersion: 1,
    treatment: next.treatment ?? current.treatment,
    desiredApplication: next.desiredApplication ?? current.desiredApplication,
    maintenance: next.maintenance ?? current.maintenance,
    length: next.lengthChoice === 'base' ? 'unknown' : next.length ?? current.length,
    ...(next.lengthChoice === 'base' ? { lengthChoice: 'base' } : next.length === null && current.lengthChoice ? { lengthChoice: current.lengthChoice } : {}),
    french: next.french ?? current.french,
    ...(current.designChoiceIds ? { designChoiceIds: current.designChoiceIds } : {}),
    ...(next.designPreference !== null ? { designPreference: next.designPreference } : current.designPreference !== undefined ? { designPreference: current.designPreference } : {}),
    existingProduct: next.existingProduct ?? current.existingProduct,
    ...(currentProductUncertain ? { currentProductUncertain: true } : currentProductUncertaintyCleared ? { currentProductUncertain: false } : current.currentProductUncertain !== undefined ? { currentProductUncertain: current.currentProductUncertain } : {}),
    origin: next.origin ?? current.origin,
    removal: next.removal ?? current.removal,
    repairCount: next.repairCount ?? current.repairCount,
  });
}

/** Only these bounded facts can make a clarification demonstrably redundant. */
export function hasKnownClarificationAnswer(question: string, facts: Facts): boolean {
  switch (question) {
    case 'length': return facts.length !== 'unknown';
    case 'quantity': return facts.repairCount !== 'unknown';
    case 'removal': return facts.removal !== 'unknown';
    case 'product': return facts.existingProduct !== 'unknown';
    case 'origin': return facts.origin !== 'unknown';
    default: return false;
  }
}
