import { describe, expect, it } from 'vitest';

import { createDemoOnboardingState, DEMO_SITE_CONTENT } from '../onboarding/model/demo-content';
import { deriveSiteLibraryContext, deriveSitePlanToggles } from '../onboarding/model/site-library-context';
import {
  getContentPlacement,
  getSectionContentSuppressions,
  SITE_CONTENT_PLACEMENT_VERSION,
} from './content-placement';
import { setSectionVisible } from './operations';
import {
  buildWebsiteRecipeDocument,
  getRecipeRequiredToggles,
} from './section-library/recipes';
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
  it('uses one versioned plan for all substantive one-page owners', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'one_page';
    const document = initializeStarter('one_page');
    const { contentPlacement, pages } = compositionFor(document, state);
    const about = sectionOf(document, 'about');
    const booking = sectionOf(document, 'booking');
    const deposits = sectionOf(document, 'deposits_cancellations');
    const featured = sectionOf(document, 'featured_services');
    const footer = sectionOf(document, 'footer');
    const policies = sectionOf(document, 'policies');
    const quickInfo = sectionOf(document, 'quick_info');
    const visit = sectionOf(document, 'visit_us');

    expect(contentPlacement.version).toBe(SITE_CONTENT_PLACEMENT_VERSION);
    expect(getContentPlacement(contentPlacement, 'brand_logo').ownerSectionId)
      .toBe('site_header');
    expect(getContentPlacement(contentPlacement, 'owner_profile_photo').ownerSectionId)
      .toBe(about.id);
    expect(getContentPlacement(contentPlacement, 'instagram').ownerSectionId)
      .toBe(footer.id);
    expect(getContentPlacement(contentPlacement, 'phone').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'text').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'location').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'business_hours').ownerSectionId)
      .toBe(visit.id);
    expect(getContentPlacement(contentPlacement, 'appointment_mode').ownerSectionId)
      .toBe(quickInfo.id);
    expect(getContentPlacement(contentPlacement, 'new_client_status').ownerSectionId)
      .toBe(quickInfo.id);
    // Default Quick Info does not opt into this fact, so Booking is the next
    // eligible owner rather than silently losing the notice.
    expect(getContentPlacement(contentPlacement, 'minimum_notice').ownerSectionId)
      .toBe(booking.id);
    expect(getContentPlacement(contentPlacement, 'deposit_cancellation_policy').ownerSectionId)
      .toBe(deposits.id);
    expect(getContentPlacement(contentPlacement, 'before_you_book_policies').ownerSectionId)
      .toBe(policies.id);
    expect(pages.flatMap(page => page.sections).map(section => section.id))
      .not.toContain(featured.id);
    expect(getSectionContentSuppressions(contentPlacement, featured.id)).toEqual([
      expect.objectContaining({
        actionLabel: 'Go to Services & Booking',
        ownerSectionId: booking.id,
        reason: 'Featured Services is not shown on this page because Services & Booking already displays your services.',
        suppressEntireSection: true,
      }),
    ]);
    expect(contentPlacement.showBookingFeaturedRail).toBe(true);
  });

  it('falls back deterministically when Contact, Hours, About, or policies hide', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'multi_page';
    let document = initializeStarter('multi_page');
    document.siteContent = structuredClone(DEMO_SITE_CONTENT);
    const team = sectionOf(document, 'team');
    if (team.sectionType !== 'team') {
      throw new Error('Expected Team');
    }
    team.settings.memberIds = DEMO_SITE_CONTENT.staff.map(member => member.id);
    const contact = sectionOf(document, 'contact');
    const hours = sectionOf(document, 'hours');
    const about = sectionOf(document, 'about');
    const deposits = sectionOf(document, 'deposits_cancellations');
    const policies = sectionOf(document, 'policies');
    const visit = sectionOf(document, 'visit_us');

    let plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'instagram').ownerSectionId).toBe(contact.id);
    expect(getContentPlacement(plan, 'phone').ownerSectionId).toBe(contact.id);
    expect(getContentPlacement(plan, 'business_hours').ownerSectionId).toBe(hours.id);
    expect(getContentPlacement(plan, 'owner_profile_photo').ownerSectionId).toBe(about.id);

    document = setSectionVisible(document, contact.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'phone').ownerSectionId).toBe(visit.id);
    expect(getContentPlacement(plan, 'instagram').ownerSectionId)
      .toBe(document.pages[0]?.sections.find(section => section.sectionType === 'footer')?.id);

    document = setSectionVisible(document, hours.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'business_hours').ownerSectionId).toBe(visit.id);

    const quickInfo = sectionOf(document, 'quick_info');
    const booking = sectionOf(document, 'booking');
    document = setSectionVisible(document, quickInfo.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'appointment_mode').ownerSectionId).toBe(booking.id);
    expect(getContentPlacement(plan, 'new_client_status').ownerSectionId).toBe(booking.id);
    expect(getContentPlacement(plan, 'minimum_notice').ownerSectionId).toBe(booking.id);

    document = setSectionVisible(document, about.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'owner_profile_photo').ownerSectionId).toBe(team.id);
    expect(getContentPlacement(plan, 'hero_media').ownerSectionId).toBeNull();

    const stateWithoutOwnerStaff = structuredClone(state);
    stateWithoutOwnerStaff.profile.ownerName = 'Owner not listed in Team';

    expect(getContentPlacement(
      compositionFor(document, stateWithoutOwnerStaff).contentPlacement,
      'owner_profile_photo',
    ).ownerSectionId).toBeNull();

    document = setSectionVisible(document, deposits.id, false);
    document = setSectionVisible(document, policies.id, false);
    plan = compositionFor(document, state).contentPlacement;

    expect(getContentPlacement(plan, 'deposit_cancellation_policy').ownerSectionId).toBeNull();
    expect(getContentPlacement(plan, 'before_you_book_policies').ownerSectionId).toBeNull();

    expect(compositionFor(document, state).contentPlacement)
      .toEqual(compositionFor(structuredClone(document), structuredClone(state)).contentPlacement);
  });

  it('allows Featured on Home while Booking owns the catalogue on Services', () => {
    const state = stateWithMedia();
    state.recipe.starter = 'multi_page';
    const document = initializeStarter('multi_page');
    const featured = sectionOf(document, 'featured_services');
    const booking = sectionOf(document, 'booking');
    const { contentPlacement, pages } = compositionFor(document, state);
    const home = pages.find(page => page.isHome)!;
    const services = pages.find(page => page.slug === 'services-book')!;

    expect(home.sections.map(section => section.id)).toContain(featured.id);
    expect(services.sections.map(section => section.id)).toContain(booking.id);
    expect(getContentPlacement(contentPlacement, 'service_marketing', home.id).ownerSectionId)
      .toBe(featured.id);
    expect(getContentPlacement(contentPlacement, 'service_catalogue').ownerSectionId)
      .toBe(booking.id);
    expect(contentPlacement.showBookingFeaturedRail).toBe(false);
  });

  it('gives a repeated Gallery collection to the dedicated Gallery page', () => {
    const state = stateWithMedia();
    state.recipe = {
      ...state.recipe,
      ...getRecipeRequiredToggles('the_collective'),
    };
    const document = buildWebsiteRecipeDocument('the_collective');
    const { contentPlacement, pages } = compositionFor(document, state);
    const galleryPage = pages.find(page => page.label === 'Gallery')!;
    const home = pages.find(page => page.isHome)!;
    const galleryOwner = galleryPage.sections.find(section => section.sectionType === 'gallery')!;

    expect(getContentPlacement(contentPlacement, 'gallery_media').ownerSectionId)
      .toBe(galleryOwner.id);
    expect(home.sections.some(section => section.sectionType === 'gallery')).toBe(false);
    expect(getSectionContentSuppressions(
      contentPlacement,
      document.pages.find(page => page.isHome)!.sections.find(
        section => section.sectionType === 'gallery',
      )!.id,
    )).toEqual([
      expect.objectContaining({
        actionLabel: 'Go to Gallery',
        ownerSectionId: galleryOwner.id,
        suppressEntireSection: true,
      }),
    ]);
  });
});
