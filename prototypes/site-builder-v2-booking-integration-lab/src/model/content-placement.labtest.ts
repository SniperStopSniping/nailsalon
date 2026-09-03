import { describe, expect, it } from 'vitest';

import { createDemoOnboardingState, DEMO_SITE_CONTENT } from '../onboarding/model/demo-content';
import {
  deriveBuilderSitePlanToggles,
  deriveSiteLibraryContext,
  deriveSitePlanToggles,
} from '../onboarding/model/site-library-context';
import {
  getContentPlacement,
  getSectionContentSuppressions,
  SITE_CONTENT_PLACEMENT_VERSION,
} from './content-placement';
import { addSection, setSectionVisible } from './operations';
import { buildCustomerSiteComposition } from './site-plan';
import { initializeStarter } from './starters';
import type { SectionType, SiteBuilderDocument } from './types';

const stateWithMedia = () => {
  const state = createDemoOnboardingState();
  state.profile.logo = {
    fileName: 'wordmark.png',
    id: 'logo-reference',
    mimeType: 'image/png',
    previewUrl: '/logo.png',
    source: 'fixture',
  };
  state.profile.bookingOnlyContact = false;
  state.profile.clientContact.callEnabled = true;
  state.profile.profilePhoto = {
    fileName: 'portrait.png',
    id: 'profile-reference',
    mimeType: 'image/png',
    previewUrl: '/portrait.png',
    source: 'fixture',
  };
  state.profile.about.visibility.profile_photo = true;
  state.recipe = {
    ...state.recipe,
    aboutEnabled: true,
    galleryEnabled: true,
    policiesEnabled: true,
  };
  return state;
};

const compositionFor = (
  document: SiteBuilderDocument,
  state = stateWithMedia(),
) => buildCustomerSiteComposition(document, {
  context: deriveSiteLibraryContext(state, document),
  toggles: deriveSitePlanToggles(state),
});

const sectionOf = (document: SiteBuilderDocument, type: SectionType) => {
  const section = document.pages.flatMap(page => page.sections)
    .find(candidate => candidate.sectionType === type);
  if (!section) {
    throw new Error(`Missing ${type}`);
  }
  return section;
};

describe('site content placement plan', () => {
  it('splits Quick Book compact profile facts from full Visit & Contact details', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'quick_book';
    const document = initializeStarter('quick_book');
    document.siteContent = structuredClone(DEMO_SITE_CONTENT);
    const { contentPlacement, pages } = compositionFor(document, state);
    const profile = sectionOf(document, 'hero');
    const booking = sectionOf(document, 'booking');
    const visit = sectionOf(document, 'visit_us');

    expect(pages[0]?.sections.map(section => section.sectionType))
      .toEqual(['hero', 'booking', 'gallery', 'visit_us']);
    expect(getContentPlacement(contentPlacement, 'brand_logo').ownerSectionId)
      .toBe(profile.id);
    expect(getContentPlacement(contentPlacement, 'owner_profile_photo').ownerSectionId)
      .toBe(profile.id);
    expect(getContentPlacement(contentPlacement, 'location').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'exact_address').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'arrival_details').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'business_hours').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'phone').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'text').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'email').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'instagram').ownerSectionId)
      .toBe(profile.id);
    expect(getContentPlacement(contentPlacement, 'deposit_cancellation_policy').ownerSectionId)
      .toBe(profile.id);
    expect(getContentPlacement(contentPlacement, 'before_you_book_policies').ownerSectionId)
      .toBe(profile.id);
    expect(getContentPlacement(contentPlacement, 'reviews', pages[0]!.id).ownerSectionId)
      .toBe(profile.id);
    expect(getContentPlacement(contentPlacement, 'service_catalogue').ownerSectionId)
      .toBe(booking.id);
  });

  it('keeps booking-only contact in Quick Book Visit & Contact', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'quick_book';
    state.profile.bookingOnlyContact = true;
    state.profile.clientContact.callEnabled = false;
    state.profile.clientContact.textEnabled = false;
    const document = initializeStarter('quick_book');
    const { contentPlacement, pages } = compositionFor(document, state);
    const visit = sectionOf(document, 'visit_us');

    expect(pages[0]?.sections.map(section => section.sectionType))
      .toContain('visit_us');
    expect(getContentPlacement(contentPlacement, 'booking_only_contact').ownerSectionId)
      .toBe(visit.id);
  });

  it('compacts Quick Book when Visit & Contact has no unique public details', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'quick_book';
    state.recipe.galleryEnabled = false;
    state.gallery.images = [];
    state.profile.bookingOnlyContact = false;
    state.profile.clientContact = {
      callEnabled: false,
      differentTextNumber: '',
      primaryNumber: '',
      textEnabled: false,
      useDifferentTextNumber: false,
    };
    state.profile.email = '';
    state.profile.location = {
      ...state.profile.location,
      cityOrArea: '',
      entranceInstructions: '',
      exactAddress: '',
      parking: '',
      transitInformation: '',
    };
    state.profile.hours = {
      ...state.profile.hours,
      setupState: 'skipped',
      showOnSite: false,
    };
    const document = initializeStarter('quick_book');
    const visit = sectionOf(document, 'visit_us');
    const { contentPlacement, pages } = compositionFor(document, state);

    // Instagram remains valid but belongs to the compact Profile, so it may
    // not keep an otherwise empty Visit section on the customer page.
    expect(getContentPlacement(contentPlacement, 'instagram').ownerSectionId)
      .toBe(sectionOf(document, 'hero').id);
    expect(pages[0]?.sections.map(section => section.sectionType))
      .toEqual(['hero', 'booking']);
    expect(getSectionContentSuppressions(contentPlacement, visit.id))
      .toContainEqual(expect.objectContaining({ suppressEntireSection: true }));
  });

  it('uses one versioned plan for all substantive one-page owners', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'one_page';
    const document = initializeStarter('one_page');
    document.siteContent = structuredClone(DEMO_SITE_CONTENT);
    const reviews = sectionOf(document, 'reviews');
    if (reviews.sectionType !== 'reviews') throw new Error('Expected Reviews');
    reviews.settings.reviewIds = DEMO_SITE_CONTENT.reviews.map(review => review.id);
    const { contentPlacement, pages } = compositionFor(document, state);
    const about = sectionOf(document, 'about');
    const booking = sectionOf(document, 'booking');
    const gallery = sectionOf(document, 'gallery');
    const policies = sectionOf(document, 'policies');
    const visit = sectionOf(document, 'visit_us');

    expect(contentPlacement.version).toBe(SITE_CONTENT_PLACEMENT_VERSION);
    expect(pages.flatMap(page => page.sections).map(section => section.sectionType))
      .toEqual(['hero', 'gallery', 'about', 'booking', 'reviews', 'policies', 'visit_us']);
    expect(getContentPlacement(contentPlacement, 'brand_logo').ownerSectionId)
      .toBe('site_header');
    expect(getContentPlacement(contentPlacement, 'owner_profile_photo').ownerSectionId)
      .toBe(about.id);
    expect(getContentPlacement(contentPlacement, 'instagram').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'phone').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'text').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'email').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'location').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'business_hours').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'appointment_mode').ownerSectionId)
      .toBe(booking.id);
    expect(getContentPlacement(contentPlacement, 'new_client_status').ownerSectionId)
      .toBe(booking.id);
    expect(getContentPlacement(contentPlacement, 'minimum_notice').ownerSectionId)
      .toBe(booking.id);
    expect(getContentPlacement(contentPlacement, 'deposit_cancellation_policy').ownerSectionId)
      .toBe(policies.id);
    expect(getContentPlacement(contentPlacement, 'before_you_book_policies').ownerSectionId)
      .toBe(policies.id);
    expect(getContentPlacement(contentPlacement, 'service_catalogue').ownerSectionId)
      .toBe(booking.id);
    expect(getContentPlacement(contentPlacement, 'service_marketing').ownerSectionId)
      .toBeNull();
    expect(getContentPlacement(contentPlacement, 'gallery_media').ownerSectionId)
      .toBe(gallery.id);
    expect(getContentPlacement(contentPlacement, 'reviews', pages[0]!.id).ownerSectionId)
      .toBe(reviews.id);
    expect(contentPlacement.showBookingFeaturedRail).toBe(false);
  });

  it('does not move hidden core content into duplicate technical sections', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'multi_page';
    let document = initializeStarter('multi_page');
    document.siteContent = structuredClone(DEMO_SITE_CONTENT);
    const about = sectionOf(document, 'about');
    const booking = sectionOf(document, 'booking');
    const policies = sectionOf(document, 'policies');
    const visit = sectionOf(document, 'visit_us');

    let plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'instagram').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(plan, 'phone').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(plan, 'business_hours').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(plan, 'owner_profile_photo').ownerSectionId).toBe(about.id);
    expect(getContentPlacement(plan, 'deposit_cancellation_policy').ownerSectionId)
      .toBe(policies.id);
    expect(getContentPlacement(plan, 'before_you_book_policies').ownerSectionId)
      .toBe(policies.id);

    document = setSectionVisible(document, visit.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'instagram').ownerSectionId).toBeNull();
    expect(getContentPlacement(plan, 'phone').ownerSectionId).toBeNull();
    expect(getContentPlacement(plan, 'business_hours').ownerSectionId).toBeNull();
    expect(getContentPlacement(plan, 'location').ownerSectionId).toBeNull();

    document = setSectionVisible(document, about.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'owner_profile_photo').ownerSectionId).toBeNull();
    expect(getContentPlacement(plan, 'hero_media').ownerSectionId).toBeNull();

    document = setSectionVisible(document, policies.id, false);
    plan = compositionFor(document, state).contentPlacement;

    // Booking remains the one permissible transactional fallback. No hidden
    // Deposits or second policy section is introduced into the document.
    expect(getContentPlacement(plan, 'deposit_cancellation_policy').ownerSectionId)
      .toBe(booking.id);
    expect(getContentPlacement(plan, 'before_you_book_policies').ownerSectionId)
      .toBe(booking.id);
    expect(document.pages.flatMap(page => page.sections).some(section => (
      section.sectionType === 'deposits_cancellations'
    ))).toBe(false);

    expect(compositionFor(document, state).contentPlacement)
      .toEqual(compositionFor(structuredClone(document), structuredClone(state)).contentPlacement);
  });

  it('keeps one catalogue on Services and no Featured Services duplicate on Home', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'multi_page';
    const document = initializeStarter('multi_page');
    document.siteContent = structuredClone(DEMO_SITE_CONTENT);
    const reviews = sectionOf(document, 'reviews');
    if (reviews.sectionType !== 'reviews') throw new Error('Expected Reviews');
    reviews.settings.reviewIds = DEMO_SITE_CONTENT.reviews.map(review => review.id);
    const booking = sectionOf(document, 'booking');
    const { contentPlacement, pages } = compositionFor(document, state);
    const home = pages.find(page => page.isHome)!;
    const services = pages.find(page => page.slug === 'services-book')!;

    expect(home.sections.map(section => section.sectionType)).toEqual(['hero', 'reviews']);
    expect(services.sections.map(section => section.id)).toContain(booking.id);
    expect(pages.flatMap(page => page.sections).filter(section => (
      section.sectionType === 'booking'
    ))).toHaveLength(1);
    expect(pages.flatMap(page => page.sections).some(section => (
      section.sectionType === 'featured_services'
    ))).toBe(false);
    expect(getContentPlacement(contentPlacement, 'service_marketing', home.id).ownerSectionId)
      .toBeNull();
    expect(getContentPlacement(contentPlacement, 'service_catalogue').ownerSectionId)
      .toBe(booking.id);
    expect(contentPlacement.showBookingFeaturedRail).toBe(false);
  });

  it('lets an explicitly added core section override an older onboarding skip', () => {
    const state = stateWithMedia();
    state.recipe.aboutEnabled = false;
    state.recipe.canvaEnabled = false;
    state.recipe.galleryEnabled = false;
    state.recipe.policiesEnabled = false;
    const starter = initializeStarter('one_page');
    const home = starter.pages[0];
    if (!home) {
      throw new Error('One-page starter is missing Home.');
    }
    const withoutOptionalSections = {
      ...starter,
      pages: [{
        ...home,
        sections: home.sections.filter(section => ![
          'about',
          'gallery',
          'policies',
        ].includes(section.sectionType)),
      }],
    };

    expect(deriveSitePlanToggles(state)).toEqual({
      aboutEnabled: false,
      canvaEnabled: false,
      galleryEnabled: false,
      policiesEnabled: false,
    });
    expect(deriveBuilderSitePlanToggles(state, withoutOptionalSections)).toEqual({
      aboutEnabled: false,
      canvaEnabled: false,
      galleryEnabled: false,
      policiesEnabled: false,
    });

    const withAddedGallery = addSection(withoutOptionalSections, {
      pageId: home.id,
      position: 1,
      sectionType: 'gallery',
    });

    const builderToggles = deriveBuilderSitePlanToggles(state, withAddedGallery);

    expect(builderToggles).toEqual({
      aboutEnabled: false,
      canvaEnabled: false,
      galleryEnabled: true,
      policiesEnabled: false,
    });
    expect(buildCustomerSiteComposition(withAddedGallery, {
      context: deriveSiteLibraryContext(state, withAddedGallery),
      toggles: builderToggles,
    }).pages[0]?.sections.map(section => section.sectionType)).toContain('gallery');
  });

  it('gives Gallery media only to the dedicated Multi-page Gallery page', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'multi_page';
    const document = initializeStarter('multi_page');
    const { contentPlacement, pages } = compositionFor(document, state);
    const galleryPage = pages.find(page => page.label === 'Gallery')!;
    const home = pages.find(page => page.isHome)!;
    const galleryOwner = galleryPage.sections.find(section => section.sectionType === 'gallery')!;

    expect(getContentPlacement(contentPlacement, 'gallery_media').ownerSectionId)
      .toBe(galleryOwner.id);
    expect(home.sections.some(section => section.sectionType === 'gallery')).toBe(false);
    expect(document.pages.flatMap(page => page.sections).filter(section => (
      section.sectionType === 'gallery'
    ))).toHaveLength(1);
    expect(pages.flatMap(page => page.sections).filter(section => (
      section.sectionType === 'gallery'
    ))).toHaveLength(1);
    expect(getSectionContentSuppressions(contentPlacement, galleryOwner.id)).toEqual([]);
  });
});
