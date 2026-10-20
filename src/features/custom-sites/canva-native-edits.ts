import { z } from 'zod';

const photo = { mediaId: z.string().uuid() };
const aboutCopy = { title: z.string().trim().min(1).max(120), text: z.string().trim().min(1).max(3000) };
export const canvaNativeChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_about'), ...aboutCopy }).strict(),
  z.object({ type: z.literal('about_text'), sectionId: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u).optional(), ...aboutCopy }).strict(),
  z.object({ type: z.literal('remove'), ...photo }).strict(),
  z.object({ type: z.literal('describe'), ...photo, alt: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal('move'), ...photo, direction: z.enum(['earlier', 'later']) }).strict(),
  z.object({ type: z.literal('layout'), layout: z.enum(['grid', 'carousel', 'editorial']) }).strict(),
  z.object({ type: z.literal('use'), ...photo, replaceId: z.string().uuid().optional(), alt: z.string().trim().min(1).max(500), createGallery: z.literal(true).optional() }).strict(),
]);
export const canvaNativeEditSchema = z.object({ expectedRevision: z.number().int().positive(), operationId: z.string().uuid(), blockId: z.string().min(1).max(71), change: canvaNativeChangeSchema }).strict();
export const canvaNativePhotoChangesSchema = z.array(canvaNativeEditSchema.pick({ blockId: true, change: true })).max(10);
export const canvaNativeUploadSchema = canvaNativeEditSchema.omit({ change: true }).extend({ alt: z.string().trim().min(1).max(500), replaceId: z.string().uuid().optional(), createGallery: z.literal(true).optional() }).strict();
export type CanvaNativeChange = z.infer<typeof canvaNativeChangeSchema>;
export type CanvaNativePhotoChange = z.infer<typeof canvaNativePhotoChangesSchema>[number];
export type NativePhotoChoice = { mediaId: string; storageKind?: 'asset'; role: 'profile' | 'gallery'; width: number; height: number; alt: string; name: string };
