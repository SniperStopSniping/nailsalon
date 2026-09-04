/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  renderBookServicePage,
} = vi.hoisted(() => ({
  renderBookServicePage: vi.fn(),
}));

vi.mock('@/app/(unauth)/book/service/BookServicePageServer', () => ({
  renderBookServicePage,
}));

import OwnerBookingPagePreview from './page';

const TARGET_SLUG = 'target-salon';

async function renderPreview({
  routeSlug = TARGET_SLUG,
  salonSlugQuery,
}: {
  routeSlug?: string;
  salonSlugQuery?: string;
} = {}) {
  return OwnerBookingPagePreview({
    params: Promise.resolve({ locale: 'en', slug: routeSlug }),
    searchParams: Promise.resolve(salonSlugQuery ? { salonSlug: salonSlugQuery } : {}),
  });
}

describe('private Owner booking-page DRAFT preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderBookServicePage.mockResolvedValue('CANONICAL_BOOKING_PAGE');
  });

  it('invokes the one canonical server renderer in required-DRAFT mode', async () => {
    await expect(renderPreview()).resolves.toBe('CANONICAL_BOOKING_PAGE');

    expect(renderBookServicePage).toHaveBeenCalledWith({
      params: { locale: 'en', slug: TARGET_SLUG },
      searchParams: {},
    }, { requireOwnerDraftPreview: true });
  });

  it('keeps the route slug authoritative over a conflicting salonSlug query', async () => {
    await expect(renderPreview({ salonSlugQuery: 'other-salon' }))
      .resolves.toBe('CANONICAL_BOOKING_PAGE');

    expect(renderBookServicePage).toHaveBeenCalledWith(expect.objectContaining({
      params: { locale: 'en', slug: TARGET_SLUG },
      searchParams: { salonSlug: 'other-salon' },
    }), { requireOwnerDraftPreview: true });
  });
});
