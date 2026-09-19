import { z } from 'zod';

const treatmentSchema = z.enum(['gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown']);
const desiredApplicationSchema = z.enum(['natural_nails', 'extensions', 'unknown']);
const maintenanceSchema = z.enum(['new_set', 'refill', 'unknown']);
const lengthSchema = z.enum(['short', 'medium', 'long', 'extra_long', 'unknown']);
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
  french: frenchSchema,
  existingProduct: existingProductSchema,
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
  french: frenchSchema.nullable(),
  existingProduct: existingProductSchema.nullable(),
  origin: originSchema.nullable(),
  removal: removalSchema.nullable(),
  repairCount: repairCountSchema.nullable(),
}).strict();

export const patchJSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'treatment', 'desiredApplication', 'maintenance', 'length', 'french', 'existingProduct', 'origin', 'removal', 'repairCount'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    treatment: { type: ['string', 'null'], enum: ['gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown', null] },
    desiredApplication: {
      type: ['string', 'null'],
      enum: ['natural_nails', 'extensions', 'unknown', null],
      description: 'The requested result: natural-nail overlay or added extensions. It is distinct from existingProduct, which records only what is currently on the customer’s nails.',
    },
    maintenance: { type: ['string', 'null'], enum: ['new_set', 'refill', 'unknown', null] },
    length: { type: ['string', 'null'], enum: ['short', 'medium', 'long', 'extra_long', 'unknown', null] },
    french: { type: ['string', 'null'], enum: ['yes', 'no', 'unknown', null] },
    existingProduct: { type: ['string', 'null'], enum: ['none', 'gel_polish', 'builder_gel', 'gel_x', 'acrylic', 'unknown', null] },
    origin: { type: ['string', 'null'], enum: ['this_salon', 'other_salon', 'unknown', null] },
    removal: { type: ['string', 'null'], enum: ['yes', 'no', 'unknown', null] },
    repairCount: { anyOf: [{ type: 'integer', minimum: 0, maximum: 20 }, { const: 'unknown' }, { type: 'null' }] },
  },
} as const;

export type Facts = z.infer<typeof factsSchema>;
export type Patch = z.infer<typeof patchSchema>;

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
  return factsSchema.parse({
    schemaVersion: 1,
    treatment: next.treatment ?? current.treatment,
    desiredApplication: next.desiredApplication ?? current.desiredApplication,
    maintenance: next.maintenance ?? current.maintenance,
    length: next.length ?? current.length,
    french: next.french ?? current.french,
    existingProduct: next.existingProduct ?? current.existingProduct,
    origin: next.origin ?? current.origin,
    removal: next.removal ?? current.removal,
    repairCount: next.repairCount ?? current.repairCount,
  });
}
