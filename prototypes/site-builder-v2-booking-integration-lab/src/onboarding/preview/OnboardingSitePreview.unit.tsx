import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { createDefaultCustomDesignSettings } from '../../custom-design/model/settings';
import type { CustomDesignImageItem } from '../../custom-design/model/types';
import { initializeStarter } from '../../model';
import type { CustomDesignSectionInstance } from '../../model/types';
import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import type { AboutPresetId } from '../model/types';
import {
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

  it('renders the next opening derived from the shared schedule and deterministic preview clock', () => {
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
      <OnboardingSitePreview document={initializeStarter('quick_book')} label="Derived hours preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Derived hours preview' });

    expect(preview.querySelector('[data-hours-status="closed"]')).toHaveTextContent(
      'Opens tomorrow at 10:30 AM',
    );
    expect(within(preview).getByRole('group', { name: 'Weekly hours' }))
      .toHaveTextContent('Thursday10:30 AM–6:00 PM');
    expect(within(preview).queryByText(/Tomorrow at 10:30 AM|Next opening/u))
      .not.toBeInTheDocument();
  });

  it('personalizes embedded Booking identity while preserving its canonical menu and shared hours', () => {
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
    expect(within(preview).getAllByText('Open until 6:00 PM').length).toBeGreaterThan(0);
    expect(within(preview).queryByText(/Next opening/u)).not.toBeInTheDocument();
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

  it('activates a Canva Booking CTA against the real Booking section without changing the page hash', async () => {
    const user = userEvent.setup();
    const state = createDanielaFixtureState();
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
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
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
      expect(canvaSection).not.toBeNull();
      expect(bookingSection).toHaveAttribute('aria-label', 'Booking');
      await user.click(within(canvaSection!).getByRole('button', { name: 'Book now' }));

      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.instances[0]).toBe(bookingSection);
      expect(window.location.hash).toBe('#onboarding-preview');
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
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
    expect(within(about).getByRole('link', { name: /@islanail\.studio/ })).toBeVisible();
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
    expect(within(updatedAbout).getByRole('link', { name: /@isla\.updated/ })).toBeVisible();
    expect(within(updatedAbout).queryByText('@islanail.studio')).not.toBeInTheDocument();
    expect(next.profile.about).toBe(originalProfile.about);
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

    expect(within(about).getByRole('img', {
      name: 'Daniela portrait illustration',
    })).toBeVisible();
    expect(within(about).getByRole('heading', { level: 2, name: 'Daniela' })).toBeVisible();
    expect(within(about).getByText('Isla Nail Studio')).toBeVisible();
    expect(within(about).getByText(
      preset === 'editorial_portrait'
        ? state.profile.about.fullBio
        : state.profile.about.shortBio,
    )).toBeVisible();
    expect(within(about).getByText('Russian Manicure · BIAB · Gel-X · Hard Gel')).toBeVisible();
    expect(within(about).getByText('6')).toBeVisible();
    expect(within(about).getByText('Russian manicure certification · BIAB certification'))
      .toBeVisible();
    expect(within(about).getByText('English · Spanish')).toBeVisible();
    expect(within(about).getByText('Appointment only')).toBeVisible();
    expect(within(about).getByText('Accepting new clients')).toBeVisible();
    expect(within(about).getByText('24-hour notice · $50 deposit · 15-minute late limit'))
      .toBeVisible();
    expect(within(about).getByRole('link', { name: /@islanail\.studio/u })).toBeVisible();
    expect(within(about).getByRole('link', { name: 'Book now' })).toBeVisible();
    expect(within(about).getByText('Solo nail tech')).toBeVisible();
    expect(within(about).getByText('Private home studio')).toBeVisible();
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

    expect(preview.querySelectorAll('.onboarding-policy-summary')).toHaveLength(0);
    expect(within(preview).queryByText(/24-hour notice|\$50 deposit|15-minute late limit/u))
      .not.toBeInTheDocument();

    const depositsVisible = structuredClone(state);
    depositsVisible.profile.policies.copy.deposits.visible = true;
    view.rerender(
      <OnboardingSitePreview document={initializeStarter('one_page')} label="Hidden policy summary preview" state={depositsVisible} />,
    );
    const summaries = [...preview.querySelectorAll('.onboarding-policy-summary')];
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every((summary) => summary.textContent === '$50 deposit')).toBe(true);
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
    expect(within(about).getByRole('img', {
      name: 'Business owner portrait placeholder',
    })).toBeVisible();
  });

  it('keeps six specialties and a long custom specialty in separate semantic fact cells', () => {
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
    const label = within(about).getByText('Specialties');
    const value = within(about).getByText(state.profile.about.specialties.join(' · '));

    expect(label.tagName).toBe('DT');
    expect(value.tagName).toBe('DD');
    expect(label.parentElement).toBe(value.parentElement);
    expect(value).toHaveTextContent('Arte de uñas editorial extremadamente detallado');
  });

  it.each([
    {
      heading: 'A direct path to booking',
      labels: ['Salon intro', 'Services', 'Booking'],
      pageHeadings: [],
      starter: 'quick_book',
    },
    {
      heading: 'Everything in one easy scroll',
      labels: ['Welcome', 'About', 'Services', 'Gallery', 'Reviews', 'Booking'],
      pageHeadings: [],
      starter: 'one_page',
    },
    {
      heading: 'Explore each part of the studio',
      labels: ['Welcome', 'Featured work', 'Services', 'Booking', 'Gallery', 'About', 'Visit us', 'Contact'],
      pageHeadings: ['Home', 'Services & Booking', 'Gallery', 'About', 'Contact'],
      starter: 'multi_page',
    },
  ] as const)('renders the real $starter document outline distinctly', ({ heading, labels, pageHeadings, starter }) => {
    const state = createDanielaFixtureState();
    state.recipe.starter = starter;
    const document = initializeStarter(starter);

    render(
      <OnboardingSitePreview document={document} label={`${starter} structure preview`} state={state} />,
    );
    const preview = screen.getByRole('region', { name: `${starter} structure preview` });
    const structure = preview.querySelector(`[data-starter-structure="${starter}"]`);

    expect(structure).not.toBeNull();
    expect(within(structure as HTMLElement).getByRole('heading', { level: 2, name: heading }))
      .toBeVisible();
    expect(within(structure as HTMLElement).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(labels);
    expect(within(structure as HTMLElement).queryAllByRole('heading', { level: 3 }).map((item) => item.textContent))
      .toEqual(pageHeadings);
  });

  it('connects every visible Multi-page navigation link to its real document page target', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'multi_page';
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
    const pagesById = new Map(document.pages.map((page) => [page.id, page]));
    const items = [...document.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => pagesById.get(item.pageId)?.visibleInNavigation)
      .slice(0, 4);

    for (const item of items) {
      const targetId = `preview-page-${item.pageId}`;
      expect(within(navigation).getByRole('link', { name: item.label }))
        .toHaveAttribute('href', `#${targetId}`);
      expect(preview.querySelector(`#${targetId}`)).toBeInTheDocument();
    }
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
    const customerSurface = stage.querySelector('.onboarding-site-preview') as HTMLDivElement;

    expect(ONBOARDING_PREVIEW_VIEWPORTS[device]).toEqual({ height, width });
    expect(stage).toHaveAttribute('data-preview-device', device);
    expect(stage).toHaveAttribute('data-preview-interaction', 'inline');
    expect(stage.style.getPropertyValue('--preview-target-width')).toBe(`${width}px`);
    expect(stage.style.getPropertyValue('--preview-target-height')).toBe(`${height}px`);
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
    expect(customerSurface.inert).toBe(false);
  });

  it('publishes both allowed phone actions, emphasizes the preferred one, and preserves a distinct text number', () => {
    const state = createDanielaFixtureState();
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
      <OnboardingSitePreview document={initializeStarter('quick_book')} interactionMode="interactive" label="Call and text preview" state={state} />,
    );
    const contact = within(screen.getByRole('region', { name: 'Call and text preview' }))
      .getByRole('region', { name: 'Visit and contact' });
    const text = within(contact).getByRole('link', { name: 'Text · Preferred' });
    const call = within(contact).getByRole('link', { name: 'Call' });

    expect(text).toHaveAttribute('href', 'sms:6475550199');
    expect(text).toHaveAttribute('data-contact-method', 'text');
    expect(text).toHaveClass('is-preferred');
    expect(call).toHaveAttribute('href', 'tel:4165550100');
    expect(call).toHaveAttribute('data-contact-method', 'call');
    expect(call).toHaveClass('is-secondary');
  });

  it('keeps a long business identity intact for assistive access while navigation remains separate', () => {
    const state = createDanielaFixtureState();
    const longName = 'Polished Beauty Lounge and Academy with an Exceptionally Long Studio Name';
    state.profile.businessName = longName;

    render(
      <OnboardingSitePreview device="desktop" document={initializeStarter('multi_page')} label="Long identity preview" state={state} />,
    );
    const preview = screen.getByRole('region', { name: 'Long identity preview' });
    const brand = preview.querySelector('.onboarding-customer-brand');
    const brandText = brand?.querySelector('strong');
    const navigation = within(preview).getByRole('navigation', { name: 'Customer preview navigation' });

    expect(brand).toHaveClass('onboarding-customer-brand');
    expect(brandText).toHaveTextContent(longName);
    expect(brand).toHaveAttribute('title', longName);
    expect(navigation).not.toContainElement(brandText ?? null);
    expect(within(navigation).getByRole('link', { name: 'Book' })).toBeVisible();
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
    expect(within(contact).queryByRole('link', { name: /Directions/u })).not.toBeInTheDocument();
    expect(within(contact).getByRole('link', { name: 'Book now' })).toBeVisible();

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
    expect(within(contact).getByRole('link', { name: /Directions to Scarborough/u }))
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
      <OnboardingSitePreview document={null} interactionMode="interactive" label="Privacy preview" state={publicExact} />,
    );
    expect(within(contact).getByText('123 Example Avenue')).toBeVisible();
    expect(within(contact).getByRole('link', { name: 'Directions to 123 Example Avenue' }))
      .toHaveAttribute('href', expect.stringContaining('123%20Example%20Avenue'));

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
    expect(within(contact).queryByRole('link', { name: /Directions/u })).not.toBeInTheDocument();
  });
});
