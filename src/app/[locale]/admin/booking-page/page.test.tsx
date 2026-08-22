import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyBookingPageBuilderOperation } from '@/libs/bookingPageBuilder';
import {
  BOOKING_PAGE_PRESET_RECIPES,
  getBookingPagePresentationSignature,
} from '@/libs/bookingPagePresetRecipes';

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
  sectionVariants: Partial<Record<string, string>>;
  hiddenSections: string[];
}> = {}) {
  const side = {
    layout: 'quick_book',
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
    sectionVariants: {} as Partial<Record<string, string>>,
    hiddenSections: [] as string[],
    businessMode: 'solo',
    startMode: 'services_first',
    ...overrides,
  };
  return {
    version: 1,
    draft: side,
    live: side,
    draftPresetBase: { presetId: 'quick_book', recipeVersion: 1 } as const,
    livePresetBase: { presetId: 'quick_book', recipeVersion: 1 } as const,
  };
}

function baseContent() {
  const side: {
    heroImageUrl: string | null;
    specialtyLine: string | null;
    bio: string | null;
    locationDisplayMode: string;
  } = { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' };
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
          if (body.builderOperation) {
            const result = applyBookingPageBuilderOperation(
              {
                ...config.draft,
                presetBase: config.draftPresetBase,
              } as never,
              body.builderOperation,
            );
            if (!result.ok) {
              return Promise.resolve(new Response(JSON.stringify({ error: result.code }), { status: 400 }));
            }
            const { presetBase, ...draftPatch } = result.patch;
            config = {
              ...config,
              draft: { ...config.draft, ...draftPatch },
              draftPresetBase: presetBase === undefined
                ? config.draftPresetBase
                : presetBase,
            } as typeof config;
          }
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
            config = {
              ...config,
              live: config.draft,
              livePresetBase: config.draftPresetBase,
            };
            content = { ...content, live: content.draft };
          } else if (body.action === 'revert') {
            config = {
              ...config,
              draft: config.live,
              draftPresetBase: config.livePresetBase,
            };
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

  it('renders exactly the four curated starting designs without a Custom recipe', async () => {
    render(<BookingPageOwnerSurface />);

    const picker = await screen.findByTestId('booking-page-preset-picker');

    expect(within(picker).getAllByRole('button')).toHaveLength(4);
    expect(within(picker).getByRole('button', { name: /Quick Book starting design/ }))
      .toBeDisabled();
    expect(within(picker).getByRole('button', { name: 'Signature starting design' })).toBeEnabled();
    expect(within(picker).getByRole('button', { name: 'Menu starting design' })).toBeEnabled();
    expect(within(picker).getByRole('button', { name: 'Collective starting design' })).toBeEnabled();
    expect(within(picker).queryByRole('button', { name: /Custom/i })).not.toBeInTheDocument();
  });

  it('previews a guarded switch and PATCHes one semantic preset operation only after confirmation', async () => {
    render(<BookingPageOwnerSurface />);
    const signature = await screen.findByRole('button', { name: 'Signature starting design' });
    const expectedPresentationSignature = getBookingPagePresentationSignature({
      ...config.draft,
      presetBase: config.draftPresetBase,
    } as never);

    fireEvent.click(signature);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);

    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');

      expect(patchCalls).toHaveLength(1);
      expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toEqual({
        builderOperation: {
          type: 'apply_preset',
          presetId: 'signature',
          presetVersion: 1,
          expectedPresentationSignature,
        },
      });
    });

    expect(screen.getByText(/starting design applied to your draft/i)).toBeInTheDocument();
    expect(config.live).not.toEqual(config.draft);
  });

  it('refreshes authoritative state after a stale preset confirmation without retrying or publishing', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'apply_preset') {
        config = baseConfig({ sectionVariants: { policies: 'inline' } });
        content = {
          ...content,
          draft: {
            ...content.draft,
            bio: 'A newer bio from another tab',
            locationDisplayMode: 'city_only',
          },
        };
        return Promise.resolve(new Response(JSON.stringify({
          error: 'Invalid builder operation',
          code: 'STALE_PRESENTATION',
        }), { status: 409 }));
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    fireEvent.click(await screen.findByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    expect(await screen.findByText(/draft changed since you opened the confirmation/i))
      .toBeInTheDocument();
    expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Custom · based on Quick Book');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).includes('/api/admin/booking-page') && (init?.method ?? 'GET') === 'GET'
    )).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Signature starting design' })).toBeEnabled();
    expect(screen.getByTestId('location-display-mode-full_address'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('location-display-mode-city-only-warning'))
      .not.toBeInTheDocument();
    expect(screen.getByTestId('content-bio')).toHaveValue('');
  });

  it('does not start a reset while a preset presentation write is pending', async () => {
    config = baseConfig({ hiddenSections: ['policies'] });
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releasePresetWrite: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'apply_preset') {
        return new Promise<Response>((resolve) => {
          releasePresetWrite = () => {
            const recipe = BOOKING_PAGE_PRESET_RECIPES.signature;
            config = {
              ...config,
              draft: {
                ...config.draft,
                layout: recipe.layout,
                sectionOrder: [...recipe.sectionOrder],
                hiddenSections: [...recipe.hiddenSections],
                sectionVariants: { ...recipe.sectionVariants },
              },
              draftPresetBase: { ...recipe.presetBase },
            } as typeof config;
            resolve(new Response(JSON.stringify({
              config,
              content,
              salon: { publicationStatus: salonPublicationStatus },
            }), { status: 200 }));
          };
        });
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    const signature = await screen.findByRole('button', { name: 'Signature starting design' });
    const reset = screen.getByTestId('builder-reset-all');

    fireEvent.click(signature);
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    await waitFor(() => expect(signature).toBeDisabled());

    expect(reset).toBeDisabled();

    fireEvent.click(reset);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);

    releasePresetWrite?.();
    await waitFor(() => expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Signature'));
  });

  it('does not expose a direct layout or Custom action that bypasses recipes', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('booking-page-preset-picker');

    expect(screen.queryByTestId('layout-option-editorial')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Custom starting design/i })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });

  it('shows service discovery and booking access as protected without hide controls', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('booking-page-preset-picker');

    expect(screen.queryByTestId('builder-visibility-serviceMenu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-visibility-bookingCta')).not.toBeInTheDocument();
    expect(screen.getByTestId('builder-section-status-serviceMenu')).toHaveTextContent('Protected');
    expect(screen.getByTestId('builder-section-status-bookingCta')).toHaveTextContent('Protected');
  });

  // Repair A4: salonProfile hosts the page's only <h1> on both layouts and
  // joined the non-removable floor (REQUIRED_SECTION_IDS in
  // @/libs/bookingPageConfig) alongside serviceMenu/bookingCta. A normal
  // admin has no way to hide it because this surface never offers a toggle
  // for it at all — the server-side floor (validateSectionOrder) is the
  // defense against a crafted request bypassing this UI, proven in
  // bookingPageConfig.test.ts's "salonProfile floor" and full-pipeline
  // coverage.
  it('shows salon identity as protected without a hide control', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('booking-page-preset-picker');

    expect(screen.queryByTestId('builder-visibility-salonProfile')).not.toBeInTheDocument();
    expect(screen.getByTestId('builder-section-status-salonProfile')).toHaveTextContent('Protected');
  });

  it('renders portfolio and reviews as unavailable without inert controls', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('booking-page-preset-picker');

    expect(screen.getByTestId('builder-section-status-portfolio')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('builder-section-status-reviews')).toHaveTextContent('Unavailable');
    expect(screen.queryByTestId('builder-visibility-portfolio')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-visibility-reviews')).not.toBeInTheDocument();
  });

  // Post-launch audit fix: whatsIncluded (SECTION_REGISTRY.whatsIncluded's
  // canRender is unconditionally `() => false` — no data field exists yet)
  // and technicianList (no renderer in any layout) could previously be
  // toggled on with zero possible visible effect — an inert toggle with no
  // indication to the owner. Both now render disabled and clearly labelled,
  // same treatment as portfolio/reviews above, rather than silently doing
  // nothing when clicked.
  it('renders whatsIncluded and technicianList as unavailable without inert controls', async () => {
    render(<BookingPageOwnerSurface />);
    await screen.findByTestId('booking-page-preset-picker');

    expect(screen.getByTestId('builder-section-status-whatsIncluded')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('builder-section-status-technicianList')).toHaveTextContent('Unavailable');
    expect(screen.queryByTestId('builder-visibility-whatsIncluded')).not.toBeInTheDocument();
    expect(screen.queryByTestId('builder-visibility-technicianList')).not.toBeInTheDocument();
  });

  it('toggling an optional section PATCHes sectionOrder/hiddenSections and reflects the new state', async () => {
    render(<BookingPageOwnerSurface />);
    const toggle = await screen.findByTestId('builder-visibility-technicianProfile');

    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');

      expect(patchCall).toBeDefined();

      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body.builderOperation).toEqual({
        type: 'set_visibility',
        sectionId: 'technicianProfile',
        visible: true,
      });
    });

    await waitFor(() => expect(screen.getByTestId('builder-visibility-technicianProfile')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('toggling a shown section off adds it to hiddenSections', async () => {
    config = baseConfig({ sectionOrder: [...baseConfig().draft.sectionOrder] });
    render(<BookingPageOwnerSurface />);
    const toggle = await screen.findByTestId('builder-visibility-featuredServices');

    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body.builderOperation).toEqual({
        type: 'set_visibility',
        sectionId: 'featuredServices',
        visible: false,
      });
    });
  });

  it('persists keyboard-operable movement and renders the returned configuration in the same DOM order', async () => {
    const user = userEvent.setup();
    config = baseConfig({
      layout: 'editorial',
      sectionOrder: [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
    });
    render(<BookingPageOwnerSurface />);

    const preview = await screen.findByTitle('Live booking page preview');
    Object.defineProperty(preview, 'contentDocument', {
      configurable: true,
      value: {
        querySelectorAll: () => config.draft.sectionOrder.map(sectionId => ({
          dataset: { publicSurface: sectionId },
        })),
      },
    });
    fireEvent.load(preview);

    const moveDown = await screen.findByRole('button', { name: 'Move Featured services down' });
    moveDown.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');

      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        builderOperation: {
          type: 'move_section',
          sectionId: 'featuredServices',
          targetSectionId: 'technicianProfile',
          direction: 'down',
        },
      });
    });

    await waitFor(() => {
      const rows = within(screen.getByTestId('booking-page-builder-section-list'))
        .getAllByRole('listitem')
        .map(row => row.getAttribute('data-section-id'));

      expect(rows.slice(0, 3)).toEqual([
        'salonProfile',
        'technicianProfile',
        'featuredServices',
      ]);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Featured services down' })).toHaveFocus();
    });

    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 4 movable sections.',
    );
    expect(preview).toHaveAttribute(
      'src',
      '/en/salon-a/book/service?builderPreview=1',
    );

    // The replacement iframe reports the canonical Stage 2 surfaces again.
    // Reorder controls remain stable throughout the refresh instead of being
    // re-created from a guessed/null admission set and dropping focus.
    fireEvent.load(preview);

    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toHaveFocus();
  });

  it('embeds the authenticated real booking route and derives availability from rendered Stage 2 surfaces', async () => {
    render(<BookingPageOwnerSurface />);

    const preview = await screen.findByTitle('Live booking page preview');

    expect(preview).toHaveAttribute(
      'src',
      '/en/salon-a/book/service?builderPreview=0',
    );
    expect(preview).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview).toHaveAttribute('tabindex', '-1');
    expect(preview).toHaveClass('pointer-events-none');
    expect(screen.getByText(/view-only preview using your real salon content/i)).toBeInTheDocument();

    Object.defineProperty(preview, 'contentDocument', {
      configurable: true,
      value: {
        querySelectorAll: () => [
          { dataset: { publicSurface: 'salonProfile' } },
          { dataset: { publicSurface: 'serviceMenu' } },
          { dataset: { publicSurface: 'featuredServices' } },
        ],
      },
    });
    fireEvent.load(preview);

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-status-featuredServices')).toHaveTextContent('Visible');
      expect(screen.getByTestId('builder-section-status-policies')).toHaveTextContent('Unavailable');
    });
  });

  it('requires confirmation before resetting presentation and sends no canonical content fields', async () => {
    config = baseConfig({ hiddenSections: ['policies'] });
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    render(<BookingPageOwnerSurface />);

    fireEvent.click(await screen.findByTestId('builder-reset-all'));

    expect(confirmMock).toHaveBeenCalledWith(expect.stringMatching(/content will not be deleted/i));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      const body = JSON.parse(String(patchCall?.[1]?.body));

      expect(body).toEqual({
        builderOperation: {
          type: 'reset_all',
          expectedPresentationSignature: getBookingPagePresentationSignature({
            ...baseConfig({ hiddenSections: ['policies'] }).draft,
            presetBase: baseConfig().draftPresetBase,
          } as never),
        },
      });
      expect(body).not.toHaveProperty('content');
      expect(body).not.toHaveProperty('config');
    });
  });

  it('refreshes the latest presentation after a stale reset and lets the owner review then retry', async () => {
    config = baseConfig({ hiddenSections: ['policies'] });
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let returnStale = true;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (returnStale
        && init?.method === 'PATCH'
        && body?.builderOperation?.type === 'reset_all') {
        returnStale = false;
        config = baseConfig({
          hiddenSections: ['socialLinks'],
          sectionVariants: { policies: 'inline' },
        });
        return Promise.resolve(new Response(JSON.stringify({
          error: 'Invalid builder operation',
          code: 'STALE_PRESENTATION',
        }), { status: 409 }));
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    fireEvent.click(await screen.findByTestId('builder-reset-all'));

    expect(await screen.findByText(/latest presentation is loaded/i)).toBeInTheDocument();
    expect(screen.getByTestId('builder-visibility-socialLinks'))
      .toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('builder-visibility-policies'))
      .toHaveAttribute('aria-pressed', 'true');

    const latestSignature = getBookingPagePresentationSignature({
      ...config.draft,
      presetBase: config.draftPresetBase,
    } as never);
    fireEvent.click(screen.getByTestId('builder-reset-all'));

    await waitFor(() => {
      const resetCalls = fetchMock.mock.calls.filter(([, init]) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        return init?.method === 'PATCH' && body?.builderOperation?.type === 'reset_all';
      });

      expect(resetCalls).toHaveLength(2);
      expect(JSON.parse(String(resetCalls[1]?.[1]?.body))).toEqual({
        builderOperation: {
          type: 'reset_all',
          expectedPresentationSignature: latestSignature,
        },
      });
    });

    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('does not publish or switch presets while a builder presentation write is pending', async () => {
    config = baseConfig({ hiddenSections: ['policies'] });
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseBuilderWrite: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'reset_all') {
        return new Promise<Response>((resolve) => {
          releaseBuilderWrite = () => {
            const result = applyBookingPageBuilderOperation(
              { ...config.draft, presetBase: config.draftPresetBase } as never,
              body.builderOperation,
            );
            if (result.ok) {
              const { presetBase, ...draftPatch } = result.patch;
              config = {
                ...config,
                draft: { ...config.draft, ...draftPatch },
                draftPresetBase: presetBase === undefined
                  ? config.draftPresetBase
                  : presetBase,
              } as typeof config;
            }
            resolve(new Response(JSON.stringify({
              config,
              content,
              salon: { publicationStatus: salonPublicationStatus },
            }), { status: 200 }));
          };
        });
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    const reset = await screen.findByTestId('builder-reset-all');
    fireEvent.click(reset);

    const publish = screen.getByTestId('booking-page-publish');
    const signature = screen.getByRole('button', { name: 'Signature starting design' });
    await waitFor(() => {
      expect(publish).toBeDisabled();
      expect(signature).toBeDisabled();
    });

    fireEvent.click(publish);
    fireEvent.click(signature);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);

    releaseBuilderWrite?.();
    await waitFor(() => expect(publish).toBeEnabled());
  });

  it('does not start a builder operation while Publish is pending', async () => {
    config = baseConfig({ hiddenSections: ['policies'] });
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releasePublish: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).includes('/api/admin/booking-page')) {
        return new Promise<Response>((resolve) => {
          releasePublish = () => resolve(new Response(JSON.stringify({
            config,
            content,
            salon: { publicationStatus: salonPublicationStatus },
          }), { status: 200 }));
        });
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    fireEvent.click(await screen.findByTestId('booking-page-publish'));

    const reset = screen.getByTestId('builder-reset-all');
    await waitFor(() => expect(reset).toBeDisabled());
    fireEvent.click(reset);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);

    releasePublish?.();
    await waitFor(() => expect(reset).toBeEnabled());
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

      await screen.findByTestId('booking-page-preset-picker');

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
