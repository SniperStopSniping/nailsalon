/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  compileParse: vi.fn(),
  createMedia: vi.fn(),
  createModel: vi.fn(),
  createPersistable: vi.fn(),
  fingerprint: vi.fn(),
  getClaimed: vi.fn(),
  snapshotParse: vi.fn(),
}));

vi.mock('./contracts', () => ({
  onboardingCompiledSiteDocumentSchema: { safeParse: mocks.compileParse },
  onboardingPersistedSnapshotSchema: { safeParse: mocks.snapshotParse },
}));
vi.mock('./payload-fingerprint', () => ({
  fingerprintOnboardingPayload: mocks.fingerprint,
}));
vi.mock('./persistence.server', () => ({
  getClaimedOnboardingSite: mocks.getClaimed,
}));
vi.mock('./saved-preview', () => ({
  createSavedPreviewMediaRecords: mocks.createMedia,
  createSavedSitePreviewModel: mocks.createModel,
}));
vi.mock('./snapshot', () => ({
  createPersistableOnboardingDraft: mocks.createPersistable,
}));

import { loadInitialOnboardingResumeDraft } from './resume.server';

const siteId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClaimed.mockResolvedValue({
    media: [{ id: 'media-row' }],
    revision: { document: {}, revision: 7, snapshot: {} },
    site: { id: siteId },
  });
  mocks.snapshotParse.mockReturnValue({
    data: { site: { palettePresetId: 'luster_berry' } },
    success: true,
  });
  mocks.compileParse.mockReturnValue({
    data: {
      builderDocument: { pages: [], siteId: 'saved-site', unusedSections: [] },
      compiled: true,
    },
    success: true,
  });
  mocks.createMedia.mockReturnValue([{
    assetId: 'media-ready',
    localItemId: 'logical-media',
  }]);
  mocks.createModel.mockReturnValue({
    document: { pages: [], siteId: 'saved-site' },
    media: [{ assetId: 'media-ready' }],
    state: {},
  });
  mocks.createPersistable.mockReturnValue({ snapshot: { roundTrip: true } });
  mocks.fingerprint.mockReturnValue('0123456789abcdef');
});

describe('secure account-backed onboarding resume loader', () => {
  it('requires owner membership, the exact current revision, and an unpublished draft', async () => {
    await expect(loadInitialOnboardingResumeDraft({
      adminId: 'admin-owner',
      siteId,
      verifiedRevision: 7,
    })).resolves.toMatchObject({
      document: { siteId: 'saved-site' },
      media: [{ assetId: 'media-ready', localItemId: 'logical-media' }],
      payloadFingerprint: '0123456789abcdef',
      siteId,
      verifiedRevision: 7,
    });

    expect(mocks.getClaimed).toHaveBeenCalledWith({
      adminId: 'admin-owner',
      expectedRevision: 7,
      ownerOnly: true,
      requireUnpublishedDraft: true,
      siteId,
    });
    expect(mocks.createModel).toHaveBeenCalledWith({
      document: {
        builderDocument: { pages: [], siteId: 'saved-site', unusedSections: [] },
        compiled: true,
      },
      media: [{ assetId: 'media-ready', localItemId: 'logical-media' }],
      snapshot: { site: { palettePresetId: 'luster_berry' } },
    });
  });

  it('rejects sites filtered out by membership, publication, or revision CAS', async () => {
    mocks.getClaimed.mockResolvedValue(null);

    await expect(loadInitialOnboardingResumeDraft({
      adminId: 'admin-non-owner',
      siteId,
      verifiedRevision: 6,
    })).resolves.toBeNull();

    expect(mocks.snapshotParse).not.toHaveBeenCalled();
  });

  it('rejects invalid persisted snapshot or document data', async () => {
    mocks.snapshotParse.mockReturnValue({ error: {}, success: false });

    await expect(loadInitialOnboardingResumeDraft({
      adminId: 'admin-owner',
      siteId,
      verifiedRevision: 7,
    })).resolves.toBeNull();
  });

  it('rejects a preview projection that cannot round-trip to the persisted fingerprint', async () => {
    mocks.fingerprint
      .mockReturnValueOnce('0123456789abcdef')
      .mockReturnValueOnce('fedcba9876543210');

    await expect(loadInitialOnboardingResumeDraft({
      adminId: 'admin-owner',
      siteId,
      verifiedRevision: 7,
    })).resolves.toBeNull();
  });
});
