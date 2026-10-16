import { z } from 'zod';

import { canvaDesignSchema } from './canva';
import type { WebsiteDetails } from './website-details';

/** Source files, not a template/composition registry. No server code or dependencies. */
export const customSiteSourceSchema = z.object({
  title: z.string().trim().min(1).max(100),
  html: z.string().min(1).max(60000),
  css: z.string().max(40000),
  javascript: z.string().max(20000),
  analysis: z.string().max(5000),
  limitations: z.array(z.string().max(500)).max(12),
  canva: canvaDesignSchema.optional(),
}).strict();
export type CustomSiteSource = z.infer<typeof customSiteSourceSchema>;
export const assetRoleSchema = z.enum(['reference', 'logo', 'photo']);
/** Owner choices persist with the same draft as the site, never in model text. */
export const designBriefSchema = z.object({
  fidelity: z.enum(['inspiration', 'match']).default('inspiration'),
  mode: z.enum(['rebuild', 'keep_design']).optional(),
  referenceIds: z.array(z.string().uuid()).max(6),
  ownedReferenceIds: z.array(z.string().uuid()).max(6),
  websiteAssetIds: z.array(z.string().uuid()).max(6),
}).strict().refine(value => value.ownedReferenceIds.every(id => value.referenceIds.includes(id)), 'Choose an uploaded design before confirming it is yours.');
export type DesignBrief = z.infer<typeof designBriefSchema>;
export const customSiteGenerateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  referenceIds: z.array(z.string().uuid()).max(12),
  startOver: z.boolean().default(false),
}).strict();
export type CustomSiteGenerateInput = z.infer<typeof customSiteGenerateSchema>;
export type CustomSiteData = {
  business: { name: string; city: string; address: string | null; bio: string; hours: Record<string, { open: string; close: string } | null>; hoursLabel?: string };
  services: { id: string; name: string; description: string | null; priceCents: number; priceLabel: string; durationMinutes: number }[];
  bookingRules?: Record<string, unknown>;
  details?: WebsiteDetails;
  currency: string;
  preview: boolean;
};
export type CustomSitePayload = { source: CustomSiteSource; data: CustomSiteData; images: Record<string, string>; artworkUnavailable?: boolean; canvaReviewRequired?: boolean; serviceKeys?: Record<string, string> };
