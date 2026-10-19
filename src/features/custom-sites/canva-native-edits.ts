import { z } from 'zod';

const photo = { mediaId: z.string().uuid() };
export const canvaNativeChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('remove'), ...photo }).strict(),
  z.object({ type: z.literal('describe'), ...photo, alt: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal('move'), ...photo, direction: z.enum(['earlier', 'later']) }).strict(),
  z.object({ type: z.literal('layout'), layout: z.enum(['grid', 'carousel', 'editorial']) }).strict(),
  z.object({ type: z.literal('use'), ...photo, replaceId: z.string().uuid().optional(), alt: z.string().trim().min(1).max(500), createGallery: z.literal(true).optional() }).strict(),
]);
export const canvaNativeEditSchema = z.object({ expectedRevision: z.number().int().positive(), operationId: z.string().uuid(), blockId: z.string().min(1).max(71), change: canvaNativeChangeSchema }).strict();
export const canvaNativeUploadSchema = canvaNativeEditSchema.omit({ change: true }).extend({ alt: z.string().trim().min(1).max(500), replaceId: z.string().uuid().optional(), createGallery: z.literal(true).optional() }).strict();
export type CanvaNativeChange = z.infer<typeof canvaNativeChangeSchema>;
export type NativePhotoChoice = { mediaId: string; role: 'profile' | 'gallery'; width: number; height: number; alt: string; name: string };
