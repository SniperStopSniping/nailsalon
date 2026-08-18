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

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.value = new URLSearchParams('salon=salon-a');
    config = baseConfig();
    content = baseContent();

    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/admin/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({
          user: { salons: [{ slug: 'salon-a', bookingUrl: 'https://salon-a.example.com/en/salon-a/book/service' }] },
        }), { status: 200 }));
      }

      if (url.includes('/api/admin/booking-page')) {
        if (method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ config, content }), { status: 200 }));
        }
        if (method === 'PATCH') {
          const body = JSON.parse(String(init?.body));
          if (body.config) {
            config = { ...config, draft: { ...config.draft, ...body.config } };
          }
          if (body.content) {
            content = { ...content, draft: { ...content.draft, ...body.content } };
          }
          return Promise.resolve(new Response(JSON.stringify({ config, content }), { status: 200 }));
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
          return Promise.resolve(new Response(JSON.stringify({ config, content }), { status: 200 }));
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

  it('warns that location name/phone still show under city_only, and clears the warning back to full_address', async () => {
    render(<BookingPageOwnerSurface />);

    await screen.findByTestId('content-hero-image-url');

    // full_address is the fixture default — no warning yet (also proves the
    // assertion below isn't vacuously true for every render).
    expect(screen.queryByTestId('location-display-mode-city-only-warning')).not.toBeInTheDocument();

    const cityOnlyButton = screen.getByTestId('location-display-mode-city_only');
    fireEvent.click(cityOnlyButton);

    await waitFor(() => {
      expect(screen.getByTestId('location-display-mode-city-only-warning')).toHaveTextContent(
        /location's name and phone number are still shown/,
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
});
