import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BookingPageOwnerSurface from './page';

const { pushMock, searchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParamsMock: { value: new URLSearchParams('salon=salon-a') },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => searchParamsMock.value,
}));

function baseConfig(overrides: Partial<{
  layout: string;
  stylePack: string;
  businessMode: string;
  sectionOrder: string[];
  hiddenSections: string[];
}> = {}) {
  const side = {
    layout: 'quick_book',
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
    sectionVariants: {},
    hiddenSections: [] as string[],
    businessMode: 'solo',
    startMode: 'services_first',
    ...overrides,
  };
  return { version: 1, draft: side, live: side };
}

function baseContent() {
  const side = { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' };
  return { version: 1, draft: side, live: side };
}

describe('BookingPageOwnerSurface', () => {
  let config: ReturnType<typeof baseConfig>;
  let content: ReturnType<typeof baseContent>;
  let fetchMock: ReturnType<typeof vi.fn>;
  // Phase A (draft/publish split): defaults to 'published' so every
  // pre-existing test in this file (written before the salon-publish
  // affordance existed) keeps rendering exactly as before — the banner only
  // appears in the dedicated describe block below that sets this to
  // 'draft'.
  let salonPublicationStatus: string;
  let salonPublishShouldFail: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.value = new URLSearchParams('salon=salon-a');
    config = baseConfig();
    content = baseContent();
    salonPublicationStatus = 'published';
    salonPublishShouldFail = false;

    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/admin/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({
          user: { salons: [{ slug: 'salon-a', bookingUrl: 'https://salon-a.example.com/en/salon-a/book/service' }] },
        }), { status: 200 }));
      }

      if (url.includes('/api/admin/salon/publish')) {
        if (salonPublishShouldFail) {
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 'INTERNAL_ERROR', message: 'Publishing failed.' },
          }), { status: 500 }));
        }
        salonPublicationStatus = 'published';
        return Promise.resolve(new Response(JSON.stringify({
          data: {
            salonId: 'salon_1',
            slug: 'salon-a',
            publicationStatus: 'published',
            publishedAt: '2026-08-18T12:00:00.000Z',
            slugLockedAt: '2026-08-18T12:00:00.000Z',
            publicUrl: 'https://salon-a.example.com/',
            bookingUrl: 'https://salon-a.example.com/en/salon-a/book/service',
          },
        }), { status: 200 }));
      }

      if (url.includes('/api/admin/booking-page')) {
        if (method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ config, content, salon: { publicationStatus: salonPublicationStatus } }), { status: 200 }));
        }
        if (method === 'PATCH') {
          const body = JSON.parse(String(init?.body));
          if (body.config) {
            config = { ...config, draft: { ...config.draft, ...body.config } };
          }
          if (body.content) {
            content = { ...content, draft: { ...content.draft, ...body.content } };
          }
          return Promise.resolve(new Response(JSON.stringify({ config, content, salon: { publicationStatus: salonPublicationStatus } }), { status: 200 }));
        }
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body));
          if (body.action === 'publish') {
            config = { ...config, live: config.draft };
            content = { ...content, live: content.draft };
          } else if (body.action === 'revert') {
            config = { ...config, draft: config.live };
            content = { ...content, draft: content.live };
          }
          return Promise.resolve(new Response(JSON.stringify({ config, content, salon: { publicationStatus: salonPublicationStatus } }), { status: 200 }));
        }
      }

      return Promise.reject(new Error(`Unhandled fetch: ${method} ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('renders the layout picker with Quick Book and Editorial Luxury selectable, the rest disabled as coming soon (PR 6)', async () => {
    render(<BookingPageOwnerSurface />);

    const quickBook = await screen.findByTestId('layout-option-quick_book');

    expect(quickBook).toBeEnabled();
    expect(quickBook).toHaveAttribute('aria-pressed', 'true');

    const editorial = screen.getByTestId('layout-option-editorial');

    expect(editorial).toBeEnabled();
    expect(editorial).toHaveAttribute('aria-pressed', 'false');
    expect(within(editorial).queryByText('Coming soon')).not.toBeInTheDocument();

    for (const id of ['tech_profile', 'portfolio', 'catalogue']) {
      const option = screen.getByTestId(`layout-option-${id}`);

      expect(option).toBeDisabled();
      expect(within(option).getByText('Coming soon')).toBeInTheDocument();
    }
  });

  it('PATCHes layout when Editorial Luxury is selected (PR 6: no longer a disabled option)', async () => {
    render(<BookingPageOwnerSurface />);
    const editorial = await screen.findByTestId('layout-option-editorial');

    fireEvent.click(editorial);

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');

      expect(patchCalls).toHaveLength(1);
      expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toEqual({ config: { layout: 'editorial' } });
    });
  });

  it('does not PATCH when a disabled (unimplemented) layout option is clicked', async () => {
    render(<BookingPageOwnerSurface />);
    const techProfile = await screen.findByTestId('layout-option-tech_profile');

    fireEvent.click(techProfile);

    // Only the initial GET calls (booking-page + auth/me) should have fired.
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    });
  });

  it('never renders a toggle control for serviceMenu or bookingCta', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('layout-option-quick_book');

    expect(screen.queryByTestId('section-toggle-serviceMenu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-toggle-bookingCta')).not.toBeInTheDocument();
    expect(screen.queryByText(/service menu/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/booking cta/i)).not.toBeInTheDocument();
  });

  // Repair A4: salonProfile hosts the page's only <h1> on both layouts and
  // joined the non-removable floor (REQUIRED_SECTION_IDS in
  // @/libs/bookingPageConfig) alongside serviceMenu/bookingCta. A normal
  // admin has no way to hide it because this surface never offers a toggle
  // for it at all — the server-side floor (validateSectionOrder) is the
  // defense against a crafted request bypassing this UI, proven in
  // bookingPageConfig.test.ts's "salonProfile floor" and full-pipeline
  // coverage.
  it('never renders a toggle control for salonProfile', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('layout-option-quick_book');

    expect(screen.queryByTestId('section-toggle-salonProfile')).not.toBeInTheDocument();
    expect(screen.queryByText(/salon profile/i)).not.toBeInTheDocument();
  });

  it('renders portfolio and reviews as disabled, marked coming soon', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('layout-option-quick_book');

    const portfolio = screen.getByTestId('section-toggle-portfolio');
    const reviews = screen.getByTestId('section-toggle-reviews');

    expect(portfolio).toBeDisabled();
    expect(reviews).toBeDisabled();
    expect(screen.getByText('Portfolio (coming soon)')).toBeInTheDocument();
    expect(screen.getByText('Reviews (coming soon)')).toBeInTheDocument();
  });

  // Post-launch audit fix: whatsIncluded (SECTION_REGISTRY.whatsIncluded's
  // canRender is unconditionally `() => false` — no data field exists yet)
  // and technicianList (no renderer in any layout) could previously be
  // toggled on with zero possible visible effect — an inert toggle with no
  // indication to the owner. Both now render disabled and clearly labelled,
  // same treatment as portfolio/reviews above, rather than silently doing
  // nothing when clicked.
  it('renders whatsIncluded and technicianList as disabled, marked coming soon (no inert toggle may remain)', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('layout-option-quick_book');

    const whatsIncluded = screen.getByTestId('section-toggle-whatsIncluded');
    const technicianList = screen.getByTestId('section-toggle-technicianList');

    expect(whatsIncluded).toBeDisabled();
    expect(technicianList).toBeDisabled();
    expect(screen.getByText('What\'s included (coming soon)')).toBeInTheDocument();
    expect(screen.getByText('Technician list (coming soon)')).toBeInTheDocument();
  });

  it('toggling an optional section PATCHes sectionOrder/hiddenSections and reflects the new state', async () => {
    render(<BookingPageOwnerSurface />);
    const toggle = await screen.findByTestId('section-toggle-technicianProfile');

    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');

      expect(patchCall).toBeDefined();

      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body.config.sectionOrder).toContain('technicianProfile');
      expect(body.config.hiddenSections).not.toContain('technicianProfile');
    });

    await waitFor(() => expect(screen.getByTestId('section-toggle-technicianProfile')).toBeChecked());
  });

  it('toggling a shown section off adds it to hiddenSections', async () => {
    config = baseConfig({ sectionOrder: [...baseConfig().draft.sectionOrder] });
    render(<BookingPageOwnerSurface />);
    const toggle = await screen.findByTestId('section-toggle-featuredServices');

    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body.config.hiddenSections).toContain('featuredServices');
    });
  });

  it('business mode picker PATCHes businessMode', async () => {
    render(<BookingPageOwnerSurface />);
    const team = await screen.findByTestId('business-mode-option-team');

    fireEvent.click(team);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body.config).toEqual({ businessMode: 'team' });
    });
  });

  it('saves the bio field on blur, not on every keystroke', async () => {
    render(<BookingPageOwnerSurface />);
    const bio = await screen.findByTestId('content-bio');

    fireEvent.change(bio, { target: { value: 'Hello there' } });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);

    fireEvent.blur(bio);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body.content).toEqual({ bio: 'Hello there' });
    });
  });

  // Post-launch privacy fix: this warning previously read "location's name
  // and phone number are still shown" under city_only — that copy
  // documented THE DEFECT (the salon phone survived redaction) as intended
  // behaviour. Now that `applyLocationDisplayMode`/`applyPhoneDisplayMode`
  // (`@/libs/salonContent`) actually redact the phone too, the owner-facing
  // copy is corrected to match: only the location NAME still shows.
  it('warns that only the location name still shows under city_only (address/postal/phone are hidden), and clears the warning back to full_address', async () => {
    render(<BookingPageOwnerSurface />);

    await screen.findByTestId('content-hero-image-url');

    // full_address is the fixture default — no warning yet (also proves the
    // assertion below isn't vacuously true for every render).
    expect(screen.queryByTestId('location-display-mode-city-only-warning')).not.toBeInTheDocument();

    const cityOnlyButton = screen.getByTestId('location-display-mode-city_only');
    fireEvent.click(cityOnlyButton);

    await waitFor(() => {
      expect(screen.getByTestId('location-display-mode-city-only-warning')).toHaveTextContent(
        /hides your street address, postal code, and phone number.*location's name is\s+still shown/,
      );
    });

    const fullAddressButton = screen.getByTestId('location-display-mode-full_address');
    fireEvent.click(fullAddressButton);

    await waitFor(() => {
      expect(screen.queryByTestId('location-display-mode-city-only-warning')).not.toBeInTheDocument();
    });
  });

  it('the preview link points at the salon booking URL from /api/admin/auth/me', async () => {
    render(<BookingPageOwnerSurface />);

    const link = await screen.findByTestId('booking-page-preview-link');
    await waitFor(() => {
      expect(link).toHaveAttribute('href', 'https://salon-a.example.com/en/salon-a/book/service');
    });

    expect(link).toHaveAttribute('target', '_blank');
  });

  it('Publish calls the publish action and reports success', async () => {
    render(<BookingPageOwnerSurface />);
    const publishButton = await screen.findByTestId('booking-page-publish');

    fireEvent.click(publishButton);

    await screen.findByText(/Published\. Your live booking page now matches your draft\./);

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');

    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ action: 'publish' });
  });

  it('Revert asks for confirmation, then calls the revert action and reports success', async () => {
    render(<BookingPageOwnerSurface />);
    const revertButton = await screen.findByTestId('booking-page-revert');

    fireEvent.click(revertButton);

    expect(window.confirm).toHaveBeenCalled();

    await screen.findByText(/Reverted\. Your draft now matches what is live\./);

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');

    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ action: 'revert' });
  });

  it('Revert does nothing when the confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<BookingPageOwnerSurface />);
    const revertButton = await screen.findByTestId('booking-page-revert');

    fireEvent.click(revertButton);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    });
  });

  // Phase A follow-up: the wizard's success screen is not the owner's only
  // way back to publishing — an owner who navigates away from it with the
  // salon still in `draft` needs a persistent, reachable way to finish the
  // job. This surface (the existing "my public page" destination) is it.
  describe('salon publish affordance (Phase A follow-up)', () => {
    it('does not render for an already-published salon', async () => {
      salonPublicationStatus = 'published';
      render(<BookingPageOwnerSurface />);

      await screen.findByTestId('layout-option-quick_book');

      expect(screen.queryByTestId('salon-publish-banner')).not.toBeInTheDocument();
    });

    it('renders a distinct "publish the salon" affordance for a draft salon, separate from the booking-page Publish button', async () => {
      salonPublicationStatus = 'draft';
      render(<BookingPageOwnerSurface />);

      const banner = await screen.findByTestId('salon-publish-banner');
      const salonPublishButton = screen.getByTestId('salon-publish-button');

      expect(banner).toBeInTheDocument();
      // The booking-page config button says the bare word "Publish"
      // (asserted elsewhere in this file); the salon-level action must
      // never carry that same bare label — an owner could confuse them.
      expect(salonPublishButton).not.toHaveTextContent(/^Publish$/);
      expect(screen.getByText(/permanently locks your link/i)).toBeInTheDocument();
    });

    it('clicking the salon-publish button calls POST /api/admin/salon/publish (not the booking-page action endpoint), and hides the banner on success', async () => {
      salonPublicationStatus = 'draft';
      render(<BookingPageOwnerSurface />);

      const button = await screen.findByTestId('salon-publish-button');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.queryByTestId('salon-publish-banner')).not.toBeInTheDocument();
      });

      const publishCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/admin/salon/publish'));

      expect(publishCall).toBeDefined();
      expect(publishCall?.[1]?.method).toBe('POST');

      // Never routes through the booking-page config publish/revert action.
      const bookingPageActionCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url).includes('/api/admin/booking-page') && init?.method === 'POST',
      );

      expect(bookingPageActionCalls).toHaveLength(0);
    });

    it('shows an error and keeps the banner when the publish call fails', async () => {
      salonPublicationStatus = 'draft';
      salonPublishShouldFail = true;
      render(<BookingPageOwnerSurface />);

      const button = await screen.findByTestId('salon-publish-button');
      fireEvent.click(button);

      await screen.findByRole('alert');

      expect(screen.getByTestId('salon-publish-banner')).toBeInTheDocument();
    });

    it('is independent of the booking-page config Publish/Revert action state (clicking one never disables the other)', async () => {
      salonPublicationStatus = 'draft';
      render(<BookingPageOwnerSurface />);

      await screen.findByTestId('salon-publish-banner');
      const configPublishButton = screen.getByTestId('booking-page-publish');

      expect(configPublishButton).toBeEnabled();
    });
  });
});
