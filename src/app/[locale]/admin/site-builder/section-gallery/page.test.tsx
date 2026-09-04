/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  getAdmin: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock('@/features/section-library-v1/config.server', () => ({
  isSectionLibraryV1Enabled: mocks.enabled,
}));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: mocks.getAdmin,
}));
vi.mock('./SectionGalleryClient', () => ({
  SectionGalleryClient: () => null,
}));

import SectionGalleryPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.getAdmin.mockResolvedValue({ id: 'admin-1' });
});

describe('SectionGalleryPage gating', () => {
  it('is not found while the section library flag is dark', async () => {
    mocks.enabled.mockReturnValue(false);

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: 'en' }) }))
      .rejects.toThrow('NOT_FOUND');

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.getAdmin).not.toHaveBeenCalled();
  });

  it('redirects anonymous visitors to owner sign-in with a safe locale', async () => {
    mocks.getAdmin.mockResolvedValue(null);

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: 'fr' }) }))
      .rejects.toThrow('REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/fr/owner-sign-in');

    mocks.getAdmin.mockResolvedValue(null);

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: '../evil' }) }))
      .rejects.toThrow('REDIRECT');

    expect(mocks.redirect).toHaveBeenLastCalledWith('/en/owner-sign-in');
  });

  it('renders the gallery for an authenticated owner when enabled', async () => {
    const element = await SectionGalleryPage({ params: Promise.resolve({ locale: 'en' }) });

    expect(element).toBeTruthy();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
