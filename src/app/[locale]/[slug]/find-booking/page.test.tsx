import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FindBookingPage from './page';

const { requirePublishedTenantSalon, findBookingFormSpy } = vi.hoisted(() => ({
  requirePublishedTenantSalon: vi.fn(),
  findBookingFormSpy: vi.fn(),
}));

vi.mock('server-only', () => ({}));

// S3 (Stage 1): the page now resolves its salon through the publication guard
// instead of `getSalonBySlug`. Mocked here because `@/libs/tenant` transitively
// imports `@/libs/pageAppearance` -> `@/libs/DB`; the guard's own behaviour is
// unit-tested in `src/libs/stage1.routeTaxonomy.test.ts`.
vi.mock('@/libs/tenant', () => ({
  requirePublishedTenantSalon,
}));

// `@/libs/bookingPageContent` starts with `import 'server-only'`
// (transitively `@/libs/DB`) — mocked so this page-level test never touches
// the real DB module, same pattern as `book/confirm/page.test.tsx` and
// `PublicSalonPageShell.test.tsx`. Defaults to `full_address`; individual
// tests override with `mockReturnValueOnce`.
const { resolveBookingPageContent } = vi.hoisted(() => ({
  resolveBookingPageContent: vi.fn(() => ({
    version: 1,
    draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
    live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' },
  })),
}));

vi.mock('@/libs/bookingPageContent', () => ({
  resolveBookingPageContent,
}));

vi.mock('./FindBookingForm', () => ({
  FindBookingForm: (props: Record<string, unknown>) => {
    findBookingFormSpy(props);
    return <div>Find booking form</div>;
  },
}));

/**
 * THE DEFECT (post-launch privacy hotfix): this PUBLIC, unauthenticated
 * "find my booking" page previously passed `salon.phone` straight through
 * to `FindBookingForm`'s `salonPhone` prop with NO redaction at all — no
 * `locationDisplayMode` was even resolved on this route. `FindBookingForm`
 * renders that value verbatim in two `tel:` links. For a `city_only`
 * home-based solo tech, `salon.phone` IS the personal mobile tied to the
 * same private residence the address control is supposed to protect.
 */
describe('FindBookingPage phone privacy (locationDisplayMode)', () => {
  const PRIVATE_PHONE = '+14165550199';

  function bookingPageContentReturn(mode: 'full_address' | 'city_only') {
    return {
      version: 1 as const,
      draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: mode },
      live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: mode },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveBookingPageContent.mockReturnValue(bookingPageContentReturn('full_address'));
    requirePublishedTenantSalon.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      name: 'Salon A',
      phone: PRIVATE_PHONE,
      publicationStatus: 'published',
      settings: null,
    });
  });

  it('full_address (default/control) passes the exact salon phone through unredacted — proves the city_only assertion below is not vacuous', async () => {
    const element = await FindBookingPage({ params: { slug: 'salon-a' } });
    render(element);

    expect(screen.getByText('Find booking form')).toBeInTheDocument();
    expect(findBookingFormSpy).toHaveBeenCalledWith(expect.objectContaining({
      salonSlug: 'salon-a',
      salonPhone: PRIVATE_PHONE,
    }));
  });

  it('city_only redacts salonPhone to null — the exact string never reaches the FindBookingForm props', async () => {
    resolveBookingPageContent.mockReturnValue(bookingPageContentReturn('city_only'));

    const element = await FindBookingPage({ params: { slug: 'salon-a' } });
    render(element);

    expect(findBookingFormSpy).toHaveBeenCalledWith(expect.objectContaining({
      salonSlug: 'salon-a',
      salonPhone: null,
    }));
    expect(JSON.stringify(findBookingFormSpy.mock.calls.at(-1)![0])).not.toContain(PRIVATE_PHONE);
  });

  /**
   * S3 (Stage 1) — BEHAVIOUR CHANGE, deliberately replacing a previously green
   * assertion.
   *
   * This case used to assert that an unresolvable slug still RENDERED the form
   * with `salonPhone: null`. That was the shape of the defect: the route had no
   * gate at all, so an unpublished salon rendered here at HTTP 200 and exposed
   * its identity and phone. The guard now 404s both the unpublished and the
   * nonexistent case, and does so identically so neither can be distinguished.
   */
  it('an unpublished or nonexistent salon 404s instead of rendering', async () => {
    requirePublishedTenantSalon.mockRejectedValue(new Error('NEXT_NOT_FOUND'));

    await expect(FindBookingPage({ params: { slug: 'unknown-salon' } }))
      .rejects
      .toThrow('NEXT_NOT_FOUND');

    expect(findBookingFormSpy).not.toHaveBeenCalled();
  });
});
