import { z } from 'zod';

/** Public, owner-authored copy. These statements never activate booking rules. */
export const websiteDetailsSchema = z.object({
  locationDirections: z.string().trim().max(500).nullable(),
  instagram: z.string().trim().regex(/^@?[\w.]{1,30}$/iu).nullable(),
  email: z.string().trim().email().max(254).refine(value => !/[?%#]/u.test(value), 'Use a plain email address.').nullable(),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,30}$/u).refine(value => value.replace(/\D/gu, '').length >= 7, 'Add a complete phone number.').nullable(),
  sections: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u),
    title: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(3000),
  }).strict()).max(20).refine(sections => new Set(sections.map(s => s.id)).size === sections.length, 'Section names must be unique.'),
}).strict();
export type WebsiteDetails = z.infer<typeof websiteDetailsSchema>;
export const EMPTY_WEBSITE_DETAILS: WebsiteDetails = { locationDirections: null, instagram: null, email: null, phone: null, sections: [] };
export function websiteContactLinks(details?: WebsiteDetails) {
  const parsed = websiteDetailsSchema.safeParse(details);
  if (!parsed.success) {
    return {};
  }
  const { instagram, email, phone } = parsed.data;
  return {
    ...(instagram ? { instagram: `https://www.instagram.com/${instagram.replace(/^@/u, '')}/` } : {}),
    ...(email ? { email: `mailto:${email}` } : {}),
    ...(phone ? { phone: `tel:${phone.replace(/[^+0-9]/gu, '')}` } : {}),
  };
}
