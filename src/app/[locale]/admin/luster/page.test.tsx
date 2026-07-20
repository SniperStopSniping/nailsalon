import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isApprovedLusterUrl } from '@/libs/lusterLinks';

import LusterOwnerPage from './page';

const { fetchMock, replaceMock, pushMock, searchParamsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  searchParamsMock: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => searchParamsMock.value,
}));

/** Document-order index of a node, so "renders before" is a real assertion. */
const orderOf = (container: HTMLElement, node: Element) =>
  [...container.querySelectorAll('*')].indexOf(node);

describe('LusterOwnerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.value = new URLSearchParams('salon=salon-a');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/admin/luster/marketing-consent')) {
        if (init?.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({ data: { consented: true } }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: { consented: false } }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
  });

  it('renders the approved hierarchy: Promotions, then Shop, then Learn', async () => {
    render(<LusterOwnerPage />);

    await screen.findByRole('heading', { level: 2, name: 'Promotions' });

    const sections = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);

    expect(sections).toStrictEqual(['Promotions', 'Shop', 'Learn']);
  });

  it('leads with the neutral Luster intro instead of the Learn-first hero', async () => {
    render(<LusterOwnerPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Luster for Nail Artists' })).toBeInTheDocument();
    expect(
      screen.getByText('Discover professional products, artist offers and practical education from Luster Studio.'),
    ).toBeInTheDocument();

    expect(screen.queryByText('Builder Gel education and resources')).not.toBeInTheDocument();
    expect(screen.queryByText(/Builder Gel education and technique guides/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your booking app stays free/i)).not.toBeInTheDocument();
  });

  it('shows the honest promotions empty state with product and promotion actions', async () => {
    render(<LusterOwnerPage />);

    expect(await screen.findByText('New Luster offers will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View promotions/ })).toHaveAttribute(
      'href',
      expect.stringContaining('https://lusterstudio.ca/promotions'),
    );
    expect(screen.getAllByRole('link', { name: /Shop products/ }).length).toBeGreaterThan(0);
  });

  it('offers the three shop actions as separate labelled links', async () => {
    render(<LusterOwnerPage />);

    await screen.findByRole('heading', { level: 2, name: 'Shop' });

    for (const [name, path] of [
      [/Shop professional products/, '/shop'],
      [/Wholesale information/, '/wholesale'],
      [/Join Luster/, '/join'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'href',
        expect.stringContaining(`https://lusterstudio.ca${path}`),
      );
    }

    // Distinct actions must not be collapsed under one "Shop & Wholesale" label.
    expect(screen.queryByRole('heading', { name: /Shop & wholesale/i })).not.toBeInTheDocument();
  });

  it('lists the learn overview plus every approved guide with descriptive CTAs', async () => {
    render(<LusterOwnerPage />);

    await screen.findByRole('heading', { level: 2, name: 'Learn' });

    expect(screen.getByRole('link', { name: /Learn overview/ })).toHaveAttribute(
      'href',
      expect.stringContaining('https://lusterstudio.ca/learn?'),
    );
    expect(screen.getByText('Browse learning')).toBeInTheDocument();

    const guides = [
      'Builder Gel Foundations',
      'Nail Preparation and Retention',
      'Choosing Flex vs Control Builder',
      'Builder Gel Application',
      'Apex and Structure',
      'Rebalancing and Fill Maintenance',
      'Safe Product Removal',
      'Troubleshooting Lifting',
      'Troubleshooting Heat Spikes',
      'Product Storage and Handling',
    ];

    for (const guide of guides) {
      expect(screen.getByText(guide)).toBeInTheDocument();
    }

    expect(screen.getAllByText('View guide')).toHaveLength(guides.length);

    // Generic labels were the old pattern and must not come back.
    expect(screen.queryByText('Open resource')).not.toBeInTheDocument();
  });

  it('links out only to approved lusterstudio.ca urls with safe link attributes', async () => {
    const { container } = render(<LusterOwnerPage />);

    await screen.findByRole('heading', { level: 2, name: 'Promotions' });

    const links = [...container.querySelectorAll('a[href]')];

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const href = link.getAttribute('href') || '';

      expect(href).not.toMatch(/luster\.com/);
      expect(isApprovedLusterUrl(href)).toBe(true);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
      expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
      // Every link states where it goes for screen-reader users.
      expect(within(link as HTMLElement).getByText('Opens lusterstudio.ca in a new tab')).toBeInTheDocument();
    }
  });

  it('keeps integration setup and integration wayfinding out of the Luster page', async () => {
    render(<LusterOwnerPage />);

    await screen.findByRole('heading', { level: 2, name: 'Promotions' });

    expect(screen.queryByText(/google calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/texting setup/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Integrations moved to More/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/integrations/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connect google calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorize twilio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/appointment calendar/i)).not.toBeInTheDocument();

    // No fabricated programs.
    expect(screen.queryByText(/points/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/certification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
  });

  it('records owner marketing consent separately, after the content sections', async () => {
    const { container } = render(<LusterOwnerPage />);

    const consent = await screen.findByRole('checkbox');
    const learnHeading = screen.getByRole('heading', { level: 2, name: 'Learn' });

    expect(orderOf(container, consent)).toBeGreaterThan(orderOf(container, learnHeading));
    expect(consent).not.toBeChecked();

    fireEvent.click(consent);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/luster/marketing-consent',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ salonSlug: 'salon-a', consented: true }),
        }),
      );
    });
  });

  it('safely redirects legacy integration callback links to the Integrations app', async () => {
    searchParamsMock.value = new URLSearchParams('salon=salon-a&google=connected');

    render(<LusterOwnerPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        '/en/admin?salon=salon-a&app=integrations&google=connected',
      );
    });
  });
});
