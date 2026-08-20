import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesModal } from './ServicesModal';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('framer-motion', () => {
  const makeMotionTag = (tag: string) =>
    React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children),
    );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_, tag: string) => makeMotionTag(tag),
    }),
  };
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A legacy salon: one flat service, every Luster L1 column NULL, no
 * add-ons, no add-on groups, no capabilities, no rules. Mirrors the exact
 * baseline `ServicesModal.test.tsx` already exercises for the existing
 * tabs — this file adds coverage for the NEW "Catalog" tab only.
 */
function mockLegacySalonRoutes() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/salon/add-on-groups')) {
      return jsonResponse({ data: { groups: [] } });
    }
    if (url.startsWith('/api/salon/add-ons')) {
      return jsonResponse({ data: { addOns: [] } });
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
    if (url.startsWith('/api/admin/salon/settings')) {
      return jsonResponse({ merchandising: { serviceLibraryIntroDismissed: true } });
    }
    if (url.startsWith('/api/salon/services/from-templates')) {
      return jsonResponse({ data: { ownedTemplateKeys: [] } });
    }
    if (url.startsWith('/api/salon/services') && (!init?.method || init.method === 'GET')) {
      return jsonResponse({
        data: {
          services: [{
            id: 'svc_legacy',
            name: 'Classic Manicure',
            description: null,
            price: 3500,
            durationMinutes: 30,
            preparationBufferMinutes: 0,
            cleanupBufferMinutes: 0,
            category: 'manicure',
            bookingCategory: 'manicure',
            imageUrl: null,
            isActive: true,
            parentServiceId: null,
            variantLabel: null,
            variantKind: null,
            confirmationMode: null,
          }],
          activeTechnicianCount: 1,
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
  });
}

describe('ServicesModal — Catalog tab (L1 owner configuration surface)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('adds a fourth "Catalog" tab alongside the existing three, without disturbing them', async () => {
    mockLegacySalonRoutes();
    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByTestId('services-tab-menu')).toBeInTheDocument();
    expect(screen.getByTestId('services-tab-addons')).toBeInTheDocument();
    expect(screen.getByTestId('services-tab-library')).toBeInTheDocument();
    expect(screen.getByTestId('services-tab-catalog')).toBeInTheDocument();
  });

  it('legacy simplicity: the Catalog tab is fully opt-in — no catalog-config fetch happens until it is opened, and the everyday tabs are unaffected', async () => {
    mockLegacySalonRoutes();
    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    await screen.findByTestId('services-tab-menu');
    const catalogFetchesBeforeOpen = fetchMock.mock.calls.filter(([url]) => String(url).includes('add-on-groups') || String(url).includes('capabilities') || String(url).includes('catalog-rules')).length;

    expect(catalogFetchesBeforeOpen).toBe(0);

    fireEvent.click(screen.getByTestId('services-tab-catalog'));

    expect(screen.getByTestId('catalog-config-tab')).toBeInTheDocument();
    // The overview lands first — still no L1 fetch until a section opens.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('add-on-groups')).length).toBe(0);
  });

  it('opening the Group services section shows the legacy service as "Not grouped" — nothing pre-selected or auto-created', async () => {
    mockLegacySalonRoutes();
    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    await screen.findByTestId('services-tab-menu');
    fireEvent.click(screen.getByTestId('services-tab-catalog'));
    fireEvent.click(screen.getByTestId('catalog-section-groupServices'));

    expect(await screen.findByTestId('service-standalone-svc_legacy')).toBeInTheDocument();
    expect(screen.queryByText('Families')).not.toBeInTheDocument();
  });

  it('switching back to My Menu from the Catalog tab still renders the original service list untouched', async () => {
    mockLegacySalonRoutes();
    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    await screen.findByText('Classic Manicure');
    fireEvent.click(screen.getByTestId('services-tab-catalog'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('services-tab-menu'));
    });

    expect(screen.getByText('Classic Manicure')).toBeInTheDocument();
  });
});
