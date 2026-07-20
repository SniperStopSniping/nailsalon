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
  addOns?: unknown[];
  activeTechnicianCount?: number;
  templateAddResult?: Record<string, unknown>;
  /** Non-2xx forces the service PATCH to fail with this status/message. */
  patchFailure?: { status: number; message: string };
};

function mockRoutes({ services = [], merchandising = {}, createdService, ownedTemplateKeys = [], addOns = [], activeTechnicianCount = 0, templateAddResult, patchFailure }: MockRoutes) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/salon/add-ons')) {
      if (init?.method === 'PATCH') {
        const submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
        const { salonSlug: _slug, ...fields } = submitted;
        return new Response(
          JSON.stringify({ data: { addOn: { id: decodeURIComponent(url.split('/').pop()!), pricingType: 'fixed', category: 'nail_art', ...fields } } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ data: { addOns } }), { status: 200 });
    }
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
          data: { createdServiceCount: 1, createdAddOnCount: 0, skippedTemplateKeys: [], ...templateAddResult },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { ownedTemplateKeys } }), { status: 200 });
    }
    if (url.startsWith('/api/salon/services/') && init?.method === 'PATCH') {
      if (patchFailure) {
        return new Response(
          JSON.stringify({ error: { code: 'UPDATE_FAILED', message: patchFailure.message } }),
          { status: patchFailure.status },
        );
      }
      // Echo the submitted fields back as the saved service, like the API does.
      const submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
      const { salonSlug: _salonSlug, ...serviceFields } = submitted;
      return new Response(
        JSON.stringify({ data: { service: { id: decodeURIComponent(url.split('/').pop()!), ...serviceFields } } }),
        { status: 200 },
      );
    }
    if (url.startsWith('/api/salon/services')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { service: createdService ?? {} } }), { status: 201 });
      }
      return new Response(JSON.stringify({ data: { services, activeTechnicianCount } }), { status: 200 });
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
    expect(screen.getByRole('button', { name: /combos 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /combos 1/i }));

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

    expect(screen.getByLabelText('Name')).toHaveValue('Classic Pedicure — Regular Polish');
    expect(screen.getByLabelText('Price')).toHaveValue(40);
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

    // Count excludes what the salon already owns (30 starters − 1 owned) and
    // is split truthfully: base services and add-ons are different records.
    expect(await screen.findByTestId('bulk-add-confirm')).toHaveTextContent('Add 19 services · 33 add-ons');
    expect(screen.getByTestId('bulk-add-summary')).toHaveTextContent('Add 19 services and 33 add-ons.');
    expect(screen.getByTestId('bulk-add-summary')).toHaveTextContent('1 already on your menu is skipped.');
    expect(screen.getByTestId('bulk-add-check-gel_manicure')).toBeDisabled();
    expect(screen.queryByTestId('bulk-add-check-acrylic_full_set_short')).not.toBeInTheDocument();

    // Unchecking trims the batch; confirm posts the remaining keys.
    fireEvent.click(screen.getByTestId('bulk-add-check-gel_x_extensions'));
    fireEvent.click(screen.getByTestId('bulk-add-confirm'));

    await waitFor(() => {
      const call = findCall((url, init) =>
        url === '/api/salon/services/from-templates' && init?.method === 'POST');

      expect(call).toBeTruthy();

      const body = JSON.parse(String((call![1] as RequestInit).body));

      expect(body.templateKeys).toHaveLength(51);
      expect(body.templateKeys).not.toContain('gel_x_extensions');
      expect(body.templateKeys).not.toContain('gel_manicure');
    });
  });

  it('shows a truthful assignment warning and opens Team services after a multi-technician add', async () => {
    const onOpenStaff = vi.fn();
    mockRoutes({
      services: [],
      merchandising: { lusterPromoDismissed: true },
      templateAddResult: { assignmentRequired: true, activeTechnicianCount: 2 },
    });

    render(<ServicesModal onClose={() => {}} onOpenStaff={onOpenStaff} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByTestId('services-tab-library'));
    fireEvent.click(await screen.findByTestId('bulk-add-open'));
    fireEvent.click(await screen.findByTestId('bulk-add-confirm'));

    expect(await screen.findByTestId('service-operation-notice')).toHaveTextContent(
      'choose who can perform them',
    );

    fireEvent.click(screen.getByTestId('service-operation-open-staff'));

    expect(onOpenStaff).toHaveBeenCalledOnce();
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

describe('ServicesModal — service detail owner actions', () => {
  const lusterService = {
    id: 'svc_luster',
    name: 'Luster Manicure',
    description: null,
    descriptionItems: null,
    price: 4500,
    priceDisplayText: '$75+',
    isIntroPrice: true,
    introPriceLabel: '$55',
    durationMinutes: 60,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'manicure',
    bookingCategory: 'manicure',
    templateKey: 'luster_manicure',
    featuredOrder: 1,
    imageUrl: null,
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  async function openLusterDetail() {
    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByText('Luster Manicure'));

    expect(await screen.findByTestId('service-detail-edit')).toBeInTheDocument();
  }

  it('offers a prominent Edit action that opens the prefilled editor and PATCHes the $55 repair', async () => {
    mockRoutes({ services: [lusterService], merchandising: { lusterPromoDismissed: true } });

    await openLusterDetail();

    fireEvent.click(screen.getByTestId('service-detail-edit'));

    // Editor prefilled from the record: dollars in the Price field.
    expect(screen.getByLabelText('Name')).toHaveValue('Luster Manicure');
    expect(screen.getByLabelText('Price')).toHaveValue(45);
    expect(screen.getByLabelText('Price display text')).toHaveValue('$75+');
    expect(screen.getByLabelText('Intro label')).toHaveValue('$55');

    // The exact production repair: price 55, clear display text, relabel badge.
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '55' } });
    fireEvent.change(screen.getByLabelText('Price display text'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Intro label'), { target: { value: 'Intro price' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Service' }));

    await waitFor(() => {
      const patchCall = findCall((url, init) =>
        url === '/api/salon/services/svc_luster' && init?.method === 'PATCH');

      expect(patchCall).toBeTruthy();

      const body = JSON.parse(String((patchCall![1] as RequestInit).body));

      expect(body.price).toBe(5500);
      expect(body.priceDisplayText).toBeNull();
      expect(body.isIntroPrice).toBe(true);
      expect(body.introPriceLabel).toBe('Intro price');
      expect(body.isActive).toBe(true);
    });
  });

  it('deactivates and reactivates from the detail view with an otherwise-unchanged payload', async () => {
    mockRoutes({ services: [lusterService], merchandising: { lusterPromoDismissed: true } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await openLusterDetail();

    expect(screen.getByTestId('service-detail-toggle-active')).toHaveTextContent('Deactivate Service');

    fireEvent.click(screen.getByTestId('service-detail-toggle-active'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      const patchCall = findCall((url, init) =>
        url === '/api/salon/services/svc_luster' && init?.method === 'PATCH');

      expect(patchCall).toBeTruthy();

      const body = JSON.parse(String((patchCall![1] as RequestInit).body));

      expect(body.isActive).toBe(false);
      // Every other field rides along unchanged — nothing is repriced.
      expect(body.price).toBe(4500);
      expect(body.priceDisplayText).toBe('$75+');
      expect(body.introPriceLabel).toBe('$55');
    });

    // Detail reflects the saved state and offers reactivation without confirm.
    expect(await screen.findByText('Reactivate Service')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();

    confirmSpy.mockClear();
    fireEvent.click(screen.getByTestId('service-detail-toggle-active'));

    expect(confirmSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input, init]) =>
        String(input) === '/api/salon/services/svc_luster' && (init as RequestInit | undefined)?.method === 'PATCH');

      expect(calls).toHaveLength(2);
      expect(JSON.parse(String((calls[1]![1] as RequestInit).body)).isActive).toBe(true);
    });

    confirmSpy.mockRestore();
  });

  it('keeps the detail open and shows the API error when deactivation fails', async () => {
    mockRoutes({
      services: [lusterService],
      merchandising: { lusterPromoDismissed: true },
      patchFailure: { status: 409, message: 'The service could not be saved. Check the name and try again.' },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await openLusterDetail();

    fireEvent.click(screen.getByTestId('service-detail-toggle-active'));

    expect(await screen.findByTestId('service-detail-toggle-error')).toHaveTextContent(
      'The service could not be saved. Check the name and try again.',
    );
    // Still active, still actionable.
    expect(screen.getByTestId('service-detail-toggle-active')).toHaveTextContent('Deactivate Service');
    expect(screen.getByTestId('service-detail-edit')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('does not deactivate when the owner cancels the confirm step', async () => {
    mockRoutes({ services: [lusterService], merchandising: { lusterPromoDismissed: true } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await openLusterDetail();

    fireEvent.click(screen.getByTestId('service-detail-toggle-active'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(findCall((url, init) =>
      url === '/api/salon/services/svc_luster' && init?.method === 'PATCH')).toBeUndefined();

    confirmSpy.mockRestore();
  });

  it('renders the owner actions at a mobile viewport width', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    mockRoutes({ services: [lusterService], merchandising: { lusterPromoDismissed: true } });

    await openLusterDetail();

    expect(screen.getByTestId('service-detail-edit')).toBeVisible();
    expect(screen.getByTestId('service-detail-toggle-active')).toBeVisible();
    expect(screen.getByTestId('service-detail-edit')).toHaveClass('w-full');
    expect(screen.getByTestId('service-detail-toggle-active')).toHaveClass('w-full');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it('exposes only All, Manicure, Pedicure, and Combos as owner filters', async () => {
    mockRoutes({
      services: [
        { ...lusterService, id: 'svc_builder', name: 'Builder Gel Overlay', category: 'builder_gel', bookingCategory: 'manicure' },
        { ...lusterService, id: 'svc_gelx', name: 'Gel-X Extensions', category: 'extensions', bookingCategory: 'manicure' },
        { ...lusterService, id: 'svc_pedi', name: 'Gel Pedicure', category: 'pedicure', bookingCategory: 'pedicure' },
        { ...lusterService, id: 'svc_combo', name: 'Mani + Pedi', category: 'combo', bookingCategory: 'combo' },
      ],
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByRole('button', { name: /^All 4$/i })).toBeInTheDocument();
    // Builder Gel and Gel-X roll up into Manicure — internal names never chip.
    expect(screen.getByRole('button', { name: /^Manicure 2$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pedicure 1$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Combos 1$/i })).toBeInTheDocument();

    for (const banned of ['Builder Gel', 'Extensions', 'Hands', 'Feet', 'Gel & Natural']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${banned}`, 'i') })).not.toBeInTheDocument();
    }

    // Filtering uses the same canonical grouping.
    fireEvent.click(screen.getByRole('button', { name: /^Pedicure 1$/i }));

    expect(screen.getByText('Gel Pedicure')).toBeInTheDocument();
    expect(screen.queryByText('Builder Gel Overlay')).not.toBeInTheDocument();
  });

  it('counts services and add-ons separately and manages add-ons in their own tab', async () => {
    mockRoutes({
      services: [lusterService],
      addOns: [
        { id: 'addon_chrome', name: 'Chrome', priceCents: 1000, priceDisplayText: null, durationMinutes: 15, category: 'nail_art', pricingType: 'fixed', unitLabel: null, maxQuantity: null, isActive: true },
        { id: 'addon_repair', name: 'Nail Repair', priceCents: 500, priceDisplayText: '$5 per nail', durationMinutes: 10, category: 'repair', pricingType: 'per_unit', unitLabel: 'nail', maxQuantity: 10, isActive: true },
      ],
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    // Add-ons never inflate the service count.
    expect(await screen.findByText('1 services · 2 add-ons')).toBeInTheDocument();
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('services-tab-addons'));

    expect(await screen.findByTestId('addon-row-addon_chrome')).toHaveTextContent('Chrome');
    expect(screen.getByTestId('addon-row-addon_repair')).toHaveTextContent('$5 per nail');

    fireEvent.click(screen.getByTestId('addon-row-addon_repair'));
    fireEvent.change(await screen.findByLabelText('Price'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Add-on' }));

    await waitFor(() => {
      const call = findCall((url, init) => url === '/api/salon/add-ons/addon_repair' && init?.method === 'PATCH');

      expect(call).toBeTruthy();

      const body = JSON.parse(String((call![1] as RequestInit).body));

      expect(body.priceCents).toBe(600);
      expect(body.maxQuantity).toBe(10);
      expect(body.isActive).toBe(true);
    });
  });

  it('tells an unassigned-service owner to assign a technician when the salon has staff', async () => {
    mockRoutes({
      services: [{ ...lusterService, assignedTechnicianCount: 0 }],
      activeTechnicianCount: 2,
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByTestId('service-row-not-bookable-svc_luster')).toHaveTextContent('Not bookable');

    fireEvent.click(screen.getByText('Luster Manicure'));

    expect(await screen.findByTestId('service-detail-visibility-warning'))
      .toHaveTextContent('Not visible in booking — assign at least one technician');
  });

  it('tells a staffless salon to add a technician rather than implying bookability', async () => {
    mockRoutes({
      services: [{ ...lusterService, assignedTechnicianCount: 0 }],
      activeTechnicianCount: 0,
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    fireEvent.click(await screen.findByText('Luster Manicure'));

    expect(await screen.findByTestId('service-detail-visibility-warning'))
      .toHaveTextContent('add a technician before this service can be booked');
  });

  it('shows no visibility warning for an assigned service', async () => {
    mockRoutes({
      services: [{ ...lusterService, assignedTechnicianCount: 1 }],
      activeTechnicianCount: 1,
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    expect(await screen.findByText('Luster Manicure')).toBeInTheDocument();
    expect(screen.queryByTestId('service-row-not-bookable-svc_luster')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Luster Manicure'));

    expect(await screen.findByTestId('service-detail-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('service-detail-visibility-warning')).not.toBeInTheDocument();
  });

  it('keeps deactivated services in the owner list with an Inactive chip and a reactivation path', async () => {
    mockRoutes({
      services: [{ ...lusterService, isActive: false }],
      merchandising: { lusterPromoDismissed: true },
    });

    await openLusterDetail();

    expect(screen.getByTestId('service-row-inactive-svc_luster')).toHaveTextContent('Inactive');
    expect(screen.getByTestId('service-detail-toggle-active')).toHaveTextContent('Reactivate Service');
  });
});
