/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  compileParse: vi.fn(),
  enabled: vi.fn(() => true),
  getAdmin: vi.fn(),
  getClaimed: vi.fn(),
  mediaRecords: vi.fn(),
  model: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  snapshotParse: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  isOnboardingV1IntegrationEnabled: mocks.enabled,
}));
vi.mock('@/features/onboarding-v1-integration/contracts', () => ({
  onboardingCompiledSiteDocumentSchema: { safeParse: mocks.compileParse },
  onboardingPersistedSnapshotSchema: { safeParse: mocks.snapshotParse },
}));
vi.mock('@/features/onboarding-v1-integration/persistence.server', () => ({
  getClaimedOnboardingSite: mocks.getClaimed,
}));
vi.mock('@/features/onboarding-v1-integration/saved-preview', () => ({
  createSavedPreviewMediaRecords: mocks.mediaRecords,
  createSavedSitePreviewModel: mocks.model,
}));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: mocks.getAdmin,
}));
vi.mock('./SavedSitePreviewClient', () => ({
  SavedSitePreviewClient: () => null,
}));

import SavedWebsitePreviewPage from './page';

const siteId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.getAdmin.mockResolvedValue({ id: 'admin-1' });
  mocks.compileParse.mockReturnValue({ data: { compiled: true }, success: true });
  mocks.snapshotParse.mockReturnValue({ data: { snapshot: true }, success: true });
  mocks.mediaRecords.mockReturnValue([{
    altText: 'Saved logo',
    assetId: '33333333-3333-4333-8333-333333333333',
    fileName: 'logo.webp',
    fileSize: 42,
    height: 200,
    localItemId: 'browser-local-logo',
    mimeType: 'image/webp',
    publicUrl: '/api/onboarding/v1/media/33333333-3333-4333-8333-333333333333',
    role: 'logo',
    sortOrder: 0,
    width: 400,
  }]);
  mocks.model.mockReturnValue({ document: {}, media: [], state: {} });
  mocks.getClaimed.mockResolvedValue({
    media: [{
      altText: 'Saved logo',
      claimStatus: 'ready',
      fileName: 'logo.webp',
      fileSize: null,
      height: 200,
      id: '33333333-3333-4333-8333-333333333333',
      localItemId: 'browser-local-logo',
      metadata: { byteSize: 42 },
      mimeType: 'image/webp',
      publicUrl: '/api/onboarding/v1/media/33333333-3333-4333-8333-333333333333',
      role: 'logo',
      sortOrder: 0,
      storageKey: 'tenant/site/logo.webp',
      width: 400,
    }],
    revision: { document: {}, revision: 4, snapshot: {} },
    site: {
      id: siteId,
      salonPublicationStatus: 'draft',
      salonSlug: 'isla-nails',
    },
  });
});

describe('saved website Preview route', () => {
  it('loads the exact persisted revision through a tenant-scoped membership query', async () => {
    const element = await SavedWebsitePreviewPage({
      params: Promise.resolve({ locale: 'en', siteId }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.getClaimed).toHaveBeenCalledWith({ adminId: 'admin-1', siteId });
    expect(mocks.model).toHaveBeenCalledWith({
      document: { compiled: true },
      media: [expect.objectContaining({
        assetId: '33333333-3333-4333-8333-333333333333',
        localItemId: 'browser-local-logo',
        publicUrl: '/api/onboarding/v1/media/33333333-3333-4333-8333-333333333333',
      })],
      snapshot: { snapshot: true },
    });
    expect(element.props).toMatchObject({
      embedded: false,
      revision: 4,
      salonSlug: 'isla-nails',
      setupAvailable: true,
      siteId,
      showAuditRevision: false,
    });
  });

  it('supports a customer-only embedded saved revision and development audit label', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'test' });
    const element = await SavedWebsitePreviewPage({
      params: Promise.resolve({ locale: 'en', siteId }),
      searchParams: Promise.resolve({ audit: '1', embed: '1' }),
    });
    Object.assign(process.env, { NODE_ENV: priorNodeEnv });

    expect(element.props).toMatchObject({
      embedded: true,
      showAuditRevision: true,
    });
  });

  it('fails closed when the site is outside the signed-in membership', async () => {
    mocks.getClaimed.mockResolvedValue(null);

    await expect(SavedWebsitePreviewPage({
      params: Promise.resolve({ locale: 'en', siteId }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow('NOT_FOUND');
  });
});
