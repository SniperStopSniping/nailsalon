import { z } from 'zod';

import type { CanvaArea } from './canva';
import { canvaAreasSchema, canvaModelAreasSchema } from './canva';

export const canvaGenerationOutputSchema = z.object({
  // On an existing design these are additions/updates, never a replacement list.
  areas: canvaModelAreasSchema,
  // Optional only for retained results produced before this contract existed.
  removeAreaIds: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/u)).max(80).default([]),
  visibleText: z.string().max(16000),
  notes: z.array(z.string().max(500)).max(10),
  altText: z.array(z.string().min(1).max(3000)).min(1).max(10),
}).strict();

/** Omission cannot remove an owner's links. Revalidate the complete result. */
export function applyCanvaAreaChanges(previous: CanvaArea[], updates: CanvaArea[], removeIds: string[]) {
  canvaAreasSchema.parse(updates);
  const removed = new Set(removeIds);
  if (removed.size !== removeIds.length || removeIds.some(id => !previous.some(area => area.id === id) || updates.some(area => area.id === id))) {
    throw new z.ZodError([{ code: 'custom', path: ['removeAreaIds'], message: 'Remove each existing link once, and do not also update the same link.' }]);
  }
  const pending = new Map(updates.map(area => [area.id, area]));
  const result = previous.flatMap((area) => {
    if (removed.has(area.id)) {
      return [];
    }
    const update = pending.get(area.id);
    pending.delete(area.id);
    // Appearance belongs to the manual editor, outside the model contract.
    return [update ? { ...area, ...update, ...(area.appearance ? { appearance: area.appearance } : {}) } : area];
  });
  return canvaAreasSchema.parse([...result, ...pending.values()]);
}

/** The image is unchanged: a partial rescan must not erase previously read facts. */
export function retainedCanvaText(previous: string | undefined, scanned: string) {
  if (!previous || scanned.includes(previous)) {
    return scanned;
  }
  if (!scanned || previous.includes(scanned)) {
    return previous;
  }
  return z.string().max(16000).parse(`${previous}\n${scanned}`);
}
