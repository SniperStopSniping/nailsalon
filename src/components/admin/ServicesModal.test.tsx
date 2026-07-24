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
  patchedService?: Record<string, unknown>;
  servicesAfterRefresh?: unknown[];
  ownedTemplateKeys?: string[];
  addOns?: unknown[];
  activeTechnicianCount?: number;
  templateAddResult?: Record<string, unknown>;
  /** Non-2xx forces the service PATCH to fail with this status/message. */
  patchFailure?: { status: number; message: string };
  /** Non-2xx forces the add-on LIST fetch to fail — e.g. the production 401. */
  addOnsFailure?: { status: number };
  /** Add-ons returned by the second and later list fetches (refresh checks). */
  addOnsAfterRefresh?: unknown[];
  imageStrategy?: 'cloudinary' | 'local';
  imageResultService?: Record<string, unknown>;
  imageFailureAt?: 'presign' | 'upload' | 'finalize' | 'delete';
  imageDeleteFailure?: { status: number; message: string };
};

function mockRoutes({ services = [], merchandising = {}, createdService, patchedService, servicesAfterRefresh, ownedTemplateKeys = [], addOns = [], activeTechnicianCount = 0, templateAddResult, patchFailure, addOnsFailure, addOnsAfterRefresh, imageStrategy = 'local', imageResultService, imageFailureAt, imageDeleteFailure }: MockRoutes) {
  let addOnListCalls = 0;
  let serviceListCalls = 0;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/image/presign') && init?.method === 'POST') {
      if (imageFailureAt === 'presign') {
        return new Response(JSON.stringify({ error: { message: 'Unable to prepare image' } }), { status: 500 });
      }
      if (imageStrategy === 'cloudinary') {
        return new Response(JSON.stringify({
          data: {
            strategy: 'cloudinary',
            uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
            apiKey: 'public-key',
            timestamp: 123456,
            signature: 'signed-value',
            uploadPreset: 'luster_service_images_v1',
            publicId: 'salons/salon_1/services/service_svc_new_abcdefghijklmnop_webp',
            overwrite: false,
            type: 'upload',
            tags: 'luster_service_image_pending_v1',
            context: 'signed-pending-context',
            finalizeToken: 'a'.repeat(64),
            cloudName: 'demo',
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { strategy: 'local' } }), { status: 200 });
    }
    if (url === 'https://api.cloudinary.com/v1_1/demo/image/upload' && init?.method === 'POST') {
      if (imageFailureAt === 'upload') {
        return new Response(JSON.stringify({ error: { message: 'Cloud upload failed' } }), { status: 500 });
      }
      return new Response(JSON.stringify({
        asset_id: 'asset_AbCdEfGhIjKlMnOp',
        delete_token: 'upload-delete-token',
      }), { status: 200 });
    }
    if (url === 'https://api.cloudinary.com/v1_1/demo/delete_by_token' && init?.method === 'POST') {
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
    }
    if (/\/api\/salon\/services\/[^/]+\/image(?:\?|$)/.test(url)) {
      if (init?.method === 'DELETE' && imageDeleteFailure) {
        return new Response(
          JSON.stringify({ error: { message: imageDeleteFailure.message } }),
          { status: imageDeleteFailure.status },
        );
      }
      if (init?.method === 'DELETE' && imageFailureAt === 'delete') {
        return new Response(JSON.stringify({ error: { message: 'Image removal failed' } }), { status: 500 });
      }
      if (init?.method === 'POST' && imageFailureAt === 'finalize') {
        return new Response(JSON.stringify({ error: { message: 'Image finalization failed' } }), { status: 500 });
      }
      const serviceId = decodeURIComponent(url.match(/\/services\/([^/]+)\/image/)?.[1] ?? 'svc_new');
      const sourceService = (services as Record<string, unknown>[]).find(item => item.id === serviceId)
        ?? createdService
        ?? {};
      return new Response(JSON.stringify({
        data: {
          service: imageResultService ?? {
            ...sourceService,
            id: serviceId,
            imageUrl: init?.method === 'DELETE'
              ? null
              : 'https://res.cloudinary.com/demo/image/upload/v2/service-image.webp',
          },
        },
      }), { status: 200 });
    }
    if (url.startsWith('/api/salon/add-ons')) {
      if (!init?.method || init.method === 'GET') {
        addOnListCalls += 1;
        if (addOnsFailure) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: addOnsFailure.status });
        }
        const payload = addOnsAfterRefresh && addOnListCalls > 1 ? addOnsAfterRefresh : addOns;
        return new Response(JSON.stringify({ data: { addOns: payload } }), { status: 200 });
      }
      if (init?.method === 'PATCH') {
        const submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
        const { salonSlug: _slug, ...fields } = submitted;
        return new Response(
          JSON.stringify({ data: { addOn: { id: decodeURIComponent(url.split('/').pop()!), pricingType: 'fixed', category: 'nail_art', ...fields } } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected add-on request: ${init?.method} ${url}`);
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
        JSON.stringify({
          data: {
            service: patchedService ?? {
              id: decodeURIComponent(url.split('/').pop()!),
              ...serviceFields,
            },
          },
        }),
        { status: 200 },
      );
    }
    if (url.startsWith('/api/salon/services')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { service: createdService ?? {} } }), { status: 201 });
      }
      serviceListCalls += 1;
      const servicePayload
        = servicesAfterRefresh && serviceListCalls > 1
          ? servicesAfterRefresh
          : services;

      return new Response(
        JSON.stringify({ data: { services: servicePayload, activeTechnicianCount } }),
        { status: 200 },
      );
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

  describe('add-ons tab', () => {
    const chrome = {
      id: 'addon_chrome',
      name: 'Chrome',
      descriptionItems: ['Mirror finish'],
      priceCents: 1000,
      priceDisplayText: '$10+',
      durationMinutes: 15,
      category: 'nail_art',
      pricingType: 'fixed',
      unitLabel: null,
      maxQuantity: null,
      isActive: true,
      compatibleServiceIds: ['svc_luster'],
    };
    const retired = {
      ...chrome,
      id: 'addon_retired',
      name: 'Retired Art',
      priceDisplayText: null,
      isActive: false,
      compatibleServiceIds: [],
    };

    it('lists every add-on the Library marks Added, counting inactive ones', async () => {
      mockRoutes({
        services: [lusterService],
        // Both add-on templates report as owned, so the Library shows "Added".
        ownedTemplateKeys: ['chrome', 'french_tips'],
        addOns: [chrome, retired],
        merchandising: { lusterPromoDismissed: true },
      });

      render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

      // The count is the contradiction the owner reported: never 0 while the
      // Library says Added.
      expect(await screen.findByText('1 services · 2 add-ons')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('services-tab-addons'));

      const row = await screen.findByTestId('addon-row-addon_chrome');

      // Library-parity meta: from-price, duration, kind and category badges.
      expect(row).toHaveTextContent('Chrome');
      expect(row).toHaveTextContent('$10+');
      expect(row).toHaveTextContent('15 min');
      expect(row).toHaveTextContent('Add-on');
      expect(row).toHaveTextContent('Nail art');
      expect(row).toHaveTextContent('Offered with 1 service');
      expect(row).toHaveTextContent('Edit');

      // Inactive add-ons stay listed and counted so they can be revived.
      expect(screen.getByTestId('addon-row-inactive-addon_retired')).toHaveTextContent('Inactive');
    });

    it('keeps add-ons out of the service menu and its category counts', async () => {
      mockRoutes({
        services: [lusterService],
        addOns: [chrome, retired],
        merchandising: { lusterPromoDismissed: true },
      });

      render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

      expect(await screen.findByRole('button', { name: /^All 1$/i })).toBeInTheDocument();
      expect(screen.queryByText('Chrome')).not.toBeInTheDocument();
      expect(screen.queryByTestId('addon-row-addon_chrome')).not.toBeInTheDocument();
    });

    it('surfaces a failed load instead of pretending the salon has no add-ons', async () => {
      // The production bug: /api/salon/add-ons 401s and the tab claimed the
      // salon had none, while the Library kept showing "Added".
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRoutes({
        services: [lusterService],
        addOnsFailure: { status: 401 },
        merchandising: { lusterPromoDismissed: true },
      });

      render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

      expect(await screen.findByText('1 services · add-ons unavailable')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('services-tab-addons'));

      expect(await screen.findByTestId('addons-load-error')).toHaveTextContent('Unable to load add-ons');
      expect(screen.queryByText('No add-ons yet. Add them from the Library tab.')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

      consoleError.mockRestore();
    });

    it('shows a newly added Library add-on without a refresh', async () => {
      mockRoutes({
        services: [lusterService],
        addOns: [],
        addOnsAfterRefresh: [chrome],
        merchandising: { lusterPromoDismissed: true },
      });

      render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

      fireEvent.click(await screen.findByTestId('services-tab-addons'));

      expect(await screen.findByText('No add-ons yet. Add them from the Library tab.')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('services-tab-library'));
      fireEvent.click(await screen.findByTestId('library-chip-addon'));
      fireEvent.click(await screen.findByTestId('library-add-chrome'));

      fireEvent.click(screen.getByTestId('services-tab-addons'));

      // No remount: the same mounted component now shows the new add-on.
      expect(await screen.findByTestId('addon-row-addon_chrome')).toHaveTextContent('Chrome');
      expect(screen.getByText('1 services · 1 add-ons')).toBeInTheDocument();
    });

    it('edits description and compatibility on the same record', async () => {
      mockRoutes({
        services: [lusterService, { ...lusterService, id: 'svc_pedi', name: 'Gel Pedicure', category: 'pedicure', bookingCategory: 'pedicure' }],
        addOns: [chrome],
        merchandising: { lusterPromoDismissed: true },
      });

      render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);

      fireEvent.click(await screen.findByTestId('services-tab-addons'));
      fireEvent.click(await screen.findByTestId('addon-row-addon_chrome'));

      fireEvent.change(await screen.findByTestId('addon-edit-description'), {
        target: { value: 'Mirror finish\nAny colour' },
      });

      // Pre-checked from compatibleServiceIds; add the pedicure, drop nothing.
      expect(screen.getByTestId('addon-edit-service-svc_luster')).toBeChecked();

      fireEvent.click(screen.getByTestId('addon-edit-service-svc_pedi'));
      fireEvent.click(screen.getByRole('button', { name: 'Update Add-on' }));

      await waitFor(() => {
        const call = findCall((url, init) => url === '/api/salon/add-ons/addon_chrome' && init?.method === 'PATCH');

        expect(call).toBeTruthy();

        const body = JSON.parse(String((call![1] as RequestInit).body));

        expect(body.descriptionItems).toEqual(['Mirror finish', 'Any colour']);
        expect(body.serviceIds).toEqual(['svc_luster', 'svc_pedi']);
      });

      // One PATCH to the existing id — never a POST that would create a copy.
      const addOnWrites = fetchMock.mock.calls.filter(([input, init]) =>
        String(input).startsWith('/api/salon/add-ons/')
        && (init as RequestInit | undefined)?.method !== undefined);

      expect(addOnWrites).toHaveLength(1);
      expect((addOnWrites[0]![1] as RequestInit).method).toBe('PATCH');
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

describe('ServicesModal — service image controls', () => {
  const serviceWithImage = {
    id: 'svc_image',
    name: 'Gel Manicure',
    description: null,
    descriptionItems: null,
    price: 4500,
    priceDisplayText: null,
    durationMinutes: 60,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    category: 'manicure',
    bookingCategory: 'manicure',
    templateKey: 'gel_manicure',
    featuredOrder: null,
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/original.webp',
    isActive: true,
    isIntroPrice: false,
    introPriceLabel: null,
  };

  const createdService = {
    ...serviceWithImage,
    id: 'svc_new',
    name: 'Custom Manicure',
    imageUrl: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:service-preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  async function openAddDialog() {
    fireEvent.click(await screen.findByRole('button', { name: 'Add Service' }));
  }

  function fillRequiredAddFields() {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Custom Manicure' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '60' } });
  }

  it('previews a staged Add Service image and removing it restores built-in artwork without an API operation', async () => {
    mockRoutes({ merchandising: { lusterPromoDismissed: true } });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    await openAddDialog();

    const preview = screen.getByTestId('service-image-preview');

    expect(preview).toHaveAttribute('alt', expect.stringContaining('Built-in booking artwork'));
    expect(screen.getByRole('button', { name: 'Add image' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeDisabled();

    const file = new File(['valid-image-bytes'], 'manicure.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Service image'), { target: { files: [file] } });

    expect(preview).toHaveAttribute('src', 'blob:service-preview');
    expect(preview).toHaveAttribute('alt', expect.stringContaining('custom image'));
    expect(screen.getByRole('button', { name: 'Replace image' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));

    expect(preview).not.toHaveAttribute('src', 'blob:service-preview');
    expect(screen.getByRole('button', { name: 'Add image' })).toBeEnabled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:service-preview');
    expect(findCall(url => url.includes('/image'))).toBeUndefined();
  });

  it('previews replacement and stages existing-image removal until Update Service', async () => {
    mockRoutes({
      services: [serviceWithImage],
      merchandising: { lusterPromoDismissed: true },
      imageResultService: { ...serviceWithImage, imageUrl: null },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    const preview = screen.getByTestId('service-image-preview');

    expect(preview).toHaveAttribute('src', serviceWithImage.imageUrl);

    const replacement = new File(['replacement'], 'replacement.webp', { type: 'image/webp' });

    fireEvent.change(screen.getByLabelText('Service image'), { target: { files: [replacement] } });

    expect(preview).toHaveAttribute('src', 'blob:service-preview');

    // Removing a staged replacement restores the persisted custom image.
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));

    expect(preview).toHaveAttribute('src', serviceWithImage.imageUrl);

    // A second remove now stages deletion of the persisted image.
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));

    expect(preview).not.toHaveAttribute('src', serviceWithImage.imageUrl);
    expect(screen.getByText(/custom image will be removed when you update/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo removal' })).toBeEnabled();
    expect(findCall((url, init) => url.includes('/image') && init?.method === 'DELETE')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Update Service' }));

    await waitFor(() => {
      expect(findCall((url, init) =>
        url.startsWith('/api/salon/services/svc_image/image?')
        && init?.method === 'DELETE')).toBeTruthy();
    });

    const detailSaveIndex = fetchMock.mock.calls.findIndex(([input, init]) =>
      String(input) === '/api/salon/services/svc_image'
      && (init as RequestInit | undefined)?.method === 'PATCH');
    const deleteIndex = fetchMock.mock.calls.findIndex(([input, init]) =>
      String(input).startsWith('/api/salon/services/svc_image/image?')
      && (init as RequestInit | undefined)?.method === 'DELETE');

    expect(detailSaveIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(detailSaveIndex);
  });

  it('keeps a staged removal bound to the image observed before a concurrent replacement', async () => {
    const concurrentlyReplacedService = {
      ...serviceWithImage,
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/v2/latest.webp',
    };

    mockRoutes({
      services: [serviceWithImage],
      servicesAfterRefresh: [concurrentlyReplacedService],
      patchedService: concurrentlyReplacedService,
      merchandising: { lusterPromoDismissed: true },
      imageDeleteFailure: {
        status: 409,
        message: 'The service image changed. Refresh and try again.',
      },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    // Tab A stages removal of U. The mocked details PATCH then reflects Tab
    // B's already-committed replacement V.
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Service' }));

    const notice = await screen.findByTestId('service-operation-notice');

    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent(
      'Service details were saved, but the image could not be updated. Open Edit Service to try the image again.',
    );

    const deleteCall = findCall((url, init) =>
      url.startsWith('/api/salon/services/svc_image/image?')
      && init?.method === 'DELETE')!;
    const deleteUrl = new URL(String(deleteCall[0]), 'http://localhost');

    expect(deleteUrl.searchParams.get('expectedImageUrl')).toBe(
      serviceWithImage.imageUrl,
    );
    expect(deleteUrl.searchParams.get('expectedImageUrl')).not.toBe(
      concurrentlyReplacedService.imageUrl,
    );

    await waitFor(() => {
      const serviceListCalls = fetchMock.mock.calls.filter(([input, init]) =>
        String(input).startsWith('/api/salon/services?')
        && !(init as RequestInit | undefined)?.method);

      expect(serviceListCalls.length).toBeGreaterThanOrEqual(2);
    });

    // The details response and subsequent list refresh both preserve V.
    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    expect(screen.getByTestId('service-image-preview')).toHaveAttribute(
      'src',
      concurrentlyReplacedService.imageUrl,
    );
  });

  it('saves an Edit Service replacement through the local development strategy after the details PATCH', async () => {
    const finalService = {
      ...serviceWithImage,
      imageUrl: '/uploads/services/salon_1/service_svc_image_abcdefghijklmnop.webp',
    };

    mockRoutes({
      services: [serviceWithImage],
      merchandising: { lusterPromoDismissed: true },
      imageStrategy: 'local',
      imageResultService: finalService,
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    const file = new File(['replacement'], 'replacement.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Service image'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Service' }));

    await waitFor(() => {
      expect(findCall((url, init) =>
        url === '/api/salon/services/svc_image/image'
        && init?.method === 'POST')).toBeTruthy();
    });

    const presignCall = findCall((url, init) =>
      url === '/api/salon/services/svc_image/image/presign'
      && init?.method === 'POST')!;

    expect(JSON.parse(String((presignCall[1] as RequestInit).body))).toEqual({
      salonSlug: 'isla-nail-studio',
      contentType: 'image/png',
      fileSize: file.size,
      expectedImageUrl: serviceWithImage.imageUrl,
    });

    const imageCall = findCall((url, init) =>
      url === '/api/salon/services/svc_image/image'
      && init?.method === 'POST')!;
    const imageBody = (imageCall[1] as RequestInit).body as FormData;

    expect(imageBody.get('file')).toBe(file);
    expect(imageBody.get('salonSlug')).toBe('isla-nail-studio');
    expect(imageBody.get('expectedImageUrl')).toBe(serviceWithImage.imageUrl);

    const detailSaveIndex = fetchMock.mock.calls.findIndex(([input, init]) =>
      String(input) === '/api/salon/services/svc_image'
      && (init as RequestInit | undefined)?.method === 'PATCH');
    const imageSaveIndex = fetchMock.mock.calls.findIndex(([input, init]) =>
      String(input) === '/api/salon/services/svc_image/image'
      && (init as RequestInit | undefined)?.method === 'POST');

    expect(imageSaveIndex).toBeGreaterThan(detailSaveIndex);

    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    expect(screen.getByTestId('service-image-preview')).toHaveAttribute('src', finalService.imageUrl);
  });

  it('validates image type and the 5 MiB limit before saving', async () => {
    mockRoutes({ merchandising: { lusterPromoDismissed: true } });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    await openAddDialog();

    fireEvent.change(screen.getByLabelText('Service image'), {
      target: { files: [new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a JPEG, PNG, or WebP image.');

    fireEvent.change(screen.getByLabelText('Service image'), {
      target: {
        files: [
          new File(
            [new Uint8Array(5 * 1024 * 1024 + 1)],
            'too-large.jpg',
            { type: 'image/jpeg' },
          ),
        ],
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Image must be 5 MB or smaller.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Service image'), {
      target: { files: [new File([], 'empty.webp', { type: 'image/webp' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a non-empty image.');
  });

  it('Cancel revokes a staged preview and performs no save, upload, or deletion', async () => {
    mockRoutes({ merchandising: { lusterPromoDismissed: true } });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    await openAddDialog();
    fireEvent.change(screen.getByLabelText('Service image'), {
      target: { files: [new File(['image'], 'image.jpeg', { type: 'image/jpeg' })] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Add Service' })).not.toBeInTheDocument();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:service-preview');
    });

    expect(findCall((_url, init) => ['POST', 'PATCH', 'DELETE'].includes(init?.method ?? ''))).toBeUndefined();
  });

  it('Cancel leaves an existing custom image unchanged after removal was staged', async () => {
    mockRoutes({
      services: [serviceWithImage],
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(await screen.findByTestId('service-detail-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));

    expect(screen.getByRole('button', { name: 'Undo removal' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(findCall((_url, init) => ['POST', 'PATCH', 'DELETE'].includes(init?.method ?? ''))).toBeUndefined();

    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    expect(screen.getByTestId('service-image-preview')).toHaveAttribute(
      'src',
      serviceWithImage.imageUrl,
    );
  });

  it('does not label built-in fallback artwork as a removable custom image', async () => {
    const serviceWithBuiltInArtwork = {
      ...serviceWithImage,
      imageUrl: '/assets/images/services/manicure-gel-nude.webp',
    };

    mockRoutes({
      services: [serviceWithBuiltInArtwork],
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    expect(screen.getByTestId('service-image-preview')).toHaveAttribute(
      'alt',
      expect.stringContaining('Built-in booking artwork'),
    );
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeDisabled();
  });

  it('uses the signed Cloudinary parameters and final returned URL after saving service details', async () => {
    const finalService = {
      ...createdService,
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/v2/service-image.webp',
    };

    mockRoutes({
      createdService,
      imageStrategy: 'cloudinary',
      imageResultService: finalService,
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    await openAddDialog();
    fillRequiredAddFields();
    const file = new File(['image'], 'image.webp', { type: 'image/webp' });

    fireEvent.change(screen.getByLabelText('Service image'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

    await waitFor(() => {
      expect(findCall((url, init) =>
        url === '/api/salon/services/svc_new/image'
        && init?.method === 'POST'
        && init.headers !== undefined)).toBeTruthy();
    });

    const presignCall = findCall((url, init) =>
      url === '/api/salon/services/svc_new/image/presign' && init?.method === 'POST')!;

    expect(JSON.parse(String((presignCall[1] as RequestInit).body))).toEqual({
      salonSlug: 'isla-nail-studio',
      contentType: 'image/webp',
      fileSize: file.size,
      expectedImageUrl: null,
    });

    const uploadCall = findCall(url =>
      url === 'https://api.cloudinary.com/v1_1/demo/image/upload')!;
    const uploadBody = (uploadCall[1] as RequestInit).body as FormData;

    expect(uploadBody.get('file')).toBe(file);
    expect(uploadBody.get('api_key')).toBe('public-key');
    expect(uploadBody.get('timestamp')).toBe('123456');
    expect(uploadBody.get('signature')).toBe('signed-value');
    expect(uploadBody.get('upload_preset')).toBe('luster_service_images_v1');
    expect(uploadBody.get('public_id')).toBe('salons/salon_1/services/service_svc_new_abcdefghijklmnop_webp');
    expect(uploadBody.get('overwrite')).toBe('false');
    expect(uploadBody.get('type')).toBe('upload');
    expect(uploadBody.get('tags')).toBe('luster_service_image_pending_v1');
    expect(uploadBody.get('context')).toBe('signed-pending-context');
    expect(Array.from(uploadBody.keys()).sort()).toEqual([
      'api_key',
      'context',
      'file',
      'overwrite',
      'public_id',
      'signature',
      'tags',
      'timestamp',
      'type',
      'upload_preset',
    ]);

    const finalizeCall = findCall((url, init) =>
      url === '/api/salon/services/svc_new/image'
      && init?.method === 'POST'
      && init.headers !== undefined)!;

    expect(JSON.parse(String((finalizeCall[1] as RequestInit).body))).toEqual({
      salonSlug: 'isla-nail-studio',
      assetId: 'asset_AbCdEfGhIjKlMnOp',
      publicId: 'salons/salon_1/services/service_svc_new_abcdefghijklmnop_webp',
      expectedImageUrl: null,
      timestamp: 123456,
      finalizeToken: 'a'.repeat(64),
    });

    fireEvent.click(await screen.findByTestId('service-detail-edit'));

    expect(screen.getByTestId('service-image-preview')).toHaveAttribute('src', finalService.imageUrl);
  });

  it('reports partial success, refreshes, and reopens the created service as PATCH rather than creating a duplicate', async () => {
    mockRoutes({
      createdService,
      imageStrategy: 'cloudinary',
      imageFailureAt: 'finalize',
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    await openAddDialog();
    fillRequiredAddFields();
    fireEvent.change(screen.getByLabelText('Service image'), {
      target: { files: [new File(['image'], 'image.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Service' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Service details were saved, but the image could not be updated. Open Edit Service to try the image again.',
    );
    // A failed/ambiguous finalization must not let the browser delete an image
    // that the server may already have committed.
    expect(findCall(url => url === 'https://api.cloudinary.com/v1_1/demo/delete_by_token')).toBeUndefined();

    fireEvent.click(await screen.findByTestId('service-detail-edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Update Service' }));

    await waitFor(() => {
      expect(findCall((url, init) =>
        url === '/api/salon/services/svc_new' && init?.method === 'PATCH')).toBeTruthy();
    });

    const detailCreates = fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === '/api/salon/services'
      && (init as RequestInit | undefined)?.method === 'POST');

    expect(detailCreates).toHaveLength(1);
  });

  it('guards against rapid duplicate saves and exposes the active save phase', async () => {
    mockRoutes({
      createdService,
      merchandising: { lusterPromoDismissed: true },
    });

    render(<ServicesModal onClose={() => {}} salonSlug="isla-nail-studio" />);
    await openAddDialog();
    fillRequiredAddFields();

    const saveButton = screen.getByRole('button', { name: 'Save Service' });

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(screen.getByTestId('service-save-status')).toHaveTextContent('Saving service details');
    expect(saveButton).toBeDisabled();

    await waitFor(() => {
      const detailCreates = fetchMock.mock.calls.filter(([input, init]) =>
        String(input) === '/api/salon/services'
        && (init as RequestInit | undefined)?.method === 'POST');

      expect(detailCreates).toHaveLength(1);
    });
  });
});
