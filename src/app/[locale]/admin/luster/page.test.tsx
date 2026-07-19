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

  it('shows real education and shop content with no operational integrations', async () => {
    render(<LusterOwnerPage />);

    expect(await screen.findByText('Builder Gel Foundations')).toBeInTheDocument();
    expect(screen.getByText('Technique Guides')).toBeInTheDocument();
    expect(screen.getByText('Shop Builder Gel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shop & wholesale' })).toBeInTheDocument();

    // Operational integration setup lives in More → Integrations, not here.
    expect(screen.queryByText(/connect google calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authorize twilio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/appointment calendar/i)).not.toBeInTheDocument();

    // No fabricated programs.
    expect(screen.queryByText(/points/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/certification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
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
