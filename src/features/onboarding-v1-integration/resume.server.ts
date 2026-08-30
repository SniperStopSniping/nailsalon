import 'server-only';

import type { SiteBuilderDocument } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/types';
import {
  onboardingCompiledSiteDocumentSchema,
  onboardingPersistedSnapshotSchema,
} from './contracts';
import { fingerprintOnboardingPayload } from './payload-fingerprint';
import { getClaimedOnboardingSite } from './persistence.server';
import type { InitialOnboardingResumeDraft } from './resume-draft';
import {
  createSavedPreviewMediaRecords,
  createSavedSitePreviewModel,
} from './saved-preview';
import { createPersistableOnboardingDraft } from './snapshot';

const getCustomDesignSettings = (document: SiteBuilderDocument) => {
  const section = document.pages
    .flatMap(page => page.sections)
    .find(candidate => candidate.sectionType === 'custom_design');
  return section?.sectionType === 'custom_design' ? section.settings : null;
};

/**
 * Loads one exact current draft through the existing tenant-scoped site
 * loader. Owner membership, current-revision CAS, and unpublished status are
 * resolved in the same database query; URL parameters never authorize access.
 */
export async function loadInitialOnboardingResumeDraft(input: {
  adminId: string;
  siteId: string;
  verifiedRevision: number;
}): Promise<InitialOnboardingResumeDraft | null> {
  const claimed = await getClaimedOnboardingSite({
    adminId: input.adminId,
    expectedRevision: input.verifiedRevision,
    ownerOnly: true,
    requireUnpublishedDraft: true,
    siteId: input.siteId,
  });
  if (!claimed) {
    return null;
  }

  const [snapshot, document] = [
    onboardingPersistedSnapshotSchema.safeParse(claimed.revision.snapshot),
    onboardingCompiledSiteDocumentSchema.safeParse(claimed.revision.document),
  ];
  if (!snapshot.success || !document.success) {
    return null;
  }

  const media = createSavedPreviewMediaRecords(claimed.media);
  const model = createSavedSitePreviewModel({
    document: document.data,
    media,
    snapshot: snapshot.data,
  });
  // The saved-site Preview intentionally renders Custom Design through
  // server media IDs. The editable Builder must retain the logical image IDs
  // persisted in the accepted universal document; the resumed repository
  // resolves those logical IDs to the tenant-authorized media endpoints.
  const editableDocument = structuredClone(document.data.builderDocument);
  const payloadFingerprint = fingerprintOnboardingPayload(snapshot.data);

  // Refuse to hydrate if the saved-preview projection cannot round-trip back
  // to the exact persisted snapshot. This catches stale adapter mappings
  // before browser storage can become an apparent editable authority.
  try {
    const roundTrip = createPersistableOnboardingDraft(
      model.state,
      snapshot.data.site.palettePresetId,
      getCustomDesignSettings(editableDocument),
      editableDocument,
    );
    if (fingerprintOnboardingPayload(roundTrip.snapshot) !== payloadFingerprint) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    document: editableDocument,
    media,
    payloadFingerprint,
    siteId: claimed.site.id,
    state: model.state,
    verifiedRevision: claimed.revision.revision,
  };
}
