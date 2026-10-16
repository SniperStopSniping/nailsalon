import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';
import { customSiteAssetSchema as assets } from '@/models/Schema';

/** Promote explicitly owned artwork into an immutable website asset; preserve bytes. */
export async function canvaWebsiteImage(actor: SetupActor, original: typeof assets.$inferSelect) {
  if (!original.mimeType.startsWith('image/')) {
    throw new SetupError('INVALID', 'Export your Canva pages as PNG or JPG to keep the design unchanged. PDFs can still be used for an editable redesign.');
  }
  if (original.salonId !== actor.salonId) {
    throw new SetupError('FORBIDDEN', 'This image is unavailable for this business.');
  }
  if (original.role !== 'reference') {
    return original;
  }
  return db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const [previous] = await tx.select().from(assets).where(and(eq(assets.salonId, actor.salonId), eq(assets.role, 'photo'), eq(assets.hash, original.hash)));
    if (previous) {
      return previous;
    }
    const current = await tx.select({ byteSize: assets.byteSize }).from(assets).where(eq(assets.salonId, actor.salonId));
    if (current.length >= 24 || current.reduce((sum, row) => sum + row.byteSize, 0) + original.byteSize > 15000000) {
      throw new SetupError('NOT_READY', 'Your image library is full. Remove unused uploads before adding another Canva design.');
    }
    const [copy] = await tx.insert(assets).values({ ...original, id: randomUUID(), actorId: actor.adminId, role: 'photo', name: `Canva · ${original.name}`.slice(0, 120), createdAt: new Date() }).returning();
    return copy!;
  });
}
