/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  requireSalon: vi.fn(),
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
  requireAdminSalonForSlug: mocks.requireSalon,
}));
vi.mock('./SectionGalleryClient', () => ({
  SectionGalleryClient: () => null,
}));

import SectionGalleryPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.requireSalon.mockResolvedValue({
    salon: { id: 'salon_1', slug: 'salon-a', name: 'Salon A' },
    error: null,
  });
});

describe('SectionGalleryPage gating', () => {
  it('is not found while the section library flag is dark', async () => {
    mocks.enabled.mockReturnValue(false);

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: 'en' }) }))
      .rejects.toThrow('NOT_FOUND');

    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.requireSalon).not.toHaveBeenCalled();
  });

  it('redirects anonymous visitors to owner sign-in with a safe locale', async () => {
    mocks.requireSalon.mockResolvedValue({
      salon: null,
      error: { status: 401 },
    });

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: 'fr' }) }))
      .rejects.toThrow('REDIRECT');

    expect(mocks.redirect).toHaveBeenCalledWith('/fr/owner-sign-in');

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: '../evil' }) }))
      .rejects.toThrow('REDIRECT');

    expect(mocks.redirect).toHaveBeenLastCalledWith('/en/owner-sign-in');
  });

  /*
    AG-w2-settings-integrations-15: an authenticated admin session was the only
    gate, so a signed-in admin who manages no salon — or who names a salon they
    do not manage — still reached a salon-shaped preview surface.
  */
  it('is not found for an admin who does not manage the requested salon', async () => {
    mocks.requireSalon.mockResolvedValue({
      salon: null,
      error: { status: 403 },
    });

    await expect(SectionGalleryPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ salon: 'someone-elses-salon' }),
    })).rejects.toThrow('NOT_FOUND');

    expect(mocks.requireSalon).toHaveBeenCalledWith('someone-elses-salon', {
      persistActiveSalon: false,
    });
  });

  it('is not found for an admin with no salon at all', async () => {
    mocks.requireSalon.mockResolvedValue({ salon: null, error: null });

    await expect(SectionGalleryPage({ params: Promise.resolve({ locale: 'en' }) }))
      .rejects.toThrow('NOT_FOUND');
  });

  it('renders the gallery for an owner of a salon when enabled', async () => {
    const element = await SectionGalleryPage({ params: Promise.resolve({ locale: 'en' }) });

    expect(element).toBeTruthy();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
