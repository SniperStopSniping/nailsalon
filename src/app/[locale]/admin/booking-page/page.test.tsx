import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyBookingPageBuilderOperation,
  listBookingPageBuilderSections,
} from '@/libs/bookingPageBuilder';
import type { QuickBookProfileVisibility } from '@/libs/bookingPageConfig';
import {
  BOOKING_PAGE_PRESET_RECIPES,
  getBookingPagePresentationSignature,
} from '@/libs/bookingPagePresetRecipes';
import type { ServiceMenuLayout } from '@/libs/serviceMenuLayout';

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

const QUICK_BOOK_PROFILE_DEFAULTS: QuickBookProfileVisibility = {
  showBio: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showEmail: false,
  showHours: false,
  showInstagram: false,
  showLocation: false,
  showPhone: false,
  showReviews: false,
  showTechName: false,
  showTechPhoto: false,
};

function baseConfig(overrides: Partial<{
  layout: string;
  stylePack: string;
  businessMode: string;
  serviceMenuLayout: ServiceMenuLayout;
  quickBookProfile: QuickBookProfileVisibility;
  sectionOrder: string[];
  sectionVariants: Partial<Record<string, string>>;
  hiddenSections: string[];
}> = {}) {
  const side = {
    layout: 'quick_book',
    serviceMenuLayout: 'visual_grid' as const,
    stylePack: 'default',
    tokenOverrides: null,
    sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
    sectionVariants: {} as Partial<Record<string, string>>,
    hiddenSections: [] as string[],
    businessMode: 'solo',
    startMode: 'services_first',
    quickBookProfile: { ...QUICK_BOOK_PROFILE_DEFAULTS },
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

function previewDocumentForSections(
  sectionIds: readonly string[],
  {
    authorizedDraft = true,
    canonical = true,
    complete = true,
    layout = 'quick_book',
    reorderableSectionOrder = sectionIds.filter(sectionId => (
      listBookingPageBuilderSections(layout)
        .some(definition => definition.id === sectionId && definition.reorderable)
    )),
  }: {
    authorizedDraft?: boolean;
    canonical?: boolean;
    complete?: boolean;
    layout?: string;
    reorderableSectionOrder?: readonly string[];
  } = {},
) {
  const previewDocument = document.implementation.createHTMLDocument('booking preview');

  if (authorizedDraft) {
    const authorizedMarker = previewDocument.createElement('div');
    authorizedMarker.dataset.previewVariant = 'draft-config';
    previewDocument.body.append(authorizedMarker);
  }
  if (canonical) {
    const canonicalSurface = previewDocument.createElement('div');
    canonicalSurface.dataset.publicSurface = 'serviceSelectionControls';
    previewDocument.body.append(canonicalSurface);
  }
  if (complete) {
    const completedRenderer = previewDocument.createElement('div');
    completedRenderer.dataset.builderReorderableSectionOrder = reorderableSectionOrder.join(' ');
    previewDocument.body.append(completedRenderer);
  }
  for (const sectionId of sectionIds) {
    const section = previewDocument.createElement('div');
    section.dataset.publicSurface = sectionId;
    previewDocument.body.append(section);
  }

  return previewDocument;
}

function installPreviewDocument(frame: HTMLElement, previewDocument: Document) {
  const frameSrc = frame.getAttribute('src');
  Object.defineProperty(previewDocument, 'URL', {
    configurable: true,
    value: frameSrc ? new URL(frameSrc, document.baseURI).href : 'about:blank',
  });
  Object.defineProperty(frame, 'contentDocument', {
    configurable: true,
    value: previewDocument,
  });
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      history: { scrollRestoration: 'auto' },
      scrollTo: vi.fn(),
    }) as unknown as Window,
  });
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

  it('reviews current published data without restarting onboarding and saves text before continuing', async () => {
    searchParamsMock.value = new URLSearchParams('salon=salon-a&panel=text&guided=1');
    render(<BookingPageOwnerSurface />);
    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Updated current owner biography' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & next step' }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en/admin/booking-page?salon=salon-a&panel=policies&guided=1'));

    expect(content.draft.bio).toBe('Updated current owner biography');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/onboarding'))).toBe(false);
  });

  it('stays in the current editor when saving before navigation fails', async () => {
    searchParamsMock.value = new URLSearchParams('salon=salon-a&panel=text&guided=1');
    const originalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PATCH'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }))
      : originalFetch(input, init));
    render(<BookingPageOwnerSurface />);
    fireEvent.change(await screen.findByTestId('content-bio'), { target: { value: 'Keep this edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & next step' }));
    await screen.findByText('Your changes could not be saved. Please retry before leaving this editor.');

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('content-bio')).toHaveValue('Keep this edit');
  });

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
              return Promise.resolve(new Response(
                JSON.stringify({ error: result.code, code: result.code }),
                { status: result.code === 'STALE_PRESENTATION' ? 409 : 400 },
              ));
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
            config = {
              ...config,
              draft: {
                ...config.draft,
                ...body.config,
                ...(body.config.quickBookProfile
                  ? {
                      quickBookProfile: {
                        ...config.draft.quickBookProfile,
                        ...body.config.quickBookProfile,
                      },
                    }
                  : {}),
              },
            };
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

  it('does not let a cancelled StrictMode bootstrap identify a newer booking-state request', async () => {
    searchParamsMock.value = new URLSearchParams();
    const fallbackFetch = fetchMock.getMockImplementation()!;
    const releaseAuthRequests: Array<() => void> = [];
    const releaseBookingRequests: Array<() => void> = [];

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/admin/auth/me')) {
        return new Promise<Response>((resolve) => {
          releaseAuthRequests.push(() => resolve(new Response(JSON.stringify({
            user: { salons: [{ slug: 'salon-a', bookingUrl: 'https://salon-a.example.com/en/salon-a/book/service' }] },
          }), { status: 200 })));
        });
      }
      if (url.includes('/api/admin/booking-page') && method === 'GET') {
        return new Promise<Response>((resolve) => {
          releaseBookingRequests.push(() => resolve(new Response(JSON.stringify({
            config,
            content,
            salon: { publicationStatus: salonPublicationStatus },
          }), { status: 200 })));
        });
      }
      return fallbackFetch(input, init);
    });

    render(
      <StrictMode>
        <BookingPageOwnerSurface />
      </StrictMode>,
    );

    await waitFor(() => expect(releaseAuthRequests).toHaveLength(2));

    await act(async () => {
      releaseAuthRequests[1]?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(releaseBookingRequests).toHaveLength(1));

    await act(async () => {
      releaseAuthRequests[0]?.();
      await Promise.resolve();
    });

    expect(releaseBookingRequests).toHaveLength(1);

    await act(async () => {
      releaseBookingRequests[0]?.();
      await Promise.resolve();
    });

    expect(await screen.findByTestId('booking-page-preset-picker')).toBeInTheDocument();
  });

  it('renders exactly the four curated starting designs and treats the current preset as a no-op', async () => {
    render(<BookingPageOwnerSurface />);

    const picker = await screen.findByTestId('booking-page-preset-picker');
    const currentPreset = within(picker).getByRole('button', { name: /Quick Book starting design/ });

    expect(within(picker).getAllByRole('button')).toHaveLength(4);
    expect(currentPreset).toBeDisabled();
    expect(within(picker).getByRole('button', { name: 'Signature starting design' })).toBeEnabled();
    expect(within(picker).getByRole('button', { name: 'Menu starting design' })).toBeEnabled();
    expect(within(picker).getByRole('button', { name: 'Collective starting design' })).toBeEnabled();
    expect(within(picker).queryByRole('button', { name: /Custom/i })).not.toBeInTheDocument();

    fireEvent.click(currentPreset);

    expect(screen.queryByRole('button', { name: 'Use Quick Book' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });

  it('saves one Quick Book visibility switch with a narrow config patch and refreshes the preview', async () => {
    config = baseConfig({
      quickBookProfile: {
        ...QUICK_BOOK_PROFILE_DEFAULTS,
        showEmail: true,
      },
    });
    render(<BookingPageOwnerSurface />);

    const card = await screen.findByTestId('quick-book-profile-visibility-card');
    const phoneSwitch = within(card).getByRole('switch', { name: /Show phone/i });
    const emailSwitch = within(card).getByRole('switch', { name: /Show email/i });

    expect(within(card).getAllByRole('switch')).toHaveLength(11);
    expect(phoneSwitch).not.toBeChecked();
    expect(emailSwitch).toBeChecked();
    expect(screen.getByTitle('Live booking page preview')).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=0',
    );

    await userEvent.click(phoneSwitch);

    await waitFor(() => {
      const visibilityWrites = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .map(([, init]) => JSON.parse(String(init?.body)))
        .filter(body => body.config?.quickBookProfile);

      expect(visibilityWrites).toEqual([{
        config: { quickBookProfile: { showPhone: true } },
      }]);
    });

    expect(phoneSwitch).toBeChecked();
    expect(emailSwitch).toBeChecked();
    expect(content).toEqual(baseContent());
    expect(screen.getByTitle('Live booking page preview')).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=1',
    );
  });

  it('does not render Quick Book visibility controls for Editorial', async () => {
    config = baseConfig({ layout: 'editorial' });
    render(<BookingPageOwnerSurface />);

    await screen.findByTestId('booking-page-preset-picker');

    expect(screen.queryByTestId('quick-book-profile-visibility-card')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Show phone/i })).not.toBeInTheDocument();
  });

  it('previews a guarded switch and PATCHes one semantic preset operation only after confirmation', async () => {
    const originalLiveConfig = structuredClone(config.live);
    const originalLiveContent = structuredClone(content.live);
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
    expect(config.live).toEqual(originalLiveConfig);
    expect(content.live).toEqual(originalLiveContent);
  });

  it('keeps a preset confirmation valid when only canonical content changes', async () => {
    render(<BookingPageOwnerSurface />);
    const expectedPresentationSignature = getBookingPagePresentationSignature({
      ...config.draft,
      presetBase: config.draftPresetBase,
    } as never);

    fireEvent.click(await screen.findByRole('button', { name: 'Signature starting design' }));

    const bio = screen.getByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Content does not change presentation' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(content.draft.bio).toBe('Content does not change presentation'));

    fireEvent.click(screen.getByRole('button', { name: 'Use Signature' }));

    await waitFor(() => expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Signature'));

    const applyCall = fetchMock.mock.calls.find(([, init]) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return body?.builderOperation?.type === 'apply_preset';
    });

    expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({
      builderOperation: {
        type: 'apply_preset',
        presetId: 'signature',
        presetVersion: 1,
        expectedPresentationSignature,
      },
    });
    expect(screen.getByTestId('content-bio'))
      .toHaveValue('Content does not change presentation');
  });

  it('drains concurrent bio and location saves before adopting a preset response', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseBioSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Bio saved before preset') {
        content = {
          ...content,
          draft: { ...content.draft, bio: 'Bio saved before preset' },
        };
        const response = new Response(JSON.stringify({
          config,
          content,
          salon: { publicationStatus: salonPublicationStatus },
        }), { status: 200 });
        return new Promise<Response>((resolve) => {
          releaseBioSave = () => resolve(response);
        });
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Bio saved before preset' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseBioSave).toBeTypeOf('function'));
    fireEvent.click(screen.getByTestId('location-display-mode-city_only'));

    fireEvent.click(screen.getByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);

    releaseBioSave?.();

    await waitFor(() => expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Signature'));

    expect(screen.getByTestId('content-bio')).toHaveValue('Bio saved before preset');
    expect(screen.getByTestId('location-display-mode-city_only'))
      .toHaveAttribute('aria-pressed', 'true');

    const patchBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)));

    expect(patchBodies.map(body => (
      body.content?.bio
        ? 'bio'
        : body.content?.locationDisplayMode
          ? 'location'
          : body.builderOperation?.type
    ))).toEqual(['bio', 'location', 'apply_preset']);
  });

  it('adopts a successful preset response across the controls and preview before a later blur', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    salonPublicationStatus = 'draft';

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'apply_preset') {
        content = {
          ...content,
          draft: {
            heroImageUrl: 'https://cdn.example.com/remote-hero.jpg',
            specialtyLine: 'Remote specialty',
            bio: 'Remote canonical bio',
            locationDisplayMode: 'city_only',
          },
        };
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    fireEvent.click(await screen.findByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    await waitFor(() => expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Signature'));

    expect(screen.getByTestId('content-hero-image-url'))
      .toHaveValue('https://cdn.example.com/remote-hero.jpg');
    expect(screen.getByTestId('content-specialty-line')).toHaveValue('Remote specialty');
    expect(screen.getByTestId('content-bio')).toHaveValue('Remote canonical bio');
    expect(screen.getByTestId('location-display-mode-city_only'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('salon-publish-banner')).toBeInTheDocument();
    expect(screen.getByTitle('Live booking page preview')).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=1',
    );

    fireEvent.blur(screen.getByTestId('content-bio'));

    await waitFor(() => {
      const contentPatches = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .map(([, init]) => JSON.parse(String(init?.body)))
        .filter(body => body.content);

      expect(contentPatches.at(-1)?.content).toEqual({ bio: 'Remote canonical bio' });
    });

    expect(screen.getByTestId('content-bio')).toHaveValue('Remote canonical bio');
  });

  it('preserves a newer unsaved local bio while adopting the rest of a preset response', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'apply_preset') {
        content = {
          ...content,
          draft: {
            ...content.draft,
            bio: 'Remote bio',
            locationDisplayMode: 'city_only',
          },
        };
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'New local unsaved bio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    await waitFor(() => expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Signature'));

    expect(screen.getByTestId('content-bio')).toHaveValue('New local unsaved bio');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-display-mode-city_only'))
      .toHaveAttribute('aria-pressed', 'true');

    fireEvent.blur(screen.getByTestId('content-bio'));
    await waitFor(() => expect(content.draft.bio).toBe('New local unsaved bio'));
  });

  it('keeps a newer local edit unsaved after an older response and saves the current value on blur', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseOlderSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Older server bio') {
        content = {
          ...content,
          draft: { ...content.draft, bio: 'Older server bio' },
        };
        const response = new Response(JSON.stringify({
          config,
          content,
          salon: { publicationStatus: salonPublicationStatus },
        }), { status: 200 });
        return new Promise<Response>((resolve) => {
          releaseOlderSave = () => resolve(response);
        });
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Older server bio' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseOlderSave).toBeTypeOf('function'));

    fireEvent.change(bio, { target: { value: 'Newer local bio' } });
    releaseOlderSave?.();

    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(bio).toHaveValue('Newer local bio');
    expect(content.draft.bio).toBe('Older server bio');

    fireEvent.blur(bio);

    await waitFor(() => expect(content.draft.bio).toBe('Newer local bio'));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(bio).toHaveValue('Newer local bio');
  });

  it('serializes an older non-presentation field save before applying the authoritative Current design', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseOlderFieldSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.config?.businessMode === 'team') {
        config = {
          ...config,
          draft: { ...config.draft, businessMode: 'team' },
        };
        const olderResponse = new Response(JSON.stringify({
          config,
          content,
          salon: { publicationStatus: salonPublicationStatus },
        }), { status: 200 });

        return new Promise<Response>((resolve) => {
          releaseOlderFieldSave = () => resolve(olderResponse);
        });
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    fireEvent.click(await screen.findByTestId('business-mode-option-team'));
    await waitFor(() => expect(releaseOlderFieldSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    await waitFor(() => {
      const builderCalls = fetchMock.mock.calls.filter(([, init]) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        return body?.builderOperation?.type === 'apply_preset';
      });

      expect(builderCalls).toHaveLength(0);
    });

    releaseOlderFieldSave?.();

    await waitFor(() => expect(screen.getByTestId('booking-page-preset-state'))
      .toHaveTextContent('Signature'));

    expect(screen.getByText(/starting design applied to your draft/i)).toBeInTheDocument();
    expect(screen.getByTitle('Live booking page preview')).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=2',
    );
  });

  it('serializes ordinary content writes so one whole-side response cannot lose another field', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseBioSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Queued bio') {
        content = {
          ...content,
          draft: { ...content.draft, bio: 'Queued bio' },
        };
        const response = new Response(JSON.stringify({
          config,
          content,
          salon: { publicationStatus: salonPublicationStatus },
        }), { status: 200 });

        return new Promise<Response>((resolve) => {
          releaseBioSave = () => resolve(response);
        });
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Queued bio' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseBioSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByTestId('location-display-mode-city_only'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);

    releaseBioSave?.();

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2);
      expect(content.draft).toMatchObject({
        bio: 'Queued bio',
        locationDisplayMode: 'city_only',
      });
    });
  });

  it('does not report Saved when the newer serialized field request fails', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseOlderSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Older saved bio') {
        content = {
          ...content,
          draft: { ...content.draft, bio: 'Older saved bio' },
        };
        const response = new Response(JSON.stringify({
          config,
          content,
          salon: { publicationStatus: salonPublicationStatus },
        }), { status: 200 });

        return new Promise<Response>((resolve) => {
          releaseOlderSave = () => resolve(response);
        });
      }
      if (init?.method === 'PATCH' && body?.content?.bio === 'Newer failed bio') {
        return Promise.resolve(new Response(JSON.stringify({ error: 'write failed' }), {
          status: 500,
        }));
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Older saved bio' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseOlderSave).toBeTypeOf('function'));

    fireEvent.change(bio, { target: { value: 'Newer failed bio' } });
    fireEvent.blur(bio);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);

    releaseOlderSave?.();

    await screen.findByText('Could not save — please retry.');

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-bio')).toHaveValue('Newer failed bio');
    expect(content.draft.bio).toBe('Older saved bio');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2);
  });

  it('reports a failed preset save without changing Current design or publishing', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    const originalDraft = structuredClone(config.draft);

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'apply_preset') {
        return Promise.resolve(new Response(JSON.stringify({ error: 'write failed' }), {
          status: 500,
        }));
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    fireEvent.click(await screen.findByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));

    await screen.findByText('We couldn’t switch the starting design. Your draft was not changed.');

    expect(screen.getByTestId('booking-page-preset-state')).toHaveTextContent('Quick Book');
    expect(config.draft).toEqual(originalDraft);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('does not apply a preset after a pending bio save fails', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseFailedSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Unsaved failing bio') {
        return new Promise<Response>((resolve) => {
          releaseFailedSave = () => resolve(new Response(
            JSON.stringify({ error: 'write failed' }),
            { status: 500 },
          ));
        });
      }
      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);
    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Unsaved failing bio' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseFailedSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByRole('button', { name: 'Signature starting design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Signature' }));
    releaseFailedSave?.();

    await screen.findByText('We couldn’t switch the starting design. Your draft was not changed.');

    expect(screen.getByTestId('booking-page-preset-state')).toHaveTextContent('Quick Book');
    expect(fetchMock.mock.calls.filter(([, init]) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return body?.builderOperation?.type === 'apply_preset';
    })).toHaveLength(0);
  });

  it('recovers complete authoritative state after a stale preset confirmation without retrying or publishing', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    salonPublicationStatus = 'draft';

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.builderOperation?.type === 'apply_preset') {
        config = baseConfig({
          businessMode: 'team',
          sectionVariants: { policies: 'inline' },
        });
        content = {
          ...content,
          draft: {
            ...content.draft,
            heroImageUrl: 'https://cdn.example.com/newer.jpg',
            specialtyLine: 'Newer specialty',
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
    expect(screen.getByTestId('business-mode-option-team'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('location-display-mode-city_only'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('location-display-mode-city-only-warning'))
      .toBeInTheDocument();
    expect(screen.getByTestId('content-hero-image-url'))
      .toHaveValue('https://cdn.example.com/newer.jpg');
    expect(screen.getByTestId('content-specialty-line')).toHaveValue('Newer specialty');
    expect(screen.getByTestId('content-bio'))
      .toHaveValue('A newer bio from another tab');
    expect(screen.getByTestId('salon-publish-banner')).toBeInTheDocument();
    expect(screen.getByTitle('Live booking page preview')).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=1',
    );
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
    installPreviewDocument(preview, previewDocumentForSections(config.draft.sectionOrder, {
      layout: config.draft.layout,
    }));
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
      expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    });

    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toBeDisabled();

    const replacementPreview = await screen.findByTitle('Live booking page preview');

    expect(replacementPreview).not.toBe(preview);
    expect(replacementPreview).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=1',
    );

    // An expired owner session can return the canonical LIVE renderer, but
    // without the authorization-bound draft marker it is not Stage 2 evidence
    // for this draft move and must not produce a false announcement.
    installPreviewDocument(replacementPreview, previewDocumentForSections(config.live.sectionOrder, {
      authorizedDraft: false,
      layout: config.live.layout,
    }));
    fireEvent.load(replacementPreview);

    expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    // An authorized response that stops before the canonical renderer's
    // terminal attestation cannot prove the complete movable set.
    installPreviewDocument(replacementPreview, previewDocumentForSections(config.draft.sectionOrder, {
      complete: false,
      layout: config.draft.layout,
    }));
    fireEvent.load(replacementPreview);

    expect(screen.getByTestId('builder-section-featuredServices')).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toBeEmptyDOMElement();

    // The canonical replacement iframe reports the Stage 2 surfaces. The row
    // remained mounted while stale, then keyboard focus returns to its enabled
    // movement controls once the exact revision is attested.
    installPreviewDocument(replacementPreview, previewDocumentForSections(config.draft.sectionOrder, {
      layout: config.draft.layout,
    }));
    fireEvent.load(replacementPreview);

    expect(screen.getByRole('button', { name: 'Move Featured services down' })).toHaveFocus();
    expect(screen.getByTestId('builder-reorder-status')).toHaveTextContent(
      'Featured services moved to position 2 of 4 movable sections.',
    );
  });

  it('embeds the authenticated real booking route and derives availability from rendered Stage 2 surfaces', async () => {
    render(<BookingPageOwnerSurface />);

    const preview = await screen.findByTitle('Live booking page preview');

    expect(preview).toHaveAttribute(
      'src',
      '/admin/booking-page/preview/salon-a?builderPreview=0',
    );
    expect(preview).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview).toHaveAttribute('tabindex', '-1');
    expect(preview).toHaveClass('pointer-events-none');
    expect(screen.getByText(/view-only preview using your real salon content/i)).toBeInTheDocument();

    installPreviewDocument(preview, previewDocumentForSections([
      'salonProfile',
      'serviceMenu',
      'featuredServices',
    ]));
    fireEvent.load(preview);

    expect(preview).toHaveClass('pointer-events-none');
    expect(preview).not.toHaveClass('pointer-events-auto');
    expect(preview).toHaveAttribute('inert');
    expect(preview.closest('[data-booking-page-preview-scroll]')).toHaveClass(
      'overflow-hidden',
    );

    await waitFor(() => {
      expect(screen.getByTestId('builder-section-status-featuredServices')).toHaveTextContent('Visible');
      expect(screen.getByTestId('builder-section-status-policies')).toHaveTextContent('Unavailable');
    });

    // A later login/error/partial document can reuse the same iframe element.
    // It must not inherit the pointer-enabled state of the valid draft load.
    installPreviewDocument(preview, previewDocumentForSections([
      'salonProfile',
      'serviceMenu',
      'featuredServices',
    ], { authorizedDraft: false }));
    fireEvent.load(preview);

    expect(preview).toHaveClass('pointer-events-none');
    expect(preview).not.toHaveClass('pointer-events-auto');
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

  it('keeps full-page draft preview on the authenticated owner origin even when auth/me advertises a public host', async () => {
    render(<BookingPageOwnerSurface />);

    const link = await screen.findByTestId('booking-page-preview-link');
    await waitFor(() => {
      expect(link).toHaveAttribute('href', '/admin/booking-page/preview/salon-a');
    });

    expect(link.getAttribute('href')).not.toContain('salon-a.example.com');
    expect(link.getAttribute('href')).not.toContain('builderPreview');
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

  it.each([
    {
      action: 'publish',
      buttonTestId: 'booking-page-publish',
      success: /Published\. Your live booking page now matches your draft\./,
    },
    {
      action: 'revert',
      buttonTestId: 'booking-page-revert',
      success: /Reverted\. Your draft now matches what is live\./,
    },
  ] as const)('waits for an in-flight field save before $action', async ({
    action,
    buttonTestId,
    success,
  }) => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseFieldSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Settled before action') {
        content = {
          ...content,
          draft: { ...content.draft, bio: 'Settled before action' },
        };
        const response = new Response(JSON.stringify({
          config,
          content,
          salon: { publicationStatus: salonPublicationStatus },
        }), { status: 200 });

        return new Promise<Response>((resolve) => {
          releaseFieldSave = () => resolve(response);
        });
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Settled before action' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseFieldSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByTestId(buttonTestId));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    releaseFieldSave?.();
    await screen.findByText(success);

    const bookingPageWrites = fetchMock.mock.calls
      .filter(([input, init]) => String(input).includes('/api/admin/booking-page')
        && (init?.method === 'PATCH' || init?.method === 'POST'));

    expect(bookingPageWrites.map(([, init]) => init?.method)).toEqual(['PATCH', 'POST']);
    expect(JSON.parse(String(bookingPageWrites[1]?.[1]?.body))).toEqual({ action });
  });

  it('saves a focused field before Publish when the owner activates Publish directly', async () => {
    const user = userEvent.setup();

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    await user.click(bio);
    await user.type(bio, 'Publish this bio');
    await user.click(screen.getByTestId('booking-page-publish'));

    await screen.findByText(/Published\. Your live booking page now matches your draft\./);

    const bookingPageWrites = fetchMock.mock.calls
      .filter(([input, init]) => String(input).includes('/api/admin/booking-page')
        && (init?.method === 'PATCH' || init?.method === 'POST'));

    expect(bookingPageWrites.map(([, init]) => init?.method)).toEqual(['PATCH', 'POST']);
    expect(content.live.bio).toBe('Publish this bio');
  });

  it('does not publish after a failed field save', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseFailedSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Will fail') {
        return new Promise<Response>((resolve) => {
          releaseFailedSave = () => resolve(new Response(JSON.stringify({ error: 'write failed' }), {
            status: 500,
          }));
        });
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Will fail' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseFailedSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByTestId('booking-page-publish'));
    releaseFailedSave?.();

    await screen.findByText(
      'Publish paused because a draft field could not be saved. Retry the field, then publish again.',
    );

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('drains a failed field request before a confirmed Revert discards it', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let releaseFailedSave: (() => void) | undefined;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Discard me') {
        return new Promise<Response>((resolve) => {
          releaseFailedSave = () => resolve(new Response(JSON.stringify({ error: 'write failed' }), {
            status: 500,
          }));
        });
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Discard me' } });
    fireEvent.blur(bio);
    await waitFor(() => expect(releaseFailedSave).toBeTypeOf('function'));

    fireEvent.click(screen.getByTestId('booking-page-revert'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    releaseFailedSave?.();
    await screen.findByText(/Reverted\. Your draft now matches what is live\./);

    expect(screen.getByTestId('content-bio')).toHaveValue('');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('does not let an unrelated successful field save erase a failed field', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Unsaved bio') {
        return Promise.resolve(new Response(JSON.stringify({ error: 'write failed' }), {
          status: 500,
        }));
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Unsaved bio' } });
    fireEvent.blur(bio);
    await screen.findByText('Could not save — please retry.');

    fireEvent.click(screen.getByTestId('business-mode-option-team'));
    await waitFor(() => expect(config.draft.businessMode).toBe('team'));

    expect(screen.getByText('Could not save — please retry.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('booking-page-publish'));
    await screen.findByText(
      'Publish paused because a draft field could not be saved. Retry the field, then publish again.',
    );

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('clears a failed-field guard only after that same field saves successfully', async () => {
    const fallbackFetch = fetchMock.getMockImplementation()!;
    let bioAttempts = 0;

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (init?.method === 'PATCH' && body?.content?.bio === 'Retried bio') {
        bioAttempts += 1;
        if (bioAttempts === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'write failed' }), {
            status: 500,
          }));
        }
      }

      return fallbackFetch(input, init);
    });

    render(<BookingPageOwnerSurface />);

    const bio = await screen.findByTestId('content-bio');
    fireEvent.change(bio, { target: { value: 'Retried bio' } });
    fireEvent.blur(bio);
    await screen.findByText('Could not save — please retry.');

    fireEvent.blur(bio);
    await screen.findByText('Saved');

    fireEvent.click(screen.getByTestId('booking-page-publish'));
    await screen.findByText(/Published\. Your live booking page now matches your draft\./);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
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
      const previousPreview = screen.getByTitle('Live booking page preview');
      const previousSrc = previousPreview.getAttribute('src');
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

      const refreshedPreview = screen.getByTitle('Live booking page preview');

      expect(refreshedPreview).not.toBe(previousPreview);
      expect(refreshedPreview.getAttribute('src')).not.toBe(previousSrc);
      expect(refreshedPreview).toHaveAttribute('src', expect.stringMatching(
        /^\/admin\/booking-page\/preview\/salon-a\?builderPreview=\d+$/,
      ));
    });

    it('shows an error and keeps the banner when the publish call fails', async () => {
      salonPublicationStatus = 'draft';
      salonPublishShouldFail = true;
      render(<BookingPageOwnerSurface />);

      const button = await screen.findByTestId('salon-publish-button');
      const previousPreview = screen.getByTitle('Live booking page preview');
      const previousSrc = previousPreview.getAttribute('src');
      fireEvent.click(button);

      await screen.findByRole('alert');

      expect(screen.getByTestId('salon-publish-banner')).toBeInTheDocument();
      expect(screen.getByTitle('Live booking page preview')).toBe(previousPreview);
      expect(previousPreview).toHaveAttribute('src', previousSrc);
    });

    it('does not regress published salon metadata when an older booking-page response arrives last', async () => {
      salonPublicationStatus = 'draft';
      const fallbackFetch = fetchMock.getMockImplementation()!;
      let releaseBookingPagePublish: (() => void) | undefined;

      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/admin/booking-page') && init?.method === 'POST') {
          const staleResponse = new Response(JSON.stringify({
            config,
            content,
            salon: { publicationStatus: 'draft' },
          }), { status: 200 });
          return new Promise<Response>((resolve) => {
            releaseBookingPagePublish = () => resolve(staleResponse);
          });
        }
        return fallbackFetch(input, init);
      });

      render(<BookingPageOwnerSurface />);

      await screen.findByTestId('salon-publish-banner');
      fireEvent.click(screen.getByTestId('booking-page-publish'));
      await waitFor(() => expect(releaseBookingPagePublish).toBeTypeOf('function'));

      const salonPublishButton = screen.getByTestId('salon-publish-button');

      expect(salonPublishButton).toBeEnabled();

      fireEvent.click(salonPublishButton);

      await waitFor(() => {
        expect(screen.queryByTestId('salon-publish-banner')).not.toBeInTheDocument();
      });

      releaseBookingPagePublish?.();
      await screen.findByText(/Published\. Your live booking page now matches your draft\./);

      expect(screen.queryByTestId('salon-publish-banner')).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.filter(([url, init]) => (
        String(url).includes('/api/admin/salon/publish') && init?.method === 'POST'
      ))).toHaveLength(1);
      expect(fetchMock.mock.calls.filter(([url, init]) => (
        String(url).includes('/api/admin/booking-page') && init?.method === 'POST'
      ))).toHaveLength(1);
    });
  });
});
