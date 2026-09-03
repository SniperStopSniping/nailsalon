import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import type { CustomDesignImageItem } from '../../custom-design/model/types';
import {
  initializeStarter,
  moveSectionToPage,
  removeSection,
  setSectionVisible,
} from '../../model';
import { getSectionRegistryEntry } from '../../model/section-library/registry';
import {
  buildCustomerPagePlan,
  type SitePlanPage,
} from '../../model/site-plan';
import type {
  CustomDesignSectionInstance,
  PageDocument,
  SectionInstance,
  SectionType,
  SiteBuilderDocument,
} from '../../model/types';
import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../model/site-library-context';
import type {
  AboutPresetId,
  OnboardingLabState,
  QuickBookLayoutId,
} from '../model/types';
import { parseOnboardingState } from '../storage/storage';
import {
  calculateOnboardingPreviewScale,
  getOnboardingDocumentBookingSequence,
  ONBOARDING_PREVIEW_VIEWPORTS,
  OnboardingSitePreview,
} from './OnboardingSitePreview';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: (assetIds: readonly string[]) => new Map(
    assetIds.map((assetId) => [assetId, {
      original: {
        assetId,
        kind: 'original',
        status: 'ready',
        url: `blob:${assetId}-original`,
      },
      thumbnail: {
        assetId,
        kind: 'thumbnail',
        status: 'ready',
        url: `blob:${assetId}-thumbnail`,
      },
    }]),
  ),
}));

const customImage = (id: string): CustomDesignImageItem => ({
  altText: `${id} Canva design`,
  aspectRatio: 0.75,
  assetId: `asset-${id}`,
  decorative: false,
  fileName: `${id}.png`,
  fileSize: 1_024,
  height: 1_600,
  id: `image-${id}`,
  interactiveAreas: [],
  mimeType: 'image/png',
  width: 1_200,
});

/** The one customer selection ladder the preview itself renders from. */
const customerPagePlanFor = (
  document: SiteBuilderDocument,
  state: OnboardingLabState,
): SitePlanPage[] => buildCustomerPagePlan(document, {
  context: deriveSiteLibraryContext(state, document),
  toggles: deriveSitePlanToggles(state),
});

const planTypes = (plan: SitePlanPage[]): SectionType[] =>
  plan.flatMap(page => page.sections.map(section => section.sectionType));

const planIds = (plan: SitePlanPage[]): string[] =>
  plan.flatMap(page => page.sections.map(section => section.id));

const sectionOn = (page: PageDocument, sectionType: SectionType): SectionInstance => {
  const section = page.sections.find(candidate => candidate.sectionType === sectionType);
  if (!section) throw new Error(`No ${sectionType} section on page ${page.name}`);
  return section;
};

/** Flips every Deposits & Cancellations section onto one wording mode. */
const withDepositsWordingMode = (
  document: SiteBuilderDocument,
  wordingMode: 'full' | 'summary',
): SiteBuilderDocument => {
  const next = structuredClone(document);
  for (const page of next.pages) {
    page.sections = page.sections.map(section => (
      section.sectionType === 'deposits_cancellations'
        ? { ...section, settings: { ...section.settings, wordingMode } }
        : section
    ));
  }
  return next;
};

const galleryFixtureImage = (id: string) => ({
  altText: 'Example nail set',
  fileName: 'example-gallery.jpg',
  id,
  mimeType: 'image/jpeg',
  previewUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
  source: 'fixture' as const,
});

const customSection = (
  id: string,
  order: number,
): CustomDesignSectionInstance => ({
  id,
  label: `Canva ${id}`,
  order,
  sectionType: 'custom_design',
  settings: {
    ...createDefaultCustomDesignSettings(),
    images: [customImage(id)],
  },
  visible: true,
});

const QUICK_BOOK_LAYOUTS: readonly QuickBookLayoutId[] = [
  'compact_dropdown',
  'clean_card',
  'editorial',
  'hub_menu',
  'profile_story',
  'ultra_minimal',
];

describe('OnboardingSitePreview shared profile composition', () => {
  it.each([
    { logo: true, profilePhoto: true, scenario: 'both uploaded' },
    { logo: false, profilePhoto: true, scenario: 'profile only' },
    { logo: true, profilePhoto: false, scenario: 'logo only' },
    { logo: false, profilePhoto: false, scenario: 'neither uploaded' },
  ])('keeps Logo and Profile in their separate Quick Book identity roles for $scenario', ({ logo, profilePhoto, scenario }) => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.ownerName = 'Daniela';
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookProfile.showTechName = true;
    state.recipe.quickBookProfile.showTechPhoto = true;
    state.profile.logo = logo ? {
      fileName: 'isla-wordmark.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'logo-asset',
    } : undefined;
    state.profile.profilePhoto = profilePhoto ? {
      fileName: 'daniela-portrait.png',
      id: 'profile-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'profile-asset',
    } : undefined;

    render(
      <OnboardingSitePreview document={null} label={`${scenario} preview`} state={state} />,
    );
    const preview = screen.getByRole('region', { name: `${scenario} preview` });
    const profile = within(preview).getByRole('region', { name: 'Isla Nail Studio' });
    const brand = preview.querySelector('.onboarding-customer-brand');
    const headerLogo = brand?.querySelector<HTMLImageElement>('img[data-media-role="logo"]');
    const profilePhotoElement = profile.querySelector<HTMLImageElement>(
      'img[data-media-role="profile"]',
    );

    if (logo) {
      expect(headerLogo).toHaveAttribute('src', 'blob:logo-asset-thumbnail');
      expect(headerLogo).toHaveAttribute('alt', 'Isla Nail Studio logo');
    } else {
      expect(headerLogo ?? null).toBeNull();
      expect(brand?.querySelector('i') ?? null).toBeNull();
    }

    if (profilePhoto) {
      expect(profilePhotoElement).toHaveAttribute('src', 'blob:profile-asset-thumbnail');
      expect(profilePhotoElement).toHaveAttribute('alt', 'Daniela profile photo');
    } else {
      expect(profilePhotoElement).toBeNull();
      expect(within(profile).queryByRole('img', {
        name: 'Daniela portrait placeholder',
      })).not.toBeInTheDocument();
    }

    expect(brand?.querySelector('[data-media-role="profile"]') ?? null).toBeNull();
    expect(profilePhotoElement?.closest('.onboarding-customer-brand') ?? null).toBeNull();
    expect(profile.querySelectorAll('[data-media-role="logo"]')).toHaveLength(logo ? 1 : 0);
    expect(preview.querySelectorAll('[data-media-role="profile"]'))
      .toHaveLength(profilePhoto ? 1 : 0);
    expect(within(profile).getByRole('heading', { level: 1, name: 'Isla Nail Studio' }))
      .toBeVisible();
    expect(within(profile).getByText('Daniela')).toBeVisible();
    expect(within(preview).queryByRole('region', { name: 'About' }))
      .not.toBeInTheDocument();
  });

  it('renders a full Quick Book profile from valid shared data without duplicate public owners', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookProfile = {
      showBio: true,
      showBookingPolicy: true,
      showCancellationPolicy: true,
      showEmail: true,
      showHours: true,
      showInstagram: true,
      showLocation: true,
      showPhone: true,
      showReviews: true,
      showTechName: true,
      showTechPhoto: true,
    };
    state.profile.logo = {
      fileName: 'isla-wordmark.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'logo-asset',
    };
    state.profile.location.addressVisibility = 'public';
    state.profile.location.exactAddress = '880 Ellesmere Rd, Unit 2';
    state.profile.location.entranceInstructions = 'Inside TB Nails · Back entrance';
    state.profile.bookingOnlyContact = false;
    state.profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '',
      primaryNumber: '(647) 123-4567',
      textEnabled: true,
      useDifferentTextNumber: false,
    };
    state.profile.email = 'hello@islanails.com';
    state.reviewOptions.previewTimestamp = '2026-08-27T15:00:00.000Z';
    const document = initializeStarter('quick_book');
    document.siteContent.reviews = [{
      authorName: 'Ava',
      id: 'review-ava',
      quote: 'Beautiful work and a calm appointment.',
      rating: 5,
      source: 'client',
      visible: true,
    }];

    render(
      <OnboardingSitePreview document={document} label="Full Quick Book profile" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Full Quick Book profile' });
    const profile = within(preview).getByRole('region', { name: 'Isla Nail Studio' });
    const visit = within(preview).getByRole('region', { name: 'Visit and contact' });

    expect(within(profile).getByRole('img', { name: 'Isla Nail Studio logo' })).toBeVisible();
    expect(within(profile).getByRole('img', { name: 'Daniela portrait illustration' }))
      .toBeVisible();
    expect(within(profile).getByText('Daniela')).toBeVisible();
    expect(within(profile).getByRole('link', { name: /880 Ellesmere Rd, Unit 2/u }))
      .toHaveAttribute('href', expect.stringContaining('880%20Ellesmere'));
    expect(within(visit).getByText('Inside TB Nails · Back entrance')).toBeVisible();
    expect(within(profile).getByText('Open now')).toBeVisible();
    const phoneLinks = within(profile).getAllByRole('link', { name: /\(647\) 123-4567/u });
    expect(phoneLinks.some(link => link.getAttribute('href') === 'tel:6471234567')).toBe(true);
    expect(phoneLinks.some(link => link.getAttribute('href') === 'sms:6471234567')).toBe(true);
    expect(within(profile).getByRole('link', { name: /hello@islanails\.com/u }))
      .toHaveAttribute('href', 'mailto:hello@islanails.com');
    expect(profile.querySelector('[data-content-key="before_you_book_policies"] summary'))
      .toHaveTextContent('Policies');
    // Document-authored testimonial cards are not the verified aggregate used
    // by the real public Quick Book route, so the Lab must not invent parity.
    expect(within(profile).queryByText('5.0 ★ (1)')).not.toBeInTheDocument();
    expect(within(profile).getByRole('link', { name: '@islanail.studio' }))
      .toHaveAttribute('href', 'https://www.instagram.com/islanail.studio/');
    expect(within(profile).getByText(state.profile.about.shortBio)).toBeInTheDocument();
    expect(preview.querySelectorAll('[data-content-key="location"]')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="instagram"]')).toHaveLength(1);
    expect(within(preview).queryByRole('region', { name: 'About' })).not.toBeInTheDocument();
    expect(visit).toBeVisible();
  });

  it('renders the same final customer facts through all six Quick Book layouts', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.aboutEnabled = true;
    state.recipe.policiesEnabled = true;
    state.recipe.quickBookProfile = {
      ...state.recipe.quickBookProfile,
      showEmail: true,
      showHours: true,
      showInstagram: true,
      showLocation: true,
      showPhone: true,
      showTechName: true,
      showTechPhoto: true,
    };
    state.profile.location.addressVisibility = 'public';
    state.profile.location.exactAddress = '880 Ellesmere Rd, Unit 2';
    state.profile.bookingOnlyContact = false;
    state.profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '',
      primaryNumber: '(647) 123-4567',
      textEnabled: true,
      useDifferentTextNumber: false,
    };
    state.profile.email = 'hello@islanails.com';

    for (const layout of QUICK_BOOK_LAYOUTS) {
      const layoutState = structuredClone(state);
      layoutState.recipe.quickBookLayout = layout;
      const view = render(
        <OnboardingSitePreview
          document={initializeStarter('quick_book')}
          label={`${layout} final preview`}
          quickBookPhase="final"
          state={layoutState}
        />,
      );
      const preview = screen.getByRole('region', { name: `${layout} final preview` });
      const profile = within(preview).getByRole('region', { name: 'Isla Nail Studio' });
      const booking = within(preview).getByRole('region', { name: 'Booking' });
      const visit = within(preview).getByRole('region', { name: 'Visit and contact' });

      expect(profile).toHaveAttribute('data-preview-phase', 'final');
      expect(profile).toHaveAttribute('data-quick-book-layout', layout);
      expect(within(profile).getByRole('heading', { level: 1, name: 'Isla Nail Studio' }))
        .toBeVisible();
      expect(within(profile).getByRole('img', { name: 'Daniela portrait illustration' }))
        .toBeVisible();
      expect(profile.querySelector('[data-quick-book-fact="location"]'))
        .toHaveTextContent('880 Ellesmere Rd, Unit 2');
      expect(profile.querySelector('[data-quick-book-fact="hours"]'))
        .toHaveTextContent(/Open now|Closed/u);
      expect(profile).toHaveTextContent('@islanail.studio');
      expect(profile).toHaveTextContent('About Daniela');
      expect(profile).toHaveTextContent('Before you book');
      expect(profile).toHaveTextContent('(647) 123-4567');
      expect(profile).toHaveTextContent('hello@islanails.com');
      expect(preview.querySelectorAll('[aria-label="Booking"]')).toHaveLength(1);
      expect(preview.querySelectorAll('.customer-lib-visit')).toHaveLength(1);
      expect(preview.querySelectorAll('[data-content-key="service_catalogue"]')).toHaveLength(1);
      expect(preview.querySelectorAll('[data-content-key="before_you_book_policies"]'))
        .toHaveLength(1);
      expect(preview.querySelectorAll('[data-content-key="location"]')).toHaveLength(1);
      expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(1);
      expect(preview.querySelectorAll('[data-content-key="instagram"]')).toHaveLength(1);
      expect(profile.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING)
        .not.toBe(0);
      expect(booking.compareDocumentPosition(visit) & Node.DOCUMENT_POSITION_FOLLOWING)
        .not.toBe(0);

      view.unmount();
    }
  });

  it('does not repeat appointment-only contact wording in a final Quick Book profile', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookLayout = 'clean_card';
    state.profile.bookingOnlyContact = true;
    state.profile.bookingPreferences.visitMode = 'appointment_only';

    render(
      <OnboardingSitePreview
        document={initializeStarter('quick_book')}
        label="Booking-only final preview"
        quickBookPhase="final"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Booking-only final preview' });
    const profile = within(preview).getByRole('region', { name: 'Isla Nail Studio' });
    expect(profile).toHaveTextContent('Appointment only');
    expect(profile).not.toHaveTextContent('Online booking only');
  });

  it('never publishes one stored asset under both Logo and Profile roles', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.logo = {
      fileName: 'shared.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'same-stored-asset',
    };
    state.profile.profilePhoto = {
      fileName: 'shared.png',
      id: 'profile-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'same-stored-asset',
    };

    const { container } = render(
      <OnboardingSitePreview document={null} label="Shared media role preview" state={state} />,
    );

    expect(container.querySelectorAll('[data-media-id="same-stored-asset"]'))
      .toHaveLength(1);
    expect(container.querySelector('[data-media-id="same-stored-asset"]'))
      .toHaveAttribute('data-media-role', 'logo');
    expect(state.profile.profilePhoto.storageId).toBe('same-stored-asset');
  });

  it.each([
    ['photo_right', 'is-photo-right'],
    ['editorial_portrait', 'is-editorial'],
  ] satisfies Array<[AboutPresetId, string]>)('marks the portrait-led %s layout for compact phone composition', (preset, className) => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = preset;

    const { container } = render(
      <OnboardingSitePreview
        document={initializeStarter('one_page')}
        label={`${preset} portrait preview`}
        state={state}
      />,
    );

    const about = container.querySelector(`.onboarding-customer-about.${className}`);
    expect(about).toHaveClass('has-portrait');
    expect(about?.querySelector('.onboarding-customer-portrait.is-large'))
      .toHaveAttribute('data-media-role', 'profile');
  });

  it('keeps later booking-notice content out of the Screen 5 Quick Book preview', () => {
    const state = createDefaultOnboardingState();
    state.profile.bookingPreferences.minimumNoticeMinutes = 1_440;

    const { rerender } = render(
      <OnboardingSitePreview
        document={initializeStarter('quick_book')}
        label="Notice preview"
        quickBookPhase="business"
        state={state}
      />,
    );
    let preview = screen.getByRole('region', { name: 'Notice preview' });

    expect(within(preview).queryByRole('region', { name: 'Minimum booking notice' }))
      .not.toBeInTheDocument();
    expect(preview).not.toHaveTextContent('Book at least 1 day before your appointment.');
    expect(preview.querySelector('[data-bookable-time]')).toBeNull();
    expect(preview).not.toHaveTextContent(/available appointment|earliest bookable/iu);

    const withoutNotice = {
      ...state,
      profile: {
        ...state.profile,
        bookingPreferences: {
          ...state.profile.bookingPreferences,
          minimumNoticeMinutes: 0,
        },
      },
    };
    rerender(
      <OnboardingSitePreview
        document={initializeStarter('quick_book')}
        label="Notice preview"
        quickBookPhase="business"
        state={withoutNotice}
      />,
    );
    preview = screen.getByRole('region', { name: 'Notice preview' });
    expect(within(preview).queryByRole('region', { name: 'Minimum booking notice' }))
      .not.toBeInTheDocument();
    expect(preview.querySelector('[data-bookable-time]')).toBeNull();
  });

  it('omits every opening claim until the owner configures public hours', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Mia’s Nail Studio';
    state.profile.ownerName = 'Mia Torres';

    render(
      <OnboardingSitePreview document={initializeStarter('quick_book')} label="Unset hours preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Unset hours preview' });

    expect(preview.querySelector('[data-hours-status]')).toBeNull();
    expect(within(preview).queryByRole('group', { name: 'Weekly hours' }))
      .not.toBeInTheDocument();
    expect(within(preview).queryByText(/Open until|Opens (?:today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) at/u))
      .not.toBeInTheDocument();
    expect(within(preview).queryByText(/Tomorrow at 10:30 AM|Next opening/u))
      .not.toBeInTheDocument();
  });

  it('publishes the configured schedule only in the eligible Visit Us owner', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Mia’s Nail Studio';
    state.profile.hours.setupState = 'configured';
    state.profile.hours.showOnSite = true;
    state.profile.hours.days.thursday = {
      close: '18:00',
      closed: false,
      open: '10:30',
    };
    state.profile.hours.days.friday = {
      close: '17:00',
      closed: false,
      open: '09:00',
    };
    state.reviewOptions.previewTimestamp = '2026-09-02T16:00:00.000Z';

    render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Derived hours preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Derived hours preview' });

    const hoursOwner = preview.querySelector('[data-content-key="business_hours"]');
    expect(hoursOwner).toHaveTextContent('Thu10:30 AM–6:00 PM');
    expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(1);
    expect(within(preview).queryByText(/Tomorrow at 10:30 AM|Next opening/u))
      .not.toBeInTheDocument();
  });

  it('keeps embedded Booking focused on the canonical menu without repeating the salon identity', () => {
    const state = createDanielaFixtureState();
    state.profile.businessName = 'Cedar Tips';
    state.profile.location.cityOrArea = 'Ottawa, Ontario';
    state.recipe.quickBookProfile.showLocation = true;
    state.reviewOptions.previewTimestamp = '2026-08-27T18:30:00.000Z';
    const document = initializeStarter('quick_book');

    render(
      <OnboardingSitePreview document={document} label="Personalized Booking preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Personalized Booking preview' });
    const booking = within(preview).getByRole('region', { name: 'Booking' });

    expect(within(booking).getByRole('heading', { level: 2, name: 'Book an appointment' })).toBeVisible();
    expect(within(booking).getByRole('heading', { level: 3, name: 'Services & Booking' })).toBeVisible();
    expect(within(booking).queryByText('Cedar Tips')).not.toBeInTheDocument();
    expect(within(booking).queryByText('Ottawa, Ontario')).not.toBeInTheDocument();
    expect(within(booking).queryByText('Isla Nail Studio')).not.toBeInTheDocument();
    expect(within(booking).queryByText('Toronto, Ontario')).not.toBeInTheDocument();
    expect(within(booking).queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(preview.querySelectorAll('[data-content-key="location"]')).toHaveLength(1);
    expect(within(preview).queryByText(/Next opening/u)).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('canonical-booking-example')).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('selected-service-summary')).not.toBeInTheDocument();
  });

  it('renders real Custom Design sections around Booking in universal document order', () => {
    const state = createDanielaFixtureState();
    state.recipe.canvaEnabled = true;
    const document = initializeStarter('quick_book');
    const page = document.pages[0];
    const booking = page?.sections.find((section) => section.sectionType === 'booking');
    expect(page).toBeDefined();
    expect(booking).toBeDefined();
    if (!page || !booking) return;

    const before = customSection('canva-before', booking.order - 0.25);
    const after = customSection('canva-after', booking.order + 0.25);
    page.sections.push(after, before);

    expect(getOnboardingDocumentBookingSequence(document)).toEqual({
      afterBookingCustomDesignIds: [after.id],
      beforeBookingCustomDesignIds: [before.id],
      pageId: page.id,
    });

    render(
      <OnboardingSitePreview document={document} label="Ordered Canva preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Ordered Canva preview' });
    const beforeElement = preview.querySelector(
      `[data-onboarding-custom-design-section="${before.id}"]`,
    );
    const afterElement = preview.querySelector(
      `[data-onboarding-custom-design-section="${after.id}"]`,
    );
    const bookingElement = within(preview).getByRole('region', { name: 'Booking' });

    expect(beforeElement).not.toBeNull();
    expect(afterElement).toBeNull();
    expect((beforeElement!.compareDocumentPosition(bookingElement)
      & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(preview.querySelectorAll('[data-content-key="custom_design"]')).toHaveLength(1);
  });

  it('activates a Canva Booking CTA against the real Booking section without changing the page hash', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.canvaEnabled = true;
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const booking = page.sections.find((section) => section.sectionType === 'booking')!;
    const canva = customSection('booking-cta', booking.order - 0.5);
    canva.settings.cta = {
      label: 'Book now',
      placement: { type: 'after_all' },
      type: 'book_now',
    };
    page.sections.push(canva);
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    window.location.hash = '#onboarding-preview';

    try {
      render(
        <OnboardingSitePreview
          document={document}
          interactionMode="interactive"
          label="Interactive Canva action preview"
          state={state}
        />,
      );
      const preview = screen.getByRole('region', { name: 'Interactive Canva action preview' });
      const canvaSection = preview.querySelector<HTMLElement>(
        `[data-onboarding-custom-design-section="${canva.id}"]`,
      );
      const bookingSection = preview.querySelector<HTMLElement>(
        `[data-section-id="${booking.id}"]`,
      );
      const frame = preview.querySelector<HTMLElement>('[data-preview-scroll-container="true"]');
      expect(canvaSection).not.toBeNull();
      expect(bookingSection).toHaveAttribute('aria-label', 'Booking');
      expect(frame).not.toBeNull();
      await user.click(within(canvaSection!).getByRole('button', { name: 'Book now' }));

      expect(scrollTo).toHaveBeenCalledOnce();
      expect(scrollTo.mock.instances[0]).toBe(frame);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }));
      expect(window.location.hash).toBe('#onboarding-preview');
    } finally {
      if (originalScrollTo) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
          configurable: true,
          value: originalScrollTo,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
      }
    }
  });

  it('reuses the same profile across About layouts and updates the one Instagram owner', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = 'photo_right';
    const originalProfile = state.profile;
    const view = render(
      <OnboardingSitePreview document={null} label="Shared profile preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Shared profile preview' });
    const about = within(preview).getByRole('region', { name: 'About' });
    expect(within(about).getByText(state.profile.about.shortBio)).toBeVisible();
    expect(within(about).queryByRole('link', { name: /@islanail\.studio/ }))
      .not.toBeInTheDocument();
    const contact = within(preview).getByRole('region', { name: 'Visit and contact' });
    expect(within(contact).getByRole('link', { name: /Instagram/ })).toBeVisible();
    expect(within(preview).queryByTestId('canonical-booking-example')).not.toBeInTheDocument();
    expect(within(preview).queryByTestId('selected-service-summary')).not.toBeInTheDocument();

    const next = {
      ...state,
      profile: { ...state.profile, instagram: '@isla.updated' },
      recipe: { ...state.recipe, aboutPreset: 'profile_quick_facts' as const },
    };
    view.rerender(
      <OnboardingSitePreview document={null} label="Shared profile preview" state={next} />,
    );
    const updatedAbout = within(preview).getByRole('region', { name: 'About' });
    expect(within(updatedAbout).getByText(state.profile.about.shortBio)).toBeVisible();
    expect(within(updatedAbout).queryByRole('link', { name: /@isla\.updated/ }))
      .not.toBeInTheDocument();
    expect(within(contact).getByRole('link', { name: /Instagram/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/isla.updated/');
    expect(within(updatedAbout).queryByText('@islanail.studio')).not.toBeInTheDocument();
    expect(next.profile.about).toBe(originalProfile.about);

    const pastedUrl = {
      ...next,
      profile: {
        ...next.profile,
        instagram: 'https://www.instagram.com/islanailstudio/',
      },
    };
    view.rerender(
      <OnboardingSitePreview document={null} label="Shared profile preview" state={pastedUrl} />,
    );
    expect(within(contact).getByRole('link', { name: /Instagram/ }))
      .toHaveAttribute('href', 'https://www.instagram.com/islanailstudio/');

    view.rerender(
      <OnboardingSitePreview
        document={null}
        label="Shared profile preview"
        state={{
          ...pastedUrl,
          profile: { ...pastedUrl.profile, instagram: 'isla nail studio' },
        }}
      />,
    );
    expect(within(contact).queryByRole('link', { name: /instagram/iu }))
      .not.toBeInTheDocument();
  });

  it.each([
    'photo_right',
    'editorial_portrait',
    'profile_quick_facts',
    'about_before_you_book',
  ] satisfies AboutPresetId[])('renders every enabled About fact in the %s preset', (preset) => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = preset;
    state.profile.about.certifications = [
      'Russian manicure certification',
      'BIAB certification',
    ];

    render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label={`${preset} preview`} state={state} />,
    );
    const preview = screen.getByRole('region', { name: `${preset} preview` });
    const about = within(preview).getByRole('region', { name: /About/u });

    expect(about).toHaveAttribute('data-preview-target', 'about');
    expect(within(about).getByRole('img', {
      name: 'Daniela portrait illustration',
    })).toBeVisible();
    expect(within(about).getByRole('heading', { level: 2, name: 'Daniela' })).toBeVisible();
    expect(about.querySelector('.onboarding-about-salon')).not.toBeInTheDocument();
    expect(within(about).getByText(state.profile.about.shortBio)).toBeVisible();
    expect(within(about).getByText(state.profile.about.fullBio)).toBeInTheDocument();
    expect(within(about).getByText('Read more')).toBeInTheDocument();
    const specialties = within(about).getByRole('list', { name: 'Specialties' });
    for (const specialty of state.profile.about.specialties) {
      expect(within(specialties).getByText(specialty)).toBeVisible();
    }
    expect(within(about).getByText('6 years')).toBeInTheDocument();
    expect(within(about).getByText('Russian manicure certification · BIAB certification'))
      .toBeInTheDocument();
    expect(within(about).getByText('English · Spanish')).toBeInTheDocument();
    expect(within(about).queryByText('Appointment only')).not.toBeInTheDocument();
    expect(within(about).queryByText('Accepting new clients')).not.toBeInTheDocument();
    expect(within(about).queryByText('24-hour notice · $50 deposit · 15-minute late limit'))
      .not.toBeInTheDocument();
    expect(within(about).queryByRole('link', { name: /@islanail\.studio/u }))
      .not.toBeInTheDocument();
    expect(within(about).queryByRole('link', { name: 'Book now' }))
      .not.toBeInTheDocument();
    expect(within(about).queryByText('Solo nail tech')).not.toBeInTheDocument();
    expect(within(about).queryByText('Private home studio')).not.toBeInTheDocument();
    expect(about.querySelectorAll('.onboarding-about-facts > div').length)
      .toBeLessThanOrEqual(4);
  });

  it('removes a hidden About fact while preserving its shared profile value', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = 'about_before_you_book';
    state.profile.about.certifications = ['Advanced nail art certification'];
    state.profile.about.visibility.certifications = false;

    render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Hidden About fact preview" state={state} />,
    );
    const about = within(screen.getByRole('region', { name: 'Hidden About fact preview' }))
      .getByRole('region', { name: /About/u });

    expect(within(about).queryByText('Advanced nail art certification')).not.toBeInTheDocument();
    expect(state.profile.about.certifications).toEqual(['Advanced nail art certification']);
  });

  it('keeps hidden policy cards out of every concise customer policy summary', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = 'about_before_you_book';
    state.profile.policies.copy.cancellations.visible = false;
    state.profile.policies.copy.deposits.visible = false;
    state.profile.policies.copy.late_arrivals.visible = false;
    const view = render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Hidden policy summary preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Hidden policy summary preview' });
    const about = within(preview).getByRole('region', {
      name: 'About and before you book',
    });
    const policies = within(preview).getByRole('region', { name: 'Before you book' });

    expect(preview.querySelectorAll('.onboarding-policy-summary')).toHaveLength(0);
    expect(within(about).queryByText(/24-hour notice|\$50 deposit|15-minute late limit/u))
      .not.toBeInTheDocument();
    // Before You Book publishes only the still-visible policy
    // cards; the hidden late-arrival card keeps its saved wording out.
    expect([...policies.querySelectorAll('[data-policy]')]
      .map(entry => entry.getAttribute('data-policy')))
      .toEqual(['no_shows', 'repairs']);
    expect(within(policies).queryByText(/grace period/iu)).not.toBeInTheDocument();

    const depositsVisible = structuredClone(state);
    depositsVisible.profile.policies.copy.deposits.visible = true;
    view.rerender(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Hidden policy summary preview" state={depositsVisible} />,
    );
    expect(preview.querySelectorAll('.onboarding-policy-summary')).toHaveLength(0);
    expect(within(preview).getByRole('region', { name: 'Before you book' })
      .querySelector('[data-policy="deposits_cancellations"]'))
      .toHaveTextContent('$50 deposit');
  });

  it('never publishes deposit copy the owner hid, in either wording mode', () => {
    // The one-line summary is derived straight from the deposit and
    // cancellation answers, so unlike the long wording it has no visibility
    // check of its own. Without one, an owner who turned this copy off still
    // had it printed on their site.
    const state = createDanielaFixtureState();
    state.recipe.policiesEnabled = true;
    state.profile.policies.deposits.amountCents = 3_000;
    state.profile.policies.deposits.mode = 'fixed';
    state.profile.policies.deposits.refundable = false;
    state.profile.policies.deposits.transferable = true;
    state.profile.policies.cancellations.notice = '24_hours';
    state.profile.policies.cancellations.consequence = 'deposit_lost';
    // The owner hid both — the combined control in the Policies screen.
    state.profile.policies.copy.deposits.visible = false;
    state.profile.policies.copy.cancellations.visible = false;

    const summaryDocument = initializeStarter('one_page');
    const view = render(
      <OnboardingSitePreview document={summaryDocument} label="Hidden policy preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Hidden policy preview' });

    expect(preview.querySelector('[data-policy="deposits_cancellations"]')).toBeNull();
    expect(within(preview).queryByText(/\$30 deposit/u)).not.toBeInTheDocument();
    expect(preview.textContent).not.toMatch(/24 hours/iu);

    // And the section leaves the plan too, rather than reporting itself live.
    expect(planTypes(customerPagePlanFor(summaryDocument, state)))
      .not.toContain('deposits_cancellations');

    // The long-wording mode was already honest; it stays that way.
    view.rerender(
      <OnboardingSitePreview
        document={withDepositsWordingMode(summaryDocument, 'full')}
        label="Hidden policy preview"
        state={state}
      />,
    );
    expect(preview.querySelector('[data-policy="deposits_cancellations"]')).toBeNull();
  });

  it('renders deposits and cancellations as one truthful customer policy', () => {
    const state = createDanielaFixtureState();
    state.recipe.policiesEnabled = true;
    state.profile.policies.deposits.amountCents = 1_500;
    state.profile.policies.deposits.mode = 'fixed';
    state.profile.policies.deposits.refundable = false;
    state.profile.policies.deposits.transferable = false;
    state.profile.policies.cancellations.notice = '24_hours';
    state.profile.policies.cancellations.consequence = 'deposit_lost';
    state.profile.policies.copy.deposits.visible = true;
    state.profile.policies.copy.deposits.useSuggestedWording = true;
    state.profile.policies.copy.cancellations.visible = true;
    state.profile.policies.copy.cancellations.useSuggestedWording = true;

    const summaryDocument = initializeStarter('one_page');
    const fullDocument = withDepositsWordingMode(summaryDocument, 'full');

    const view = render(
      <OnboardingSitePreview document={summaryDocument} label="Combined policy preview" state={state} />,
    );
    const summarySection = within(screen.getByRole('region', { name: 'Combined policy preview' }))
      .getByRole('region', { name: 'Before you book' });
    const combinedPolicy = summarySection.querySelector<HTMLElement>(
      '[data-policy="deposits_cancellations"]',
    );
    expect(combinedPolicy).not.toBeNull();
    expect(within(combinedPolicy!).getByText('Deposits & cancellations')).toBeVisible();
    expect(within(summarySection).queryByRole('heading', { name: 'Cancellations' }))
      .not.toBeInTheDocument();
    expect(within(summarySection).queryByRole('heading', { name: 'Deposits' }))
      .not.toBeInTheDocument();
    // The starter section ships wordingMode 'summary'.
    expect(combinedPolicy).toHaveTextContent(
      '$15 deposit · 24 hours’ notice · deposit kept after late cancellation',
    );

    view.rerender(
      <OnboardingSitePreview document={fullDocument} label="Combined policy preview" state={state} />,
    );
    const policies = within(screen.getByRole('region', { name: 'Combined policy preview' }))
      .getByRole('region', { name: 'Before you book' });
    expect(policies.querySelector('[data-policy="deposits_cancellations"]'))
      .toHaveTextContent('$15 deposit · 24 hours’ notice');

    const noDeposit = structuredClone(state);
    noDeposit.profile.policies.deposits.mode = 'none';
    noDeposit.profile.policies.deposits.amountCents = null;
    noDeposit.profile.policies.cancellations.consequence = 'cancellation_fee';
    view.rerender(
      <OnboardingSitePreview document={fullDocument} label="Combined policy preview" state={noDeposit} />,
    );
    const noDepositPolicies = within(screen.getByRole('region', { name: 'Combined policy preview' }))
      .getByRole('region', { name: 'Before you book' });
    expect(noDepositPolicies.querySelector('[data-policy="deposits_cancellations"]'))
      .toHaveTextContent('No deposit · 24 hours’ notice');
    expect(noDepositPolicies).not.toHaveTextContent(/refundable|transferred|deposit being lost/iu);
  });

  it('keeps final Quick Book policy content compact above Booking', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.policiesEnabled = true;
    state.recipe.quickBookProfile.showBookingPolicy = true;
    const document = initializeStarter('quick_book');

    render(
      <OnboardingSitePreview
        document={document}
        label="Partial policy preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Partial policy preview' });
    // Quick Book keeps policies compact above the one Booking engine and owns
    // complete business information in the deterministic Visit section below.
    expect(planTypes(customerPagePlanFor(document, state)))
      .toEqual(['hero', 'booking', 'visit_us']);
    expect(preview.querySelector('[data-library-type="deposits_cancellations"]')).toBeNull();
    expect(preview.querySelector('[data-library-type="policies"]')).toBeNull();

    const disclosure = preview.querySelector<HTMLElement>(
      '[data-content-key="before_you_book_policies"]',
    );
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveTextContent('Deposits & cancellations');
    expect(disclosure).toHaveTextContent('Late arrivals');
    expect(disclosure).toHaveTextContent('No-shows');
    expect(within(preview).getByRole('region', { name: 'Visit and contact' }))
      .toBeVisible();
  });

  it('keeps Quick Book policies in one compact profile action outside its Booking engine', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookProfile.showBookingPolicy = true;
    state.recipe.quickBookProfile.showCancellationPolicy = true;
    const document = initializeStarter('quick_book');
    const plan = customerPagePlanFor(document, state);
    const sections = plan[0]!.sections;
    expect(sections.filter(section => section.sectionType === 'booking')).toHaveLength(1);
    expect(sections.some(section => section.sectionType === 'deposits_cancellations'))
      .toBe(false);
    expect(sections.some(section => section.sectionType === 'policies')).toBe(false);

    const view = render(
      <OnboardingSitePreview document={document} label="Compact policy preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Compact policy preview' });
    const profile = within(preview).getByRole('region', { name: state.profile.businessName });
    const booking = within(preview).getByRole('region', { name: 'Booking' });
    const disclosure = profile.querySelector<HTMLElement>(
      '[data-content-key="before_you_book_policies"]',
    );
    expect(disclosure).not.toBeNull();
    expect(disclosure!.querySelector('summary')).toHaveTextContent('Policies');
    expect(disclosure).toHaveTextContent('Deposits & cancellations');
    expect(booking.querySelector('.onboarding-quick-book-policies')).toBeNull();
    expect(booking.querySelector('[data-content-key="before_you_book_policies"]')).toBeNull();
    expect(booking.querySelector('[data-transactional-booking-disclosure="true"]'))
      .toHaveTextContent('$50 deposit required to book.');
    expect(preview.querySelector('[data-library-type="deposits_cancellations"]')).toBeNull();
    expect(preview.querySelector('[data-library-type="policies"]')).toBeNull();

    // Hiding every non-deposit topic leaves the same single compact profile
    // action; no policy section or Booking-owned duplicate appears.
    const quiet = structuredClone(state);
    for (const sectionId of ['late_arrivals', 'no_shows', 'repairs', 'other'] as const) {
      quiet.profile.policies.copy[sectionId].visible = false;
    }
    view.rerender(
      <OnboardingSitePreview document={document} label="Compact policy preview" state={quiet} />,
    );

    const quietDisclosure = within(preview)
      .getByRole('region', { name: state.profile.businessName })
      .querySelector<HTMLElement>('[data-content-key="before_you_book_policies"]');
    expect(quietDisclosure).not.toBeNull();
    expect(quietDisclosure).toHaveTextContent('Deposits & cancellations');
    expect(within(preview).getByRole('region', { name: 'Booking' })
      .querySelector('[data-content-key="before_you_book_policies"]')).toBeNull();
    expect(preview.querySelector('[data-library-type="policies"]')).toBeNull();
  });

  it('keeps required deposit disclosure in Booking without republishing hidden policy copy', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookProfile.showBookingPolicy = true;
    state.profile.policies.copy.deposits.visible = false;
    const document = initializeStarter('quick_book');

    render(
      <OnboardingSitePreview
        document={document}
        label="Hidden Quick Book deposit policy"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Hidden Quick Book deposit policy' });
    const profile = within(preview).getByRole('region', { name: state.profile.businessName });
    const booking = within(preview).getByRole('region', { name: 'Booking' });
    const policies = profile.querySelector('[data-content-key="before_you_book_policies"]');

    expect(Array.from(policies?.querySelectorAll('dt') ?? []).map(node => node.textContent))
      .not.toContain('Deposit');
    expect(booking.querySelector('[data-transactional-booking-disclosure="true"]'))
      .toHaveTextContent('$50 deposit required to book.');
  });

  it('honours hidden identity and booking-status fields in Before You Book', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = 'about_before_you_book';
    state.profile.profilePhoto = undefined;
    state.profile.about.visibility.owner_name = false;
    state.profile.about.visibility.salon_name = false;
    state.profile.about.visibility.appointment_status = false;
    state.profile.about.visibility.new_client_status = false;

    render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Hidden About identity preview" state={state} />,
    );
    const about = within(screen.getByRole('region', { name: 'Hidden About identity preview' }))
      .getByRole('region', { name: /About/u });

    expect(within(about).getByRole('heading', { level: 2, name: 'About' })).toBeVisible();
    expect(within(about).queryByText('Daniela')).not.toBeInTheDocument();
    expect(within(about).queryByText('Isla Nail Studio')).not.toBeInTheDocument();
    expect(within(about).queryByText('Appointment only')).not.toBeInTheDocument();
    expect(within(about).queryByText('Accepting new clients')).not.toBeInTheDocument();
    expect(within(about).queryByRole('img', {
      name: 'Business owner portrait placeholder',
    })).not.toBeInTheDocument();
  });

  it('renders structural About content after migrating a legacy draft that hid removed controls', () => {
    const legacy = createDanielaFixtureState() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 6;
    const profile = legacy.profile as Record<string, unknown>;
    const about = profile.about as Record<string, unknown>;
    about.visibility = {
      ...(about.visibility as Record<string, boolean>),
      bio: false,
      book_button: false,
      owner_name: false,
      profile_photo: false,
      salon_name: false,
      specialties: false,
    };
    (legacy.recipe as Record<string, unknown>).aboutPreset = 'editorial_portrait';
    const migrated = parseOnboardingState(JSON.stringify(legacy)).state;

    render(
      <OnboardingSitePreview
        document={initializeStarter('one_page')}
        label="Migrated About preview"
        state={migrated}
      />,
    );
    const aboutRegion = within(screen.getByRole('region', { name: 'Migrated About preview' }))
      .getByRole('region', { name: 'About' });

    expect(within(aboutRegion).getByRole('heading', { name: 'Daniela' })).toBeVisible();
    expect(aboutRegion.querySelector('.onboarding-about-salon')).not.toBeInTheDocument();
    expect(within(aboutRegion).getByText(migrated.profile.about.fullBio)).toBeInTheDocument();
    expect(within(aboutRegion).queryByRole('link', { name: 'Book now' }))
      .not.toBeInTheDocument();
    expect(within(aboutRegion).queryByText('Russian Manicure · BIAB · Gel-X · Hard Gel'))
      .not.toBeInTheDocument();
  });

  it('keeps six specialties and a long custom specialty in separate wrapping list items', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = 'about_before_you_book';
    state.profile.about.specialties = [
      'Russian Manicure',
      'BIAB',
      'Gel-X',
      'Hard Gel',
      'Natural Nail Care',
      'Arte de uñas editorial extremadamente detallado',
    ];

    render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Long specialties preview" state={state} />,
    );
    const about = within(screen.getByRole('region', { name: 'Long specialties preview' }))
      .getByRole('region', { name: /About/u });
    const list = within(about).getByRole('list', { name: 'Specialties' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list).getByText('Arte de uñas editorial extremadamente detallado'))
      .toBeVisible();
  });

  it('renders Quick Book as one ordered customer page with no structure outline or navigation', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.aboutEnabled = false;
    state.recipe.galleryEnabled = false;
    state.recipe.policiesEnabled = false;
    state.recipe.quickBookProfile = {
      ...state.recipe.quickBookProfile,
      showInstagram: false,
      showTechName: false,
      showTechPhoto: false,
    };
    state.profile.about.visibility.instagram = false;
    state.profile.about.visibility.owner_name = false;
    state.profile.about.visibility.profile_photo = false;
    state.profile.location.cityOrArea = '';
    state.profile.location.exactAddress = '';
    state.profile.hours.showOnSite = false;
    state.profile.bookingOnlyContact = false;
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const heroId = sectionOn(page, 'hero').id;
    const bookingId = sectionOn(page, 'booking').id;
    const visitId = sectionOn(page, 'visit_us').id;
    const teamEntry = getSectionRegistryEntry('team');
    const legacyTeam: SectionInstance = {
      id: 'legacy-lower-team',
      label: teamEntry.label,
      order: 99,
      sectionType: 'team',
      settings: teamEntry.defaultSettings(),
      visible: true,
    } as SectionInstance;
    page.sections.push(legacyTeam);
    const plan = customerPagePlanFor(document, state);

    render(
      <OnboardingSitePreview
        document={document}
        interactionMode="interactive"
        label="Quick Book customer preview"
        state={state}
      />,
    );
    const preview = screen.getByRole('region', { name: 'Quick Book customer preview' });
    const customerPage = preview.querySelector<HTMLElement>('.onboarding-customer-page')!;
    const sectionIds = [...customerPage.children]
      .flatMap(element => element.getAttribute('data-section-id') ?? []);

    expect(preview.querySelector('[data-starter-structure]')).toBeNull();
    expect(sectionIds).toEqual([
      heroId,
      bookingId,
    ]);
    expect(planTypes(plan)).toEqual(['hero', 'booking', 'visit_us']);
    expect(planIds(plan)).toContain(visitId);
    expect(planIds(plan)).not.toContain('legacy-lower-team');
    expect(preview.querySelectorAll('.onboarding-quick-book-profile')).toHaveLength(1);
    expect(within(preview).getAllByRole('region', { name: 'Booking' })).toHaveLength(1);
    expect(within(preview).queryByRole('navigation', { name: 'Customer preview navigation' }))
      .not.toBeInTheDocument();
    // Every optional module and row is switched off in this recipe.
    expect(preview.querySelector('.onboarding-customer-about')).toBeNull();
    expect(preview.querySelector('[data-library-type="team"]')).toBeNull();
    expect(preview.querySelector('[data-content-key="owner_profile_photo"]')).toBeNull();
    expect(state.profile.profilePhoto?.id).toBe('fixture_daniela_portrait');
    expect(preview.querySelector('.onboarding-customer-gallery')).toBeNull();
    expect(preview.querySelector('.onboarding-quick-book-profile__row')).toBeNull();
    expect(preview.querySelector('.onboarding-quick-book-profile__contacts')).toBeNull();
    expect(preview.querySelector('.onboarding-quick-book-profile__actions')).toBeNull();
    expect(preview.querySelector('.onboarding-quick-book-profile__bio')).toBeNull();
    expect(preview.querySelector('[data-library-type="policies"]')).toBeNull();
    expect(preview.querySelector('.customer-lib-final-cta')).toBeNull();
    expect(preview.querySelector('.customer-lib-footer')).toBeNull();
    expect(preview.querySelectorAll('.onboarding-customer-footer')).toHaveLength(1);
  });

  it.each(['one_page', 'multi_page'] as const)(
    'keeps Team and its owner portrait unchanged for %s',
    (starter) => {
      const state = createDanielaFixtureState();
      state.recipe.starter = starter;
      state.recipe.aboutEnabled = false;
      // This About-layout control must not leak into the Team renderer.
      state.profile.about.visibility.profile_photo = false;
      const document = initializeStarter(starter);
      document.siteContent.staff = [{
        acceptsBookings: true,
        id: 'owner-daniela',
        name: 'Daniela',
        specialties: ['BIAB'],
        title: 'Owner',
      }];
      const page = document.pages[0]!;
      const teamEntry = getSectionRegistryEntry('team');
      const team: SectionInstance = {
        id: `team-${starter}`,
        label: teamEntry.label,
        order: 0,
        sectionType: 'team',
        settings: teamEntry.normalize({
          ...teamEntry.defaultSettings(),
          memberIds: ['owner-daniela'],
        }),
        visible: true,
      } as SectionInstance;
      document.pages = [{ ...page, sections: [team] }];
      const plan = customerPagePlanFor(document, state);

      render(
        <OnboardingSitePreview
          customerPagePlan={plan}
          document={document}
          label={`${starter} Team preview`}
          state={state}
        />,
      );
      const preview = screen.getByRole('region', { name: `${starter} Team preview` });
      const teamRegion = within(preview).getByRole('region', { name: 'Team' });

      expect(within(teamRegion).getByText('Daniela')).toBeVisible();
      expect(teamRegion.querySelectorAll('[data-content-key="owner_profile_photo"]'))
        .toHaveLength(1);
      expect(teamRegion.querySelector('[data-media-role="profile"]'))
        .toHaveAttribute('data-media-id', 'fixture_daniela_portrait');
    },
  );

  it('places the canonical Booking section immediately after the compact Quick Book profile', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    class UnexpectedHeroActionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0.01];

      constructor(_nextCallback: IntersectionObserverCallback) {}

      observe = observe;
      disconnect = disconnect;
      takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
      unobserve = vi.fn();
    }
    vi.stubGlobal(
      'IntersectionObserver',
      UnexpectedHeroActionObserver as unknown as typeof IntersectionObserver,
    );

    try {
      const state = createDanielaFixtureState();
      state.recipe.starter = 'quick_book';
      render(
        <OnboardingSitePreview
          device="phone"
          document={initializeStarter('quick_book')}
          interactionMode="interactive"
          label="Hero shortcut preview"
          state={state}
        />,
      );
      const preview = screen.getByRole('region', { name: 'Hero shortcut preview' });
      const profile = within(preview).getByRole('region', {
        name: state.profile.businessName,
      });
      const booking = within(preview).getByRole('region', { name: 'Booking' });

      expect(profile.nextElementSibling).toBe(booking);
      expect(preview.querySelector('[data-hero-book-action="true"]')).toBeNull();
      expect(preview.querySelector('.customer-book-shortcut')).toBeNull();
      expect(observe).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hosts service details at the customer viewport without moving the long preview page', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';

    render(
      <OnboardingSitePreview
        device="phone"
        document={initializeStarter('quick_book')}
        interactionMode="interactive"
        label="Mobile service dialog preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Mobile service dialog preview' });
    const frame = preview.querySelector<HTMLElement>('[data-preview-scroll-container="true"]');
    const overlayHost = preview.querySelector<HTMLElement>('.onboarding-preview-overlay-host');
    const booking = within(preview).getByRole('region', { name: 'Booking' });

    expect(frame).not.toBeNull();

    expect(overlayHost).not.toBeNull();
    if (frame) {
      frame.scrollTop = 640;
    }

    await user.click(within(booking).getAllByRole('button', {
      name: /View details for Gel Manicure, 1 hr, \$50/,
    })[0]!);

    const detail = await screen.findByTestId('service-detail-dialog');
    const close = within(detail).getByRole('button', { name: 'Close service details' });

    expect(overlayHost).toContainElement(detail);

    expect(booking).not.toContainElement(detail);

    expect(frame?.scrollTop).toBe(640);
    await waitFor(() => expect(close).toHaveFocus());

    await user.click(close);

    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();

    expect(frame?.scrollTop).toBe(640);
  });

  it('starts without a selected service and keeps an explicit selection inside Booking', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';

    render(
      <OnboardingSitePreview
        device="phone"
        document={initializeStarter('quick_book')}
        interactionMode="interactive"
        label="Unselected Booking preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Unselected Booking preview' });
    const booking = within(preview).getByRole('region', { name: 'Booking' });
    const bookingRenderer = within(booking).getByTestId('booking-section-preview');
    const summaryHost = within(booking).getByTestId('onboarding-booking-selection-host');
    const overlayHost = preview.querySelector<HTMLElement>('.onboarding-preview-overlay-host');

    expect(within(preview).queryByTestId('selected-service-summary')).not.toBeInTheDocument();
    expect(summaryHost).toBeEmptyDOMElement();
    expect(bookingRenderer.nextElementSibling).toBe(summaryHost);

    await user.click(within(booking).getAllByRole('button', {
      name: /View details for Gel Manicure, 1 hr, \$50/,
    })[0]!);
    const detail = await screen.findByTestId('service-detail-dialog');
    const summary = screen.getByTestId('selected-service-summary');
    expect(summary).not.toBeVisible();
    expect(within(detail).getByRole('button', { name: 'Continue' })).toBeVisible();
    expect(within(detail).queryByRole('button', { name: 'Select service' }))
      .not.toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: 'Keep browsing' }));
    expect(screen.queryByTestId('service-detail-dialog')).not.toBeInTheDocument();
    expect(summary).toBeVisible();
    expect(summaryHost).toContainElement(summary);
    expect(bookingRenderer.nextElementSibling).toBe(summaryHost);
    expect(overlayHost).not.toContainElement(summary);
    expect(within(summary).getByText('Gel Manicure')).toBeVisible();
  });

  it('keeps booking-only Quick Book truthful in one Booking engine and one Visit owner', () => {
    const state = createDefaultOnboardingState();
    state.profile.businessName = 'Isla Nail Studio';
    state.profile.businessStructure = 'solo';
    state.profile.ownerName = 'Daniela';
    state.profile.bookingOnlyContact = true;
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookProfile.showPhone = true;

    render(
      <OnboardingSitePreview
        document={initializeStarter('quick_book')}
        interactionMode="interactive"
        label="Booking-only customer preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Booking-only customer preview' });
    const plan = customerPagePlanFor(initializeStarter('quick_book'), state);

    expect(planTypes(plan)).toEqual(['hero', 'booking', 'visit_us']);
    expect(preview.querySelectorAll('.onboarding-customer-booking')).toHaveLength(1);
    expect(preview.querySelector('.onboarding-customer-contact')).toBeNull();
    expect(preview.querySelectorAll('.customer-lib-visit')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="booking_only_contact"]'))
      .toHaveLength(1);
    expect(within(preview).getByText('Online booking is the best way to reach us.'))
      .toBeVisible();
    expect(preview.querySelector('a[href^="tel:"]')).toBeNull();
    expect(state.profile.bookingOnlyContact).toBe(true);
  });

  it('keeps all Booking facts in the one catalogue without a Quick Info section', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'one_page';
    const document = initializeStarter('one_page');

    render(
      <OnboardingSitePreview
        document={document}
        label="Booking facts fallback preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Booking facts fallback preview' });
    const booking = within(preview).getByRole('region', { name: 'Booking' });

    expect(preview.querySelector('[data-library-type="quick_info"]')).toBeNull();
    expect(within(booking).getByRole('region', { name: 'Appointments' })).toBeVisible();
    expect(within(booking).getByRole('region', { name: 'New clients' })).toBeVisible();
    expect(within(booking).getByRole('region', { name: 'Minimum booking notice' })).toBeVisible();
    expect(preview.querySelectorAll('[data-content-key="appointment_mode"]')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="new_client_status"]')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="minimum_notice"]')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="service_catalogue"]')).toHaveLength(1);
  });

  it('renders One-page library sections once in document order and omits empty authorities', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'one_page';
    state.recipe.galleryEnabled = true;
    state.gallery.layout = 'editorial';
    state.gallery.images = [galleryFixtureImage('example-gallery-order')];
    const document = initializeStarter('one_page');
    const page = document.pages[0]!;
    const idFor = (sectionType: SectionType) => sectionOn(page, sectionType).id;
    const originalDocument = structuredClone(document);

    render(
      <OnboardingSitePreview document={document} label="One-page customer preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'One-page customer preview' });
    const customerPage = preview.querySelector<HTMLElement>('.onboarding-customer-page')!;
    const sectionIds = [...customerPage.children]
      .flatMap(element => element.getAttribute('data-section-id') ?? []);

    expect(preview.querySelector('[data-starter-structure]')).toBeNull();
    expect(sectionIds).toEqual([
      idFor('hero'),
      idFor('gallery'),
      idFor('about'),
      idFor('booking'),
      idFor('policies'),
      idFor('visit_us'),
    ]);
    // Empty shared authorities do not become customer content or obsolete
    // technical rows.
    expect(page.sections.some(section => section.sectionType === 'announcement_bar')).toBe(false);
    expect(preview.querySelector('.customer-lib-reviews')).toBeNull();
    expect(preview.querySelectorAll('.onboarding-customer-hero')).toHaveLength(1);
    expect(preview.querySelectorAll('.onboarding-customer-about')).toHaveLength(1);
    expect(preview.querySelectorAll('.onboarding-customer-gallery')).toHaveLength(1);
    expect(preview.querySelectorAll('.onboarding-customer-booking')).toHaveLength(1);
    expect(preview.querySelectorAll('.customer-lib-deposits')).toHaveLength(0);
    expect(preview.querySelectorAll('.customer-lib-policies')).toHaveLength(1);
    expect(preview.querySelectorAll('.customer-lib-visit')).toHaveLength(1);
    // The Visit Us section already covers Contact, so nothing is injected.
    expect(preview.querySelectorAll('.onboarding-customer-contact')).toHaveLength(0);
    expect(sectionIds).not.toContain('onboarding-preview-contact');
    const navigation = within(preview).getByRole('navigation', {
      name: 'Customer preview navigation',
    });
    expect(within(navigation).getAllByRole('link', { hidden: true }).map(link => link.textContent))
      .toEqual([
        'Home',
        'Gallery',
        'About',
        'Services & Booking',
        'Before You Book',
        'Visit & Contact',
        'Book',
      ]);
    expect(preview.querySelector('.onboarding-customer-about a[href="#booking"]')).toBeNull();
    expect(within(preview).getByRole('region', { name: 'Visit and contact' })
      .querySelector('a[href="#booking"]')).toBeNull();
    expect(preview.querySelectorAll('.customer-lib-footer')).toHaveLength(0);
    expect(preview.querySelectorAll('.onboarding-customer-footer')).toHaveLength(1);
    expect(document).toEqual(originalDocument);
  });

  it('renders an account-backed customer page plan without rebuilding the raw starter outline', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'one_page';
    const document = initializeStarter('one_page');
    const home = document.pages[0]!;
    const hero = sectionOn(home, 'hero');
    const booking = sectionOn(home, 'booking');

    render(
      <OnboardingSitePreview
        customerPagePlan={[{
          id: home.id,
          isHome: home.isHome,
          label: home.name,
          order: home.order,
          sections: [
            {
              attachedToPrevious: false,
              id: hero.id,
              injected: false,
              label: 'Welcome',
              section: hero,
              sectionType: 'hero',
              surface: 'base',
            },
            {
              attachedToPrevious: false,
              id: booking.id,
              injected: false,
              label: 'Booking',
              section: booking,
              sectionType: 'booking',
              surface: 'base',
            },
          ],
          slug: home.slug,
          visibleInNavigation: home.visibleInNavigation,
        }]}
        document={document}
        interactionMode="interactive"
        label="Persisted customer plan preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Persisted customer plan preview' });
    const renderedIds = [...preview.querySelectorAll<HTMLElement>('[data-section-id]')]
      .map(section => section.dataset.sectionId);

    // The persisted plan is rendered verbatim; the ladder is not re-run over
    // the document, so none of its other starter sections appear.
    expect(renderedIds).toEqual([hero.id, booking.id]);
    expect(preview.querySelector('.onboarding-customer-about')).toBeNull();
    expect(preview.querySelector('.onboarding-customer-gallery')).toBeNull();
    expect(preview.querySelector('.onboarding-customer-contact')).toBeNull();
    expect(preview.querySelector('.customer-lib-deposits')).toBeNull();
    // With no footer section in the plan, the legacy footer chrome stands in.
    expect(preview.querySelector('.customer-lib-footer')).toBeNull();
    expect(preview.querySelectorAll('.onboarding-customer-footer')).toHaveLength(1);
  });

  it('renders every distinct Custom Design section once in document order', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.canvaEnabled = true;
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const booking = page.sections.find(section => section.sectionType === 'booking')!;
    const before = customSection('first-preview-page', booking.order - 0.2);
    const after = customSection('second-preview-page', booking.order + 0.2);
    page.sections.push(after, before);

    render(
      <OnboardingSitePreview document={document} label="Custom Design pages preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Custom Design pages preview' });
    const renderedCustomIds = [...preview.querySelectorAll<HTMLElement>(
      '[data-onboarding-custom-design-section]',
    )].map(section => section.dataset.onboardingCustomDesignSection);

    expect(renderedCustomIds).toEqual([before.id]);
    expect(new Set(renderedCustomIds)).toHaveProperty('size', 1);
    expect(preview.querySelector('[data-starter-structure]')).toBeNull();
  });

  it('switches Multi-page navigation between real rendered customer pages', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.recipe.starter = 'multi_page';
    state.recipe.galleryEnabled = true;
    state.gallery.images = [galleryFixtureImage('example-gallery-navigation')];
    const document = initializeStarter('multi_page');

    render(
      <OnboardingSitePreview
        document={document}
        interactionMode="interactive"
        label="Interactive Multi-page preview"
        state={state}
      />,
    );
    const preview = screen.getByRole('region', { name: 'Interactive Multi-page preview' });
    const navigation = within(preview).getByRole('navigation', {
      name: 'Customer preview navigation',
    });
    const pageByName = new Map(document.pages.map(page => [page.name, page]));
    const home = pageByName.get('Home')!;
    const booking = pageByName.get('Services & Booking')!;
    const gallery = pageByName.get('Gallery')!;
    const about = pageByName.get('About')!;
    const contact = pageByName.get('Contact')!;

    expect(within(navigation).getAllByRole('link').map(link => link.textContent))
      .toEqual(['Home', 'Services & Booking', 'Gallery', 'About', 'Contact']);
    expect(navigation.querySelector('.customer-book-shortcut')).toHaveTextContent('Book');
    expect(within(navigation).getByRole('link', { name: 'Home' }))
      .toHaveAttribute('aria-current', 'page');
    expect(within(preview).getByRole('region', { name: 'Home page' }))
      .toHaveAttribute('data-preview-page-id', home.id);
    expect(preview.querySelectorAll('.onboarding-customer-hero')).toHaveLength(1);
    expect(home.sections.some(section => section.sectionType === 'gallery')).toBe(false);
    expect(preview.querySelectorAll('.onboarding-customer-gallery')).toHaveLength(0);
    expect(preview.querySelector('.onboarding-customer-booking')).toBeNull();

    await user.click(within(navigation).getByRole('link', { name: 'Gallery' }));
    expect(within(navigation).getByRole('link', { name: 'Gallery' }))
      .toHaveAttribute('aria-current', 'page');
    const galleryPage = within(preview).getByRole('region', { name: 'Gallery page' });
    expect(galleryPage).toHaveAttribute('data-preview-page-id', gallery.id);
    expect(window.document.activeElement).toBe(
      within(galleryPage).getByRole('heading', { level: 1, name: 'Gallery' }),
    );
    expect(preview.querySelectorAll('.onboarding-customer-gallery')).toHaveLength(1);
    expect(preview.querySelector('.onboarding-customer-hero')).toBeNull();

    await user.click(within(navigation).getByRole('link', { name: 'About' }));
    expect(within(preview).getByRole('region', { name: 'About page' }))
      .toHaveAttribute('data-preview-page-id', about.id);
    expect(preview.querySelectorAll('.onboarding-customer-about')).toHaveLength(1);
    expect(preview.querySelector(`[data-section-id="${sectionOn(about, 'about').id}"]`))
      .not.toBeNull();
    expect(preview.querySelector('[data-library-type="team"]')).toBeNull();
    expect(preview.querySelector('.onboarding-customer-about a[href="#booking"]')).toBeNull();

    await user.click(within(navigation).getByRole('link', { name: 'Services & Booking' }));
    expect(within(preview).getByRole('region', { name: 'Services & Booking page' }))
      .toHaveAttribute('data-preview-page-id', booking.id);
    expect(preview.querySelectorAll('.onboarding-customer-booking')).toHaveLength(1);
    expect(preview.querySelector(`[data-section-id="${sectionOn(booking, 'booking').id}"]`))
      .not.toBeNull();
    expect(preview.querySelectorAll('[data-content-key="service_catalogue"]')).toHaveLength(1);
    expect(preview.querySelectorAll('.customer-lib-deposits')).toHaveLength(0);
    expect(preview.querySelectorAll('.customer-lib-policies')).toHaveLength(1);

    await user.click(within(navigation).getByRole('link', { name: 'Contact' }));
    expect(within(preview).getByRole('region', { name: 'Contact page' }))
      .toHaveAttribute('data-preview-page-id', contact.id);
    expect(preview.querySelectorAll('.onboarding-customer-contact')).toHaveLength(0);
    expect(preview.querySelectorAll('.customer-lib-visit')).toHaveLength(1);
    expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(1);
    expect(within(preview).getByRole('region', { name: 'Visit and contact' })
      .querySelector('a[href="#booking"]')).toBeNull();
    expect(document.pages.flatMap(page => page.sections)
      .filter(section => section.sectionType === 'booking')).toHaveLength(1);
    expect(preview.querySelector('[data-starter-structure]')).toBeNull();
  });

  it('does not report Home before the requested Builder Preview page', async () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'multi_page';
    const document = initializeStarter('multi_page');
    const contact = document.pages.find(page => page.name === 'Contact')!;
    const onActivePageChange = vi.fn();

    render(
      <OnboardingSitePreview
        document={document}
        initialPageId={contact.id}
        interactionMode="interactive"
        label="Contact Builder preview"
        onActivePageChange={onActivePageChange}
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Contact Builder preview' });

    expect(within(preview).getByRole('region', { name: 'Contact page' }))
      .toHaveAttribute('data-preview-page-id', contact.id);

    await waitFor(() => expect(onActivePageChange).toHaveBeenCalled());

    expect(onActivePageChange.mock.calls[0]).toEqual([contact.id]);
  });

  it('opens the actual Multi-page page that owns About for an About-targeted preview', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'multi_page';
    const document = initializeStarter('multi_page');
    const aboutPage = document.pages.find(page => page.sections.some(
      section => section.sectionType === 'about',
    ))!;

    render(
      <OnboardingSitePreview
        document={document}
        initialTarget="about"
        interactionMode="interactive"
        label="Targeted About preview"
        state={state}
      />,
    );
    const preview = screen.getByRole('region', { name: 'Targeted About preview' });
    const navigation = within(preview).getByRole('navigation', {
      name: 'Customer preview navigation',
    });

    expect(aboutPage.name).toBe('About');
    expect(within(navigation).getByRole('link', { name: 'About' }))
      .toHaveAttribute('aria-current', 'page');
    expect(within(preview).getByRole('region', { name: 'About page' }))
      .toHaveAttribute('data-preview-page-id', aboutPage.id);
    expect(preview.querySelectorAll('.onboarding-customer-about')).toHaveLength(1);
    expect(preview.querySelector('.onboarding-customer-hero')).toBeNull();
  });

  it('keeps a moved and owner-renamed About section semantic in customer Preview', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'multi_page';
    const source = initializeStarter('multi_page');
    const home = source.pages.find(page => page.isHome)!;
    const aboutPage = source.pages.find(page => page.sections.some(
      section => section.sectionType === 'about',
    ))!;
    const aboutSection = sectionOn(aboutPage, 'about');
    const document = moveSectionToPage(source, aboutSection.id, home.id);
    const movedAbout = document.pages
      .flatMap(page => page.sections)
      .find(section => section.id === aboutSection.id)!;
    movedAbout.label = 'Daniela’s story';

    render(
      <OnboardingSitePreview
        document={document}
        initialTarget="about"
        interactionMode="interactive"
        label="Renamed About preview"
        state={state}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Renamed About preview' });
    const navigation = within(preview).getByRole('navigation', {
      name: 'Customer preview navigation',
    });

    expect(within(navigation).getByRole('link', { name: 'Home' }))
      .toHaveAttribute('aria-current', 'page');
    expect(preview.querySelectorAll('.onboarding-customer-about')).toHaveLength(1);
    expect(preview.querySelector('.onboarding-customer-about'))
      .toHaveAttribute('data-section-id', aboutSection.id);
  });

  it('filters renamed optional sections by their library type instead of owner copy', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'one_page';
    state.recipe.aboutEnabled = false;
    state.recipe.galleryEnabled = false;
    state.gallery.images = [galleryFixtureImage('example-gallery-renamed')];
    const document = initializeStarter('one_page');
    const page = document.pages[0]!;
    const about = sectionOn(page, 'about');
    const gallery = sectionOn(page, 'gallery');
    about.label = 'Daniela’s story';
    gallery.label = 'My work';

    const plan = customerPagePlanFor(document, state);

    expect(planTypes(plan)).toEqual(['hero', 'booking', 'policies', 'visit_us']);
    expect(planIds(plan)).not.toContain(about.id);
    expect(planIds(plan)).not.toContain(gallery.id);

    // Control: the same renamed sections publish under their library type,
    // carrying the owner's label, as soon as their toggles are back on.
    const enabled = customerPagePlanFor(document, {
      ...state,
      recipe: { ...state.recipe, aboutEnabled: true, galleryEnabled: true },
    });
    expect(enabled.flatMap(planPage => planPage.sections
      .filter(section => section.sectionType === 'about' || section.sectionType === 'gallery')
      .map(section => [section.sectionType, section.label, section.id])))
      .toEqual([
        ['gallery', 'My work', gallery.id],
        ['about', 'Daniela’s story', about.id],
      ]);
  });

  it('does not re-inject hidden or removed starter modules into customer Preview', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'one_page';
    state.recipe.aboutEnabled = true;
    state.recipe.galleryEnabled = true;
    state.gallery.images = [galleryFixtureImage('example-gallery-removed')];
    const source = initializeStarter('one_page');
    const page = source.pages[0]!;
    const about = sectionOn(page, 'about');
    const gallery = sectionOn(page, 'gallery');

    // Control: both modules publish from the untouched starter document.
    expect(planTypes(customerPagePlanFor(source, state)))
      .toEqual(expect.arrayContaining(['about', 'gallery']));

    const withHiddenAbout = setSectionVisible(source, about.id, false);
    const document = removeSection(withHiddenAbout, gallery.id);
    const plan = customerPagePlanFor(document, state);

    expect(document.unusedSections.map(section => section.sectionType)).toEqual(['gallery']);
    expect(planTypes(plan)).not.toContain('about');
    expect(planTypes(plan)).not.toContain('gallery');
    expect(planIds(plan)).not.toContain('onboarding-preview-about');
    expect(planIds(plan)).not.toContain('onboarding-preview-gallery');
    expect(plan.flatMap(planPage => planPage.sections.filter(section => section.injected)))
      .toEqual([]);
  });

  it('never promotes an owner-added catalogue label into a native customer section', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'quick_book';
    state.recipe.policiesEnabled = true;
    const document = initializeStarter('quick_book');
    document.pages[0]!.sections.push({
      id: 'owner-labelled-policies',
      label: 'Policies',
      order: document.pages[0]!.sections.length,
      placeholderSettings: {},
      sectionType: 'section_08',
      size: 'medium',
      visible: true,
    });

    const plan = customerPagePlanFor(document, state);
    const policySections = plan.flatMap(page => page.sections.filter(section => (
      section.sectionType === 'policies'
    )));

    expect(policySections).toEqual([]);
    expect(planTypes(plan).filter(sectionType => sectionType === 'booking')).toHaveLength(1);
    expect(planIds(plan)).not.toContain('owner-labelled-policies');
    // A legacy numbered placeholder publishes nothing at all.
    expect(planTypes(plan)).not.toContain('section_08');
  });

  it.each([
    ['phone', 390, 780],
    ['tablet', 768, 900],
    ['desktop', 1180, 760],
  ] as const)('uses an inert inline %s viewport at its truthful target geometry', (device, width, height) => {
    const state = createDanielaFixtureState();
    const view = render(
      <OnboardingSitePreview
        device={device}
        document={initializeStarter('multi_page')}
        label={`${device} inline preview`}
        state={state}
      />,
    );
    const stage = screen.getByRole('region', { name: `${device} inline preview` });
    const frame = stage.querySelector('.onboarding-preview-frame') as HTMLDivElement;
    const customerSurface = stage.querySelector('.onboarding-site-preview') as HTMLDivElement;

    expect(ONBOARDING_PREVIEW_VIEWPORTS[device]).toEqual({ height, width });
    expect(stage).toHaveAttribute('data-preview-device', device);
    expect(stage).toHaveAttribute('data-preview-interaction', 'inline');
    expect(stage.style.getPropertyValue('--preview-target-width')).toBe(`${width}px`);
    expect(stage.style.getPropertyValue('--preview-target-height')).toBe(`${height}px`);
    expect(frame.inert).toBe(true);
    expect(frame).toHaveAttribute('tabindex', '-1');
    expect(customerSurface.inert).toBe(true);
    expect(stage).toHaveAccessibleDescription(expect.stringContaining(`${width}-pixel ${device} viewport`));

    view.rerender(
      <OnboardingSitePreview
        device={device}
        document={initializeStarter('multi_page')}
        interactionMode="interactive"
        label={`${device} inline preview`}
        state={state}
      />,
    );
    expect(frame.inert).toBe(false);
    expect(frame).toHaveAttribute('tabindex', '0');
    expect(customerSurface.inert).toBe(false);

    view.rerender(
      <OnboardingSitePreview
        device={device}
        document={initializeStarter('multi_page')}
        interactionMode="scrollable"
        label={`${device} inline preview`}
        state={state}
      />,
    );
    expect(frame.inert).toBe(false);
    expect(frame).toHaveAttribute('tabindex', '0');
    expect(customerSurface.inert).toBe(true);
    expect(stage).toHaveAccessibleDescription(expect.stringContaining('Swipe or scroll'));
  });

  it('recomputes each device from one stable unscaled host without ratcheting', async () => {
    const state = createDanielaFixtureState();
    const document = initializeStarter('multi_page');
    let available = { height: 600, width: 360 };
    const view = render(
      <OnboardingSitePreview
        device="phone"
        document={document}
        fitAvailable
        label="Stable scaling preview"
        state={state}
      />,
    );
    const stage = screen.getByRole('region', { name: 'Stable scaling preview' });
    const measurementHost = stage.querySelector<HTMLElement>(
      '[data-preview-measurement-host="true"]',
    );
    expect(measurementHost).not.toBeNull();
    if (!measurementHost) return;
    measurementHost.getBoundingClientRect = () => ({
      bottom: available.height,
      height: available.height,
      left: 0,
      right: available.width,
      top: 0,
      width: available.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const rerenderFor = (device: 'desktop' | 'phone' | 'tablet') => {
      view.rerender(
        <OnboardingSitePreview
          device={device}
          document={document}
          fitAvailable
          label="Stable scaling preview"
          state={state}
        />,
      );
      const expected = calculateOnboardingPreviewScale(
        available,
        ONBOARDING_PREVIEW_VIEWPORTS[device],
      );
      expect(stage).toHaveAttribute('data-preview-scale', expected.toFixed(4));
    };

    act(() => window.dispatchEvent(new Event('resize')));
    await act(async () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
    const originalPhoneScale = calculateOnboardingPreviewScale(
      available,
      ONBOARDING_PREVIEW_VIEWPORTS.phone,
    );
    await waitFor(() => expect(stage).toHaveAttribute(
      'data-preview-scale',
      originalPhoneScale.toFixed(4),
    ));

    for (let cycle = 0; cycle < 10; cycle += 1) {
      rerenderFor('desktop');
      rerenderFor('phone');
      expect(stage).toHaveAttribute('data-preview-scale', originalPhoneScale.toFixed(4));
    }
    rerenderFor('tablet');
    rerenderFor('phone');

    available = { height: 300, width: 700 };
    act(() => window.dispatchEvent(new Event('orientationchange')));
    await act(async () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
    await waitFor(() => expect(stage).toHaveAttribute(
      'data-preview-scale',
      calculateOnboardingPreviewScale(
        available,
        ONBOARDING_PREVIEW_VIEWPORTS.phone,
      ).toFixed(4),
    ));
    available = { height: 600, width: 360 };
    act(() => window.dispatchEvent(new Event('orientationchange')));
    await act(async () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
    await waitFor(() => expect(stage).toHaveAttribute(
      'data-preview-scale',
      originalPhoneScale.toFixed(4),
    ));
  });

  it('positions and resets the internal preview frame without moving the outer page', () => {
    const offsetTopDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetTop',
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.previewTarget === 'about' ? 468 : 0;
      },
    });
    document.documentElement.scrollTop = 137;
    document.body.scrollTop = 89;

    try {
      const state = createDanielaFixtureState();
      const view = render(
        <OnboardingSitePreview
          document={initializeStarter('one_page')}
          initialTarget="about"
          label="Targeted About preview"
          state={state}
        />,
      );
      const stage = screen.getByRole('region', { name: 'Targeted About preview' });
      const frame = stage.querySelector<HTMLElement>('[data-preview-scroll-container="true"]');

      expect(stage).toHaveAttribute('data-preview-initial-target', 'about');
      expect(frame).not.toBeNull();
      expect(frame?.scrollTop).toBe(468);
      expect(document.documentElement.scrollTop).toBe(137);
      expect(document.body.scrollTop).toBe(89);

      if (frame) frame.scrollTop = 712;
      view.rerender(
        <OnboardingSitePreview
          document={initializeStarter('one_page')}
          initialTarget="top"
          label="Targeted About preview"
          state={state}
        />,
      );

      expect(stage).toHaveAttribute('data-preview-initial-target', 'top');
      expect(frame?.scrollTop).toBe(0);
      expect(document.documentElement.scrollTop).toBe(137);
      expect(document.body.scrollTop).toBe(89);
    } finally {
      if (offsetTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTopDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop');
      }
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  });

  it('publishes each allowed phone action once in Visit & Contact and preserves a distinct text number', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'one_page';
    state.profile.bookingOnlyContact = false;
    state.profile.instagram = '';
    state.profile.email = '';
    state.profile.clientContact = {
      callEnabled: true,
      differentTextNumber: '647-555-0199',
      primaryNumber: '416-555-0100',
      textEnabled: true,
      useDifferentTextNumber: true,
    };
    state.profile.preferredContact = 'text';

    render(
      <OnboardingSitePreview document={initializeStarter('one_page')} interactionMode="interactive" label="Call and text preview" state={state} />,
    );
    const contact = within(screen.getByRole('region', { name: 'Call and text preview' }))
      .getByRole('region', { name: 'Visit and contact' });
    const text = within(contact).getByRole('link', { name: 'Text' });
    const call = within(contact).getByRole('link', { name: 'Call' });

    expect(text).toHaveAttribute('href', 'sms:6475550199');
    expect(text).toHaveAttribute('data-content-key', 'text');
    expect(call).toHaveAttribute('href', 'tel:4165550100');
    expect(call).toHaveAttribute('data-content-key', 'phone');
    expect(within(contact).queryByRole('link', { name: /Book/u })).not.toBeInTheDocument();
  });

  it('renders one long business identity on a Hero page while navigation remains separate', () => {
    const state = createDanielaFixtureState();
    const longName = 'Polished Beauty Lounge and Academy with an Exceptionally Long Studio Name';
    state.profile.businessName = longName;

    render(
      <OnboardingSitePreview device="desktop" document={initializeStarter('multi_page')} label="Long identity preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Long identity preview' });
    const brand = preview.querySelector('.onboarding-customer-brand');
    const identityOwners = preview.querySelectorAll('[data-business-identity]');
    const heroIdentity = preview.querySelector<HTMLElement>('[data-business-identity="hero"]');
    const navigation = within(preview).getByRole('navigation', { name: 'Customer preview navigation' });

    expect(brand).toHaveClass('onboarding-customer-brand');
    expect(brand?.querySelector('strong')).toBeNull();
    expect(identityOwners).toHaveLength(1);
    expect(heroIdentity).toHaveTextContent(longName);
    expect(brand).toHaveAttribute('title', longName);
    expect(navigation).not.toContainElement(heroIdentity);
    expect(within(navigation).getByRole('link', { name: 'Book' })).toBeVisible();
  });

  it('moves the single visible business identity to the header on a page without Hero', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
    state.profile.businessName = 'Isla Nails';

    render(
      <OnboardingSitePreview
        document={initializeStarter('multi_page')}
        interactionMode="interactive"
        label="Single identity preview"
        state={state}
      />,
    );
    const preview = screen.getByRole('region', { name: 'Single identity preview' });

    expect(preview.querySelectorAll('[data-business-identity]')).toHaveLength(1);
    expect(preview.querySelector('[data-business-identity="hero"]')).toHaveTextContent('Isla Nails');

    await user.click(within(preview).getByRole('link', { name: 'Services & Booking' }));

    expect(preview.querySelectorAll('[data-business-identity]')).toHaveLength(1);
    expect(preview.querySelector('[data-business-identity="site_header"]')).toHaveTextContent('Isla Nails');
    expect(within(preview).getByRole('region', { name: 'Booking' }))
      .not.toHaveTextContent('Isla Nails');
  });

  it('omits disabled optional modules without erasing their source drafts or leaving headings', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutEnabled = false;
    state.recipe.galleryEnabled = false;
    const preservedBio = state.profile.about.shortBio;
    render(
      <OnboardingSitePreview document={null} label="Optional modules preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Optional modules preview' });

    expect(within(preview).queryByRole('region', { name: /About/ })).not.toBeInTheDocument();
    expect(within(preview).queryByRole('region', { name: 'Gallery' })).not.toBeInTheDocument();
    expect(within(preview).queryByText('A little nail inspiration')).not.toBeInTheDocument();
    expect(state.profile.about.shortBio).toBe(preservedBio);
  });

  it('reuses one configured schedule and suppresses public status when hours are hidden or skipped', () => {
    const state = createDanielaFixtureState();
    // The one-page site owns the schedule in Visit Us. About and the rest of
    // the site consult the same plan and do not repeat it.
    state.recipe.starter = 'one_page';
    state.recipe.aboutPreset = 'profile_quick_facts';
    state.reviewOptions.previewTimestamp = '2026-08-27T18:30:00.000Z';
    const view = render(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Shared hours preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Shared hours preview' });
    const about = within(preview).getByRole('region', { name: 'About' });
    const weeklyHours = preview.querySelector<HTMLElement>('[data-content-key="business_hours"]')!;
    expect(within(weeklyHours).getByText('Thu')).toBeVisible();
    expect(within(weeklyHours).getAllByText('10:00 AM–6:00 PM')).toHaveLength(5);
    expect(weeklyHours).toHaveTextContent('Closed Sunday.');
    expect(within(about).queryByText('Hours')).not.toBeInTheDocument();
    expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(1);

    const hidden = {
      ...state,
      profile: {
        ...state.profile,
        hours: { ...state.profile.hours, showOnSite: false },
      },
    };
    view.rerender(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Shared hours preview" state={hidden} />,
    );
    expect(preview.querySelector('[data-hours-status]')).toBeNull();
    expect(within(preview).queryByRole('group', { name: 'Weekly hours' }))
      .not.toBeInTheDocument();
    expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(0);

    const skipped = {
      ...hidden,
      profile: {
        ...hidden.profile,
        hours: { ...hidden.profile.hours, setupState: 'skipped' as const },
      },
    };
    view.rerender(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Shared hours preview" state={skipped} />,
    );
    expect(preview.querySelector('[data-hours-status]')).toBeNull();
    expect(preview.querySelectorAll('[data-content-key="business_hours"]')).toHaveLength(0);
    expect(within(preview).queryByRole('group', { name: 'Weekly hours' }))
      .not.toBeInTheDocument();
  });

  it('respects address privacy, general-area Directions permission, and Booking-only contact', () => {
    const state = createDanielaFixtureState();
    // Quick Book presents shared location data in its compact profile while
    // its template-specific visibility never overrides address/contact privacy.
    state.recipe.starter = 'quick_book';
    state.recipe.quickBookProfile.showLocation = true;
    state.recipe.quickBookProfile.showPhone = true;
    state.recipe.quickBookProfile.showInstagram = false;
    state.profile.about.visibility.instagram = false;
    state.profile.location.exactAddress = '123 Example Avenue';
    state.profile.bookingOnlyContact = true;
    state.profile.clientContact.primaryNumber = '416-555-0100';
    state.profile.clientContact.callEnabled = true;
    state.profile.preferredContact = 'call';
    const view = render(
      <OnboardingSitePreview
        document={null}
        label="Privacy preview"
        quickBookPhase="business"
        state={state}
      />,
    );
    const preview = screen.getByRole('region', { name: 'Privacy preview' });
    const profile = within(preview).getByRole('region', { name: state.profile.businessName });

    expect(within(profile).getByText('Scarborough, Ontario')).toBeVisible();
    expect(within(profile).getByText('Exact address shared after booking.')).toBeVisible();
    expect(within(profile).queryByText('123 Example Avenue')).not.toBeInTheDocument();
    expect(within(profile).queryByText('416-555-0100')).not.toBeInTheDocument();
    expect(within(profile).queryByRole('link')).not.toBeInTheDocument();

    const publicArea = {
      ...state,
      profile: {
        ...state.profile,
        location: {
          ...state.profile.location,
          addressVisibility: 'public' as const,
          allowGeneralAreaDirections: true,
          exactAddress: '',
        },
      },
    };
    view.rerender(
      <OnboardingSitePreview
        document={null}
        label="Privacy preview"
        quickBookPhase="business"
        state={publicArea}
      />,
    );

    expect(within(profile).getByRole('link', { name: /Scarborough, Ontario/u }))
      .toHaveAttribute('href', expect.stringContaining('Scarborough'));

    const publicExact = {
      ...publicArea,
      profile: {
        ...publicArea.profile,
        location: {
          ...publicArea.profile.location,
          exactAddress: '123 Example Avenue',
        },
      },
    };
    view.rerender(
      <OnboardingSitePreview
        document={null}
        interactionMode="interactive"
        label="Privacy preview"
        quickBookPhase="business"
        state={publicExact}
      />,
    );

    expect(within(profile).getByText('123 Example Avenue')).toBeVisible();
    expect(within(profile).getByRole('link', { name: /123 Example Avenue/u }))
      .toHaveAttribute('href', expect.stringContaining('123%20Example%20Avenue'));

    const hidden = {
      ...publicArea,
      profile: {
        ...publicArea.profile,
        location: { ...publicArea.profile.location, addressVisibility: 'hidden' as const },
      },
    };
    view.rerender(
      <OnboardingSitePreview
        document={null}
        label="Privacy preview"
        quickBookPhase="business"
        state={hidden}
      />,
    );

    expect(within(profile).queryByRole('link')).not.toBeInTheDocument();
    expect(within(profile).queryByText('123 Example Avenue')).not.toBeInTheDocument();
  });
});
