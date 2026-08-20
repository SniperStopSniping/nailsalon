import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogConfigTab } from './CatalogConfigTab';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function mockRoutes() {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/salon/services')) {
      return jsonResponse({ data: { services: [{ id: 'svc_1', name: 'Gel Manicure', price: 5500, durationMinutes: 45, isActive: true, category: 'manicure' }], activeTechnicianCount: 1 } });
    }
    if (url.startsWith('/api/salon/add-ons')) {
      return jsonResponse({ data: { addOns: [] } });
    }
    if (url.startsWith('/api/salon/add-on-groups')) {
      return jsonResponse({ data: { groups: [] } });
    }
    if (url.startsWith('/api/salon/capabilities')) {
      return jsonResponse({ data: { capabilities: [] } });
    }
    if (url.startsWith('/api/salon/technician-capabilities')) {
      return jsonResponse({ data: { assignments: [] } });
    }
    if (url.startsWith('/api/admin/technicians')) {
      return jsonResponse({ data: { technicians: [{ id: 'tech_1', name: 'Amy Chen', isActive: true }] } });
    }
    if (url.startsWith('/api/salon/catalog-rules')) {
      return jsonResponse({ data: { rules: [] } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CatalogConfigTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('progressive disclosure: fetches NOTHING until a real section is opened — the overview alone triggers zero requests', () => {
    const fetchMock = mockRoutes();
    render(<CatalogConfigTab salonSlug="isla-nail-studio" />);

    expect(screen.getByTestId('catalog-config-tab')).toBeInTheDocument();
    expect(screen.getByText(/Nothing here is required/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opening a section loads catalog settings and renders that panel', async () => {
    mockRoutes();
    render(<CatalogConfigTab salonSlug="isla-nail-studio" />);

    fireEvent.click(screen.getByTestId('catalog-section-addOns'));

    expect(await screen.findByTestId('catalog-addons-panel')).toBeInTheDocument();
  });

  it('the overview cards navigate into their section too', async () => {
    mockRoutes();
    render(<CatalogConfigTab salonSlug="isla-nail-studio" />);

    fireEvent.click(screen.getByTestId('catalog-overview-confirmation'));

    expect(await screen.findByTestId('catalog-confirmation-panel')).toBeInTheDocument();
  });

  it('legacy simplicity: a flat service with every L1 field NULL shows no pre-filled or forced state anywhere in the tab', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/salon/services')) {
        return jsonResponse({
          data: {
            services: [{
              id: 'svc_legacy',
              name: 'Classic Manicure',
              price: 3500,
              durationMinutes: 30,
              isActive: true,
              category: 'manicure',
              parentServiceId: null,
              variantLabel: null,
              variantKind: null,
              confirmationMode: null,
            }],
            activeTechnicianCount: 1,
          },
        });
      }
      if (url.startsWith('/api/salon/add-ons')) {
        return jsonResponse({ data: { addOns: [] } });
      }
      if (url.startsWith('/api/salon/add-on-groups')) {
        return jsonResponse({ data: { groups: [] } });
      }
      if (url.startsWith('/api/salon/capabilities')) {
        return jsonResponse({ data: { capabilities: [] } });
      }
      if (url.startsWith('/api/salon/technician-capabilities')) {
        return jsonResponse({ data: { assignments: [] } });
      }
      if (url.startsWith('/api/admin/technicians')) {
        return jsonResponse({ data: { technicians: [] } });
      }
      if (url.startsWith('/api/salon/catalog-rules')) {
        return jsonResponse({ data: { rules: [] } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<CatalogConfigTab salonSlug="isla-nail-studio" />);

    fireEvent.click(screen.getByTestId('catalog-section-groupServices'));

    expect(await screen.findByTestId('service-standalone-svc_legacy')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('catalog-section-confirmation'));
    const row = await screen.findByTestId('confirmation-row-svc_legacy');

    expect(row).toHaveTextContent('Default (today\'s behavior)');
    expect(screen.getByTestId('confirmation-save-svc_legacy')).toBeDisabled();

    fireEvent.click(screen.getByTestId('catalog-section-addOns'));
    await waitFor(() => expect(screen.getByTestId('catalog-addons-panel')).toBeInTheDocument());

    expect(screen.getByText(/No add-on groups yet/)).toBeInTheDocument();
    expect(screen.getByText('No add-ons yet.')).toBeInTheDocument();
  });

  it('shows a message and a select-a-salon prompt when there is no active salon', () => {
    render(<CatalogConfigTab salonSlug={null} />);

    expect(screen.getByText(/Select a salon/)).toBeInTheDocument();
  });

  it('every section tab is keyboard-reachable with a proper tab role', () => {
    mockRoutes();
    render(<CatalogConfigTab salonSlug="isla-nail-studio" />);
    const tabs = screen.getAllByRole('tab');

    expect(tabs.length).toBeGreaterThanOrEqual(7);

    for (const tab of tabs) {
      expect(tab).toHaveAttribute('aria-selected');
    }
  });
});
