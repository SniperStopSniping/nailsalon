import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createDemoOnboardingState,
  DEMO_SITE_CONTENT,
} from '../../onboarding/model/demo-content';
import type { OnboardingLabState } from '../../onboarding/model/types';
import {
  OnboardingSitePreview,
} from '../../onboarding/preview/OnboardingSitePreview';
import {
  getBeforeYouBookEntries,
} from '../../onboarding/preview/section-renderers';
import type { SitePlanPage } from '../site-plan';
import { initializeStarter } from '../starters';
import type {
  LibrarySectionType,
  SectionInstance,
  SiteBuilderDocument,
} from '../types';
import { getSectionRegistryEntry } from './registry';
import type { SiteContentCollections } from './site-content';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

type RenderSectionOptions = {
  settings?: Record<string, unknown>;
  siteContent?: SiteContentCollections;
  state?: OnboardingLabState;
};

const renderLibrarySection = (
  type: LibrarySectionType,
  options: RenderSectionOptions = {},
) => {
  const entry = getSectionRegistryEntry(type);
  const section: SectionInstance = {
    id: `v1-${type}`,
    label: entry.label,
    order: 0,
    sectionType: type,
    settings: entry.normalize({
      ...entry.defaultSettings(),
      ...options.settings,
    }),
    visible: true,
  } as SectionInstance;
  const starter = initializeStarter('quick_book');
  const page = {
    ...starter.pages[0]!,
    id: 'v1-renderer-page',
    name: 'Home',
    sections: [section],
    slug: '',
  };
  const document: SiteBuilderDocument = {
    ...starter,
    navigation: { ...starter.navigation, enabled: false, items: [] },
    pages: [page],
    siteContent: options.siteContent ?? DEMO_SITE_CONTENT,
  };
  const customerPagePlan: SitePlanPage[] = [{
    id: page.id,
    isHome: true,
    label: page.name,
    order: 0,
    sections: [{
      attachedToPrevious: false,
      id: section.id,
      injected: false,
      label: section.label,
      section,
      sectionType: section.sectionType,
      surface: entry.surface,
    }],
    slug: '',
    visibleInNavigation: true,
  }];
  const state = options.state ?? createDemoOnboardingState();
  state.recipe = {
    ...state.recipe,
    aboutEnabled: true,
    galleryEnabled: true,
    policiesEnabled: true,
  };

  return render(
    <OnboardingSitePreview
      customerPagePlan={customerPagePlan}
      document={document}
      interactionMode="interactive"
      label={`${entry.label} renderer preview`}
      state={state}
    />,
  );
};

describe('locked V1 customer section renderers', () => {
  it('publishes no more than three real Reviews', () => {
    const fourthReview = {
      authorName: 'Fourth Client',
      id: 'review-four',
      quote: 'This fourth review belongs behind a future Read more experience.',
      rating: 5,
      source: 'client' as const,
      visible: true,
    };
    const siteContent = {
      ...DEMO_SITE_CONTENT,
      reviews: [...DEMO_SITE_CONTENT.reviews, fourthReview],
    };

    const { container } = renderLibrarySection('reviews', {
      settings: { reviewIds: siteContent.reviews.map(review => review.id) },
      siteContent,
    });

    expect(container.querySelectorAll('.customer-lib-review-card')).toHaveLength(3);
    expect(screen.queryByText(fourthReview.quote, { exact: false })).not.toBeInTheDocument();
  });

  it('keeps Team informational and renders no competing booking action', () => {
    renderLibrarySection('team', {
      settings: { memberIds: DEMO_SITE_CONTENT.staff.map(member => member.id) },
    });

    const team = screen.getByRole('region', { name: 'Team' });

    expect(within(team).getByText('Isla Moreno')).toBeVisible();
    expect(within(team).queryByRole('link', { name: /book with/iu })).not.toBeInTheDocument();
    expect(team.querySelector('a[href="#booking"]')).toBeNull();
  });

  it('resolves one Before You Book presentation from the shared policy state', () => {
    const state = createDemoOnboardingState();
    const entries = getBeforeYouBookEntries(state.profile.policies);

    expect(entries[0]).toMatchObject({
      contentKey: 'deposit_cancellation_policy',
      heading: 'Deposits & cancellations',
      id: 'deposits_cancellations',
    });
    expect(entries.some(entry => entry.id === 'late_arrivals')).toBe(true);

    const { container } = renderLibrarySection('policies', { state });
    const policies = screen.getByRole('region', { name: 'Before you book' });

    expect(within(policies).getByRole('heading', { name: 'Before you book' })).toBeVisible();
    expect(within(policies).getByText('Deposits & cancellations')).toBeVisible();
    expect(within(policies).getByText('Late arrivals')).toBeVisible();
    expect(container.querySelectorAll('[data-policy="deposits_cancellations"]'))
      .toHaveLength(1);
    expect(container.querySelectorAll('[data-content-key="deposit_cancellation_policy"]'))
      .toHaveLength(1);
    expect(container.querySelectorAll('[data-content-key="before_you_book_policies"]'))
      .toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Deposits and cancellations' }))
      .not.toBeInTheDocument();
  });

  it('makes Visit & Contact the sole location, hours, and contact presentation without Book', () => {
    const { container } = renderLibrarySection('visit_us');
    const visit = screen.getByRole('region', { name: 'Visit and contact' });

    expect(within(visit).getByRole('heading', { name: 'Plan your visit' })).toBeVisible();
    expect(within(visit).getByRole('heading', { level: 3, name: 'Visit' })).toBeVisible();
    expect(within(visit).getByRole('heading', { level: 3, name: 'Hours' })).toBeVisible();
    expect(within(visit).getByRole('heading', { level: 3, name: 'Contact' })).toBeVisible();
    expect(within(visit).getByRole('link', { name: /instagram/iu })).toBeVisible();
    expect(visit.querySelector('a[href="#booking"]')).toBeNull();
    expect(container.querySelectorAll('[data-content-key="location"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-content-key="instagram"]')).toHaveLength(1);
  });

  it('describes Booking-only contact without adding another Book CTA', () => {
    const state = createDemoOnboardingState();
    state.profile.bookingOnlyContact = true;

    renderLibrarySection('visit_us', { state });
    const visit = screen.getByRole('region', { name: 'Visit and contact' });

    expect(within(visit).getByText('Online booking is the best way to reach us.'))
      .toBeVisible();
    expect(within(visit).queryByRole('link', { name: 'Book now' })).not.toBeInTheDocument();
    expect(visit.querySelector('a[href="#booking"]')).toBeNull();
  });

  it('uses only the privacy-safe public location in the Quick Book map', () => {
    const state = createDemoOnboardingState();
    state.recipe.starter = 'quick_book';
    state.profile.location = {
      ...state.profile.location,
      addressVisibility: 'after_booking',
      cityOrArea: 'Toronto',
      exactAddress: '999 Private Lane, Toronto',
    };

    const { container } = renderLibrarySection('visit_us', { state });
    const map = screen.getByTitle('Map showing Toronto');

    expect(map).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=Toronto&output=embed',
    );
    expect(container.innerHTML).not.toContain('999 Private Lane');
  });

  it('includes the exact address in the Quick Book map only when it is public', () => {
    const state = createDemoOnboardingState();
    state.recipe.starter = 'quick_book';
    state.profile.location = {
      ...state.profile.location,
      addressVisibility: 'public',
      cityOrArea: 'Toronto',
      exactAddress: '880 Ellesmere Rd, Unit 2',
    };

    renderLibrarySection('visit_us', { state });

    expect(screen.getByTitle('Map showing 880 Ellesmere Rd, Unit 2')).toHaveAttribute(
      'src',
      'https://www.google.com/maps?q=880%20Ellesmere%20Rd%2C%20Unit%202&output=embed',
    );
  });

  it('does not add the Quick Book map to another website type', () => {
    const state = createDemoOnboardingState();
    state.recipe.starter = 'one_page';

    renderLibrarySection('visit_us', { state });

    expect(screen.queryByTitle(/Map showing/iu)).not.toBeInTheDocument();
  });
});
