import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesModal } from './ServicesModal';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

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

type MockRoutes = {
  services?: unknown[];
  merchandising?: {
    featureLusterManicure?: boolean;
    lusterPromoDismissed?: boolean;
    serviceLibraryIntroDismissed?: boolean;
  };
  createdService?: Record<string, unknown>;
  ownedTemplateKeys?: string[];
};

function mockRoutes({ services = [], merchandising = {}, createdService, ownedTemplateKeys = [] }: MockRoutes) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/admin/salon/settings')) {
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ merchandising: { lusterPromoDismissed: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        merchandising: { serviceLibraryIntroDismissed: true, ...merchandising },
      }), { status: 200 });
    }
    if (url.startsWith('/api/salon/services/from-templates')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          data: { createdServiceCount: 1, createdAddOnCount: 0, skippedTemplateKeys: [] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { ownedTemplateKeys } }), { status: 200 });
    }
    if (url.startsWith('/api/salon/services')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { service: createdService ?? {} } }), { status: 201 });
      }
      return new Response(JSON.stringify({ data: { services } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function findCall(predicate: (url: string, init?: RequestInit) => boolean) {
  return fetchMock.mock.calls.find(([input, init]) =>
    predicate(String(input), init as RequestInit | undefined),
  );
}

describe('ServicesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows add actions for an empty salon and creates combo services against the active admin salon slug', async () => {
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: true },
      createdService: {
        id: 'svc_new',
        name: 'BIAB + Classic Pedicure',
        description: 'Builder gel overlay paired with a classic pedicure',
        price: 8500,
        durationMinutes: 110,
        category: 'combo',
        bookingCategory: 'combo',
        imageUrl: null,
        isActive: true,
      },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByRole('button', { name: 'Add Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BIAB + Classic Pedicure' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '110' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'combo' } });
    fireEvent.change(screen.getByLabelText('Description items'), { target: { value: 'Builder gel overlay paired with a classic pedicure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => {
      expect(findCall((url, init) => url === '/api/salon/services' && init?.method === 'POST')).toBeTruthy();
    });

    const [, requestInit] = findCall((url, init) => url === '/api/salon/services' && init?.method === 'POST')!;

    expect(requestInit).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(JSON.parse(String((requestInit as RequestInit).body))).toEqual({
      salonSlug: 'isla-nail-studio',
      name: 'BIAB + Classic Pedicure',
      description: 'Builder gel overlay paired with a classic pedicure',
      descriptionItems: ['Builder gel overlay paired with a classic pedicure'],
      price: 8500,
      priceDisplayText: null,
      durationMinutes: 110,
      preparationBufferMinutes: 0,
      cleanupBufferMinutes: 0,
      category: 'combo',
      // The booking-page section follows the category until touched directly.
      bookingCategory: 'combo',
      featuredOrder: null,
      templateKey: null,
      isActive: true,
      isIntroPrice: false,
      introPriceLabel: null,
    });

    expect((await screen.findAllByText('BIAB + Classic Pedicure')).length).toBeGreaterThan(0);
  });

  it('keeps combo available as a filter category and shows combo services when selected', async () => {
    mockRoutes({
      services: [
        {
          id: 'svc_combo',
          name: 'Gel X / Hard Gel Extensions + Classic Pedicure',
          description: null,
          price: 10500,
          durationMinutes: 155,
          category: 'combo',
          imageUrl: null,
          isActive: true,
        },
        {
          id: 'svc_mani',
          name: 'Gel Manicure',
          description: null,
          price: 4000,
          durationMinutes: 60,
          category: 'manicure',
          imageUrl: null,
          isActive: true,
        },
      ],
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByText('Gel X / Hard Gel Extensions + Classic Pedicure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /combo 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /combo 1/i }));

    expect(screen.getByText('Gel X / Hard Gel Extensions + Classic Pedicure')).toBeInTheDocument();
    expect(screen.queryByText('Gel Manicure')).not.toBeInTheDocument();
  });

  it('shows the Luster setup card when the salon has no Luster service and creates it with the template key', async () => {
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: false },
      createdService: {
        id: 'svc_luster',
        name: 'Luster Manicure',
        price: 4500,
        durationMinutes: 60,
        category: 'manicure',
        bookingCategory: 'manicure',
        templateKey: 'luster_manicure',
        imageUrl: null,
        isActive: true,
      },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByTestId('luster-promo-card')).toBeInTheDocument();
    expect(screen.getByText('Offer the Luster Manicure')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('luster-promo-cta'));

    expect(screen.getByLabelText('Name')).toHaveValue('Luster Manicure');
    expect(screen.getByLabelText('Price')).toHaveValue(55);
    expect(screen.getByLabelText('Duration')).toHaveValue(60);

    fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => {
      expect(findCall((url, init) => url === '/api/salon/services' && init?.method === 'POST')).toBeTruthy();
    });

    const [, requestInit] = findCall((url, init) => url === '/api/salon/services' && init?.method === 'POST')!;
    const body = JSON.parse(String((requestInit as RequestInit).body));

    expect(body.templateKey).toBe('luster_manicure');
    expect(body.name).toBe('Luster Manicure');
    expect(body.bookingCategory).toBe('manicure');
    // The bookable price and the badge come from the template catalog; the
    // numeric price is authoritative and no display-text override is sent.
    expect(body.price).toBe(5500);
    expect(body.priceDisplayText).toBeNull();
    expect(body.isIntroPrice).toBe(true);
    expect(body.introPriceLabel).toBe('Intro price');
  });

  it('hides the Luster setup card when an active Luster service exists', async () => {
    mockRoutes({
      services: [
        {
          id: 'svc_luster',
          name: 'Luster Manicure',
          description: null,
          price: 4500,
          durationMinutes: 60,
          category: 'manicure',
          bookingCategory: 'manicure',
          templateKey: 'luster_manicure',
          imageUrl: null,
          isActive: true,
        },
      ],
      merchandising: { lusterPromoDismissed: false },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByText('Luster Manicure')).toBeInTheDocument();
    expect(screen.queryByTestId('luster-promo-card')).not.toBeInTheDocument();
  });

  it('shows the numeric price with the intro badge on the detail view, and only a set display text overrides the shown price', async () => {
    mockRoutes({
      services: [
        {
          // Corrected production shape: numeric price is what renders.
          id: 'svc_luster',
          name: 'Luster Manicure',
          description: null,
          price: 5500,
          priceDisplayText: null,
          isIntroPrice: true,
          introPriceLabel: 'Intro price',
          durationMinutes: 60,
          preparationBufferMinutes: 0,
          cleanupBufferMinutes: 0,
          category: 'manicure',
          bookingCategory: 'manicure',
          templateKey: 'luster_manicure',
          imageUrl: null,
          isActive: true,
        },
        {
          // A display-text service: the override replaces the shown price.
          id: 'svc_display',
          name: 'Gel Pedicure',
          description: null,
          price: 5500,
          priceDisplayText: '$55+',
          isIntroPrice: false,
          introPriceLabel: null,
          durationMinutes: 60,
          preparationBufferMinutes: 0,
          cleanupBufferMinutes: 0,
          category: 'pedicure',
          bookingCategory: 'pedicure',
          templateKey: null,
          imageUrl: null,
          isActive: true,
        },
      ],
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    // List rows: numeric price when no display text; override when set.
    expect(await screen.findByText('Luster Manicure')).toBeInTheDocument();
    expect(screen.getByText('$55.00')).toBeInTheDocument();
    expect(screen.getByText('$55+')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Luster Manicure'));

    // Detail view: PRICE card shows the bookable $55 and the badge is the
    // intro label — never a second price.
    expect(await screen.findByText('Price')).toBeInTheDocument();
    expect(screen.getAllByText('$55.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Intro price')).toBeInTheDocument();
    expect(screen.queryByText('$75+')).not.toBeInTheDocument();
  });

  it('hides the Luster setup card once dismissed and persists the dismissal', async () => {
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: false },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    fireEvent.click(await screen.findByTestId('luster-promo-dismiss'));

    expect(screen.queryByTestId('luster-promo-card')).not.toBeInTheDocument();

    await waitFor(() => {
      const patchCall = findCall((url, init) =>
        url.startsWith('/api/admin/salon/settings') && init?.method === 'PATCH');

      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String((patchCall![1] as RequestInit).body))).toEqual({
        merchandising: { lusterPromoDismissed: true },
      });
    });
  });

  it('assigns the next free featured position when the owner features a service', async () => {
    mockRoutes({
      services: [
        {
          id: 'svc_featured',
          name: 'Signature Combo',
          description: null,
          price: 9000,
          durationMinutes: 120,
          category: 'combo',
          bookingCategory: 'combo',
          featuredOrder: 2,
          imageUrl: null,
          isActive: true,
        },
      ],
      merchandising: { lusterPromoDismissed: true },
      createdService: { id: 'svc_new', name: 'New', price: 1000, durationMinutes: 30, category: 'manicure', bookingCategory: 'manicure', imageUrl: null, isActive: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    await screen.findByText('Signature Combo');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Spa Pedicure' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '55' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('service-featured-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => {
      expect(findCall((url, init) => url === '/api/salon/services' && init?.method === 'POST')).toBeTruthy();
    });

    const [, requestInit] = findCall((url, init) => url === '/api/salon/services' && init?.method === 'POST')!;

    expect(JSON.parse(String((requestInit as RequestInit).body)).featuredOrder).toBe(3);
  });

  it('shows the Service Library with Added states and opens a prefilled sheet from a template', async () => {
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: true },
      ownedTemplateKeys: ['gel_manicure'],
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    fireEvent.click(await screen.findByTestId('services-tab-library'));

    expect(screen.getByTestId('service-library-tab')).toBeInTheDocument();
    // Popular is the default shelf, Luster first.
    expect(await screen.findByTestId('library-template-luster_manicure')).toBeInTheDocument();

    // Templates the salon already owns show Added instead of Add.
    await waitFor(() => {
      expect(screen.getByTestId('library-added-gel_manicure')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('library-add-gel_manicure')).not.toBeInTheDocument();

    // Adding a service template opens the compact review sheet prefilled.
    fireEvent.click(screen.getByTestId('library-add-classic_pedicure'));

    expect(screen.getByLabelText('Name')).toHaveValue('Classic Pedicure');
    expect(screen.getByLabelText('Price')).toHaveValue(50);
    expect(screen.getByLabelText('Duration')).toHaveValue(60);
    expect(screen.getByTestId('service-booking-category')).toHaveValue('pedicure');
  });

  it('searches the library by alias so BIAB finds builder gel templates', async () => {
    mockRoutes({ services: [], merchandising: { lusterPromoDismissed: true } });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    fireEvent.click(await screen.findByTestId('services-tab-library'));
    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'BIAB' } });

    expect(screen.getByTestId('library-template-builder_gel_overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('library-template-classic_pedicure')).not.toBeInTheDocument();
  });

  it('bulk-adds the recommended starter menu with acrylic never offered and already-added items locked', async () => {
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: true },
      ownedTemplateKeys: ['gel_manicure'],
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    fireEvent.click(await screen.findByTestId('services-tab-library'));
    fireEvent.click(await screen.findByTestId('bulk-add-open'));

    // Count excludes what the salon already owns (30 starters − 1 owned).
    expect(await screen.findByTestId('bulk-add-confirm')).toHaveTextContent('Add 29 to menu');
    expect(screen.getByTestId('bulk-add-check-gel_manicure')).toBeDisabled();
    expect(screen.queryByTestId('bulk-add-check-acrylic_full_set_short')).not.toBeInTheDocument();

    // Unchecking trims the batch; confirm posts the remaining keys.
    fireEvent.click(screen.getByTestId('bulk-add-check-hard_gel_extensions'));
    fireEvent.click(screen.getByTestId('bulk-add-confirm'));

    await waitFor(() => {
      const call = findCall((url, init) =>
        url === '/api/salon/services/from-templates' && init?.method === 'POST');

      expect(call).toBeTruthy();

      const body = JSON.parse(String((call![1] as RequestInit).body));

      expect(body.templateKeys).toHaveLength(28);
      expect(body.templateKeys).not.toContain('hard_gel_extensions');
      expect(body.templateKeys).not.toContain('gel_manicure');
    });
  });

  it('shows the one-time library intro card until dismissed', async () => {
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: true, serviceLibraryIntroDismissed: false },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByTestId('library-intro-card')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('library-intro-dismiss'));

    expect(screen.queryByTestId('library-intro-card')).not.toBeInTheDocument();

    await waitFor(() => {
      const patchCall = findCall((url, init) =>
        url.startsWith('/api/admin/salon/settings') && init?.method === 'PATCH');

      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String((patchCall![1] as RequestInit).body))).toEqual({
        merchandising: { serviceLibraryIntroDismissed: true },
      });
    });
  });
});
