import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { onboardingSiteMediaSchema, onboardingSiteRevisionSchema, onboardingSiteSchema } from '@/models/Schema';

import { onboardingCompiledSiteDocumentSchema } from './contracts';

type PublicationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class WebsitePublishReadinessError extends Error {
  constructor(
    readonly code: 'DESIGN_IMAGES_PENDING' | 'DESIGN_PUBLICATION_UNAVAILABLE' | 'SAVED_DESIGN_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'WebsitePublishReadinessError';
  }
}

/** Runs after the salon lock, before any first-publication write. */
export async function assertFirstLaunchDesignReady(
  transaction: PublicationTransaction,
  salonId: string,
): Promise<void> {
  const [site] = await transaction.select().from(onboardingSiteSchema).where(and(
    eq(onboardingSiteSchema.salonId, salonId),
    eq(onboardingSiteSchema.isCurrent, true),
  )).for('update').limit(1);
  // Legacy/manual businesses without an account-backed onboarding site keep
  // the existing publication path.
  if (!site) {
    return;
  }
  const [revision] = await transaction.select({ id: onboardingSiteRevisionSchema.id, document: onboardingSiteRevisionSchema.document })
    .from(onboardingSiteRevisionSchema).where(and(
      eq(onboardingSiteRevisionSchema.salonId, salonId),
      eq(onboardingSiteRevisionSchema.siteId, site.id),
      eq(onboardingSiteRevisionSchema.revision, site.currentRevision),
    )).limit(1);
  const document = onboardingCompiledSiteDocumentSchema.safeParse(revision?.document);
  if (!revision || !document.success) {
    throw new WebsitePublishReadinessError('SAVED_DESIGN_INVALID', 'Your saved website could not be checked. Return to your setup and save it again before publishing.');
  }
  const designSections = document.data.pages.filter(page => page.visible).flatMap(page => (
    page.sections.filter(section => section.visible && section.type === 'custom_design')
  ));
  if (designSections.some(section => !section.customDesignSettings)) {
    throw new WebsitePublishReadinessError('SAVED_DESIGN_INVALID', 'Your saved design could not be checked. Return to your setup and save it again before publishing.');
  }
  const imageIds = new Set(designSections.flatMap(section => section.customDesignSettings?.images.map(image => image.id) ?? []));
  if (imageIds.size === 0) {
    return;
  }
  const media = await transaction.select().from(onboardingSiteMediaSchema).where(and(
    eq(onboardingSiteMediaSchema.salonId, salonId),
    eq(onboardingSiteMediaSchema.siteId, site.id),
    eq(onboardingSiteMediaSchema.revisionId, revision.id),
  ));
  const allReady = [...imageIds].every(id => media.some(item => (
    item.localItemId === id && item.role === 'custom_design'
    && item.claimStatus === 'ready' && Boolean(item.storageKey)
  )));
  if (!allReady) {
    throw new WebsitePublishReadinessError('DESIGN_IMAGES_PENDING', 'Your design images have not finished saving. Return to your setup and retry the images before publishing.');
  }
  // A saved prototype preview is not a public implementation. Keep this
  // explicit until the manual artwork is connected to the public renderer;
  // never silently substitute Quick Book and report design publication.
  throw new WebsitePublishReadinessError('DESIGN_PUBLICATION_UNAVAILABLE', 'Your Canva design is not ready to go live yet. Your saved draft is safe. Return to your setup.');
}
