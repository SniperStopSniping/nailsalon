import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import type { CustomDesignImageItem } from '../../custom-design/model/types';
import { initializeStarter } from '../../model';
import type { CustomDesignSectionInstance } from '../../model/types';
import { createDanielaFixtureState } from '../fixtures';
import { ONBOARDING_NEXT_AVAILABILITY_LABEL } from '../model/booking-preview';
import {
  getOnboardingDocumentBookingSequence,
  OnboardingSitePreview,
} from './OnboardingSitePreview';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: (assetIds: readonly string[]) => new Map(
    assetIds.map((assetId) => [assetId, {
      original: {
        assetId,
        kind: 'original',
        status: 'ready',
        url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      },
      thumbnail: {
        assetId,
        kind: 'thumbnail',
        status: 'ready',
        url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
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

describe('OnboardingSitePreview shared profile composition', () => {
  it('personalizes embedded Booking identity while preserving its canonical menu and availability', () => {
    const state = createDanielaFixtureState();
    state.profile.businessName = 'Cedar Tips';
    state.profile.location.cityOrArea = 'Ottawa, Ontario';
    const document = initializeStarter('quick_book');

    render(
      <OnboardingSitePreview document={document} label="Personalized Booking preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Personalized Booking preview' });
    const booking = within(preview).getByRole('region', { name: 'Booking' });

    expect(within(booking).getByRole('heading', { level: 2, name: 'Cedar Tips' })).toBeVisible();
    expect(within(booking).getByText('Ottawa, Ontario')).toBeVisible();
    expect(within(booking).queryByText('Isla Nail Studio')).not.toBeInTheDocument();
    expect(within(booking).queryByText('Toronto, Ontario')).not.toBeInTheDocument();
    expect(within(booking).queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(within(preview).getByText(`Next opening · ${ONBOARDING_NEXT_AVAILABILITY_LABEL}`))
      .toBeVisible();
    expect(within(preview).getByTestId('canonical-booking-example')).toHaveTextContent(
      'Russian Manicure + French1 hr 45 min · From $80',
    );
  });

  it('renders real Custom Design sections around Booking in universal document order', () => {
    const state = createDanielaFixtureState();
    state.recipe.canvaEnabled = false;
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
    expect(afterElement).not.toBeNull();
    expect((beforeElement!.compareDocumentPosition(bookingElement)
      & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect((bookingElement.compareDocumentPosition(afterElement!)
      & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it('reuses the same profile across About layouts and updates every Instagram use', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutPreset = 'photo_right';
    const originalProfile = state.profile;
    const view = render(
      <OnboardingSitePreview document={null} label="Shared profile preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Shared profile preview' });
    const about = within(preview).getByRole('region', { name: 'About' });
    expect(within(about).getByText(state.profile.about.shortBio)).toBeVisible();
    expect(within(about).getByRole('button', { name: /@islanail\.studio/ })).toBeVisible();
    expect(within(preview).getByTestId('canonical-booking-example')).toHaveTextContent(
      'Russian Manicure + French1 hr 45 min · From $80',
    );

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
    expect(within(updatedAbout).getByRole('button', { name: /@isla\.updated/ })).toBeVisible();
    expect(within(updatedAbout).queryByText('@islanail.studio')).not.toBeInTheDocument();
    expect(next.profile.about).toBe(originalProfile.about);
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
    state.recipe.aboutPreset = 'profile_quick_facts';
    const view = render(
      <OnboardingSitePreview document={null} label="Shared hours preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Shared hours preview' });
    const about = within(preview).getByRole('region', { name: 'About' });
    expect(preview.querySelector('[data-hours-status="open"]')).toHaveTextContent(
      'Open until 6:00 PM',
    );
    const weeklyHours = within(preview).getByRole('group', { name: 'Weekly hours' });
    expect(within(weeklyHours).getByText('Thursday')).toBeVisible();
    expect(within(weeklyHours).getAllByText('10:00 AM–6:00 PM')).toHaveLength(5);
    expect(within(weeklyHours).getByText('Sunday')).toBeVisible();
    expect(within(weeklyHours).getByText('Closed')).toBeVisible();
    expect(within(about).getByText('Hours')).toBeVisible();
    expect(within(about).getByText('Open until 6:00 PM')).toBeVisible();

    const hidden = {
      ...state,
      profile: {
        ...state.profile,
        hours: { ...state.profile.hours, showOnSite: false },
      },
    };
    view.rerender(
      <OnboardingSitePreview document={null} label="Shared hours preview" state={hidden} />,
    );
    expect(preview.querySelector('[data-hours-status]')).toBeNull();
    expect(within(preview).queryByRole('group', { name: 'Weekly hours' }))
      .not.toBeInTheDocument();
    expect(within(about).queryByText('Hours')).not.toBeInTheDocument();
    expect(within(about).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();

    const skipped = {
      ...hidden,
      profile: {
        ...hidden.profile,
        hours: { ...hidden.profile.hours, setupState: 'skipped' as const },
      },
    };
    view.rerender(
      <OnboardingSitePreview document={null} label="Shared hours preview" state={skipped} />,
    );
    expect(preview.querySelector('[data-hours-status]')).toBeNull();
    expect(within(about).queryByText('Hours')).not.toBeInTheDocument();
    expect(within(preview).queryByRole('group', { name: 'Weekly hours' }))
      .not.toBeInTheDocument();
  });

  it('respects address privacy, general-area Directions permission, and Booking-only contact', () => {
    const state = createDanielaFixtureState();
    state.profile.location.exactAddress = '123 Example Avenue';
    state.profile.bookingOnlyContact = true;
    state.profile.clientContact.primaryNumber = '416-555-0100';
    state.profile.clientContact.callEnabled = true;
    state.profile.preferredContact = 'call';
    const view = render(
      <OnboardingSitePreview document={null} label="Privacy preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Privacy preview' });
    const contact = within(preview).getByRole('region', { name: 'Visit and contact' });
    expect(within(contact).getByText('Scarborough, Ontario')).toBeVisible();
    expect(within(contact).getByText('Exact address shared after booking.')).toBeVisible();
    expect(within(contact).queryByText('123 Example Avenue')).not.toBeInTheDocument();
    expect(within(contact).queryByText('416-555-0100')).not.toBeInTheDocument();
    expect(within(contact).queryByRole('button', { name: 'Directions' })).not.toBeInTheDocument();
    expect(within(contact).getByRole('button', { name: 'Book now' })).toBeVisible();

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
      <OnboardingSitePreview document={null} label="Privacy preview" state={publicArea} />,
    );
    expect(within(contact).getByRole('button', { name: 'Directions' })).toBeVisible();

    const hidden = {
      ...publicArea,
      profile: {
        ...publicArea.profile,
        location: { ...publicArea.profile.location, addressVisibility: 'hidden' as const },
      },
    };
    view.rerender(
      <OnboardingSitePreview document={null} label="Privacy preview" state={hidden} />,
    );
    expect(within(contact).queryByRole('button', { name: 'Directions' })).not.toBeInTheDocument();
  });
});
