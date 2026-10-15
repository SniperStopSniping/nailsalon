import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor, SetupTransaction } from '@/features/business-setup/drafts.server';
import { loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { deleteOnboardingMediaFile, normalizeOnboardingImage, readOnboardingMediaFile, saveOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { db } from '@/libs/DB';
import { customSiteAssetSchema as assets } from '@/models/Schema';

import { assetRoleSchema } from './contracts';

export const MAX_REFERENCE_BYTES = 3000000;
export async function ownedAssets(tx: SetupTransaction | typeof db, salonId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length ? await tx.select().from(assets).where(and(eq(assets.salonId, salonId), inArray(assets.id, unique))) : [];
  if (rows.length !== unique.length) {
    throw new SetupError('FORBIDDEN', 'One of these images is unavailable for this business.');
  }
  return rows;
}
export async function uploadCustomAsset(actor: SetupActor, file: File, rawRole: unknown) {
  const role = assetRoleSchema.parse(rawRole);
  if (file.size <= 0 || file.size > MAX_REFERENCE_BYTES) {
    throw new SetupError('INVALID', 'Choose a file under 3 MB.');
  }
  const id = randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  let pdfBase64: string | null = null;
  let imageBase64: string | null = null;
  let normalizedBytes: Buffer | null = null;
  let stored: Awaited<ReturnType<typeof saveOnboardingMediaFile>> | null = null;
  // Authorize before storing or parsing; repeat when accepting the immutable asset.
  const head = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    return loadSetupHead(tx, actor.salonId);
  });
  if (file.type === 'application/pdf') {
    if (role !== 'reference' || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new SetupError('INVALID', 'PDFs can be used as design references. Upload logos and photos as images.');
    }
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
      if (pdf.isEncrypted || pdf.getPageCount() > 6 || pdf.getPageCount() < 1) {
        throw new Error('limit');
      }
    } catch {
      throw new SetupError('INVALID', 'Use an unencrypted PDF with at most six pages.');
    }
    // Never rendered or offered as a public download. Bounded private reference
    // bytes avoid introducing a second public-media system for PDF input.
    pdfBase64 = bytes.toString('base64');
  } else if (process.env.APP_ENV === 'preview' && process.env.CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES === 'true') {
    // Isolated pilot only: bounded private bytes in the existing Preview DB.
    // No production storage credentials, public upload URLs or ephemeral disk.
    normalizedBytes = (await normalizeOnboardingImage(file)).normalized;
    if (normalizedBytes.length > 750000) {
      throw new SetupError('INVALID', 'This image is too detailed for the site. Try a smaller export.');
    }
    imageBase64 = normalizedBytes.toString('base64');
  } else {
    stored = await saveOnboardingMediaFile({ file, role: role === 'reference' ? 'custom_design' : role === 'photo' ? 'gallery' : 'logo', salonId: actor.salonId, siteId: head.workspace.id, revisionId: id, stableItemId: id, uploadAttemptId: id });
    if (stored.byteSize > 750000) {
      await deleteOnboardingMediaFile(stored.storageKey, { salonId: actor.salonId });
      throw new SetupError('INVALID', 'This image is too detailed for the site. Try a smaller export.');
    }
  }
  const storedBytes = stored ? await readOnboardingMediaFile(stored.storageKey, { salonId: actor.salonId }) : normalizedBytes ?? bytes;
  const byteSize = stored?.byteSize ?? normalizedBytes?.length ?? bytes.length;
  try {
    return await db.transaction(async (tx) => {
      await lockSetupSalon(tx, actor);
      const current = await tx.select({ byteSize: assets.byteSize }).from(assets).where(eq(assets.salonId, actor.salonId));
      if (current.length >= 24 || current.reduce((sum, a) => sum + a.byteSize, 0) + byteSize > 15000000) {
        throw new SetupError('NOT_READY', 'This business has reached its reference storage limit.');
      }
      const [asset] = await tx.insert(assets).values({ id, salonId: actor.salonId, actorId: actor.adminId, role, name: file.name.replace(/[^\w .-]/gu, '').slice(0, 120) || 'Reference', mimeType: stored?.mimeType ?? (imageBase64 ? 'image/webp' : 'application/pdf'), storageKey: stored?.storageKey ?? null, pdfBase64, imageBase64, byteSize, hash: createHash('sha256').update(storedBytes).digest('hex') }).returning();
      return { id: asset!.id, name: asset!.name, role: asset!.role, mimeType: asset!.mimeType };
    });
  } catch (e) {
    if (stored) {
      await deleteOnboardingMediaFile(stored.storageKey, { salonId: actor.salonId }).catch(() => {});
    }
    throw e;
  }
}
export async function assetDataUrl(asset: typeof assets.$inferSelect) {
  const bytes = asset.storageKey ? await readOnboardingMediaFile(asset.storageKey, { salonId: asset.salonId }) : Buffer.from(asset.imageBase64 ?? asset.pdfBase64!, 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== asset.hash) {
    throw new SetupError('INVALID', 'A saved image changed or is unavailable. Please upload it again.');
  }
  return `data:${asset.mimeType};base64,${bytes.toString('base64')}`;
}
