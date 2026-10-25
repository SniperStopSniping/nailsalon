import { z } from 'zod';

/**
 * PATCH omission means "leave unchanged", including for defaulted fields.
 * Zod 4's .partial() evaluates defaults inside optional fields. The identity
 * preprocessing boundary lets optional short-circuit undefined before entering
 * the field parser, while supplied values retain its checks and error messages.
 * Use .extend(patchShape(schema.shape)) to preserve the object's key policy.
 */
export function patchShape<Shape extends z.ZodRawShape>(shape: Shape) {
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [
    key,
    z.preprocess(value => value, field).optional(),
  ])) as { [Key in keyof Shape]: z.ZodOptional<z.ZodPreprocess<Shape[Key], z.input<Shape[Key]>>> };
}
