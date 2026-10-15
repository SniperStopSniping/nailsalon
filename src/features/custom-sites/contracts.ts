import { z } from 'zod';

/** Source files, not a template/composition registry. No server code or dependencies. */
export const customSiteSourceSchema = z.object({
  title: z.string().trim().min(1).max(100),
  html: z.string().min(1).max(60000),
  css: z.string().max(40000),
  javascript: z.string().max(20000),
  analysis: z.string().max(5000),
  limitations: z.array(z.string().max(500)).max(12),
}).strict();
export type CustomSiteSource = z.infer<typeof customSiteSourceSchema>;
export const assetRoleSchema = z.enum(['reference', 'logo', 'photo']);
export const customSiteGenerateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  referenceIds: z.array(z.string().uuid()).max(6),
  startOver: z.boolean().default(false),
}).strict();
export type CustomSiteGenerateInput = z.infer<typeof customSiteGenerateSchema>;
export type CustomSiteData = {
  business: { name: string; city: string; address: string | null; bio: string; hours: Record<string, { open: string; close: string } | null>; hoursLabel?: string };
  services: { id: string; name: string; description: string | null; priceCents: number; priceLabel: string; durationMinutes: number }[];
  currency: string;
  preview: boolean;
};
export type CustomSitePayload = { source: CustomSiteSource; data: CustomSiteData; images: Record<string, string> };
