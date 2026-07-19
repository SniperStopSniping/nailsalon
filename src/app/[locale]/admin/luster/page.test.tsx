import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('LusterOwnerPage', () => {
  const approvedExternalUrls = [
    'https://lusterstudio.ca/promotions',
    'https://lusterstudio.ca/shop',
    'https://lusterstudio.ca/wholesale',
    'https://lusterstudio.ca/join',
    'https://lusterstudio.ca/learn',
    'https://lusterstudio.ca/learn/builder-gel-foundations',
    'https://lusterstudio.ca/learn/nail-preparation-and-retention',
    'https://lusterstudio.ca/learn/choosing-flex-vs-control-builder',
    'https://lusterstudio.ca/learn/builder-gel-application',
    'https://lusterstudio.ca/learn/apex-and-structure',
    'https://lusterstudio.ca/learn/rebalancing-and-fill-maintenance',
    'https://lusterstudio.ca/learn/safe-product-removal',
    'https://lusterstudio.ca/learn/troubleshooting-lifting',
    'https://lusterstudio.ca/learn/troubleshooting-heat-spikes',
    'https://lusterstudio.ca/learn/product-storage-and-handling',
  ] as const;

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

  it('shows Promos before Shop before Learn with no operational integrations', async () => {
    render(<LusterOwnerPage />);

    expect(await screen.findByText('Builder Gel Foundations')).toBeInTheDocument();
    expect(screen.getByText('Nail Preparation and Retention')).toBeInTheDocument();
    expect(screen.getByText('Product Selection')).toBeInTheDocument();
    expect(screen.getByText('Shop professional products')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shop' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Promos' })).toBeInTheDocument();

    const promos = screen.getByTestId('luster-promos');
    const shop = screen.getByTestId('luster-shop');
    const learn = screen.getByTestId('luster-learn');

    expect(promos.compareDocumentPosition(shop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shop.compareDocumentPosition(learn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText('New Luster offers will appear here.')).toBeInTheDocument();

    // Operational integration setup lives in More → Integrations, not here.
    expect(screen.queryByText(/connect google calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorize twilio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/appointment calendar/i)).not.toBeInTheDocument();

    // No fabricated programs.
    expect(screen.queryByText(/points/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/certification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
  });

  it('renders only the approved canonical Luster Studio URLs', async () => {
    render(<LusterOwnerPage />);

    await screen.findByText('Builder Gel Foundations');

    const externalLinks = screen.getAllByRole('link').filter((link) => {
      const href = link.getAttribute('href') || '';
      return href.startsWith('https://');
    });
    const renderedUrls = [...new Set(externalLinks.map(link => link.getAttribute('href')))].sort();

    expect(renderedUrls).toEqual([...approvedExternalUrls].sort());
    expect(externalLinks).toHaveLength(16);

    for (const link of externalLinks) {
      expect(approvedExternalUrls).toContain(link.getAttribute('href'));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    expect(screen.queryByRole('link', { name: /coming soon/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/luster\.com/i)).not.toBeInTheDocument();
  });

  it('records owner marketing consent separately via the owner-consent endpoint', async () => {
    render(<LusterOwnerPage />);

    const consent = await screen.findByRole('checkbox');

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
