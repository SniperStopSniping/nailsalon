import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH, POST } from './route';

const {
  requireAdmin,
  getSalonBySlug,
  getSalonById,
  logAuditEvent,
  updateBookingPageDraft,
  publishBookingPageConfig,
  revertBookingPageDraft,
  resolveBookingPageConfig,
  updateBookingPageContentDraft,
  publishBookingPageContent,
  revertBookingPageContentDraft,
  resolveBookingPageContent,
  applyBookingPageBuilderOperation,
  getBookingPageDraftPresentationState,
  BookingPageBuilderWriteError,
  stubDraftPatchSchema,
  stubBuilderOperationSchema,
  stubContentPatchSchema,
} = vi.hoisted(() => {
  // Minimal stand-in schemas: real validation strictness (unknown layout
  // values, malformed section ids, hex-color checks, etc.) is already
  // asserted directly against the real modules in `bookingPageConfig.test.ts`,
  // `bookingPageConfig.publishRevert.test.ts` and `bookingPageContent.test.ts`.
  // This route test only needs shapes close enough to exercise the route's
  // own wiring (auth guard, request parsing, which helper gets called with
  // what) — must live inside this `vi.hoisted` factory (not a top-level
  // const) since `vi.mock` factories below are hoisted above the rest of
  // this file.
  // `vi.hoisted` factories run before every import in this file (including
  // `zod`), so a plain `require` is used here instead of the top-level `z`
  // import — the only way to reach a real ZodType constructor from inside
  // this hoisted factory.
  // eslint-disable-next-line ts/no-require-imports
  const { z: zLocal } = require('zod') as typeof import('zod');

  const stubDraftPatchSchemaInner = zLocal.object({
    layout: zLocal.string().optional(),
    stylePack: zLocal.string().optional(),
    businessMode: zLocal.string().optional(),
    startMode: zLocal.string().optional(),
    sectionOrder: zLocal.array(zLocal.string()).optional(),
    hiddenSections: zLocal.array(zLocal.string()).optional(),
    sectionVariants: zLocal.record(zLocal.string(), zLocal.string()).optional(),
    tokenOverrides: zLocal.record(zLocal.string(), zLocal.unknown()).nullable().optional(),
  }).strict();

  const stubContentPatchSchemaInner = zLocal.object({
    heroImageUrl: zLocal.string().nullable().optional(),
    specialtyLine: zLocal.string().nullable().optional(),
    bio: zLocal.string().nullable().optional(),
    locationDisplayMode: zLocal.string().optional(),
  }).strict();

  const stubBuilderOperationSchemaInner = zLocal.discriminatedUnion('type', [
    zLocal.object({
      type: zLocal.literal('set_visibility'),
      sectionId: zLocal.string(),
      visible: zLocal.boolean(),
    }).strict(),
    zLocal.object({
      type: zLocal.literal('move_section'),
      sectionId: zLocal.string(),
      targetSectionId: zLocal.string(),
      direction: zLocal.enum(['up', 'down']),
    }).strict(),
    zLocal.object({
      type: zLocal.literal('set_variant'),
      sectionId: zLocal.string(),
      variant: zLocal.string().min(1).nullable(),
    }).strict(),
    zLocal.object({
      type: zLocal.literal('reset_section'),
      sectionId: zLocal.string(),
    }).strict(),
    zLocal.object({
      type: zLocal.literal('reset_all'),
      expectedPresentationSignature: zLocal.string().min(1),
    }).strict(),
    zLocal.object({
      type: zLocal.literal('apply_preset'),
      presetId: zLocal.enum(['quick_book', 'signature', 'menu', 'collective']),
      presetVersion: zLocal.literal(1),
      expectedPresentationSignature: zLocal.string().min(1),
    }).strict(),
  ]);

  class StubBookingPageBuilderWriteError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }

  return {
    requireAdmin: vi.fn(),
    getSalonBySlug: vi.fn(),
    getSalonById: vi.fn(),
    logAuditEvent: vi.fn(),
    updateBookingPageDraft: vi.fn(),
    publishBookingPageConfig: vi.fn(),
    revertBookingPageDraft: vi.fn(),
    resolveBookingPageConfig: vi.fn(),
    updateBookingPageContentDraft: vi.fn(),
    publishBookingPageContent: vi.fn(),
    revertBookingPageContentDraft: vi.fn(),
    resolveBookingPageContent: vi.fn(),
    applyBookingPageBuilderOperation: vi.fn(),
    getBookingPageDraftPresentationState: vi.fn(config => ({
      ...config.draft,
      presetBase: config.draftPresetBase ?? null,
    })),
    BookingPageBuilderWriteError: StubBookingPageBuilderWriteError,
    stubDraftPatchSchema: stubDraftPatchSchemaInner,
    stubBuilderOperationSchema: stubBuilderOperationSchemaInner,
    stubContentPatchSchema: stubContentPatchSchemaInner,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin,
}));

vi.mock('@/libs/auditLog', () => ({
  logAuditEvent,
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
  getSalonById,
}));

vi.mock('@/libs/bookingPageBuilder', () => ({
  applyBookingPageBuilderOperation,
}));

vi.mock('@/libs/bookingPageConfig', () => ({
  BookingPageBuilderWriteError,
  bookingPageBuilderOperationSchema: stubBuilderOperationSchema,
  bookingPageDraftPatchSchema: stubDraftPatchSchema,
  updateBookingPageDraft,
  publishBookingPageConfig,
  revertBookingPageDraft,
  resolveBookingPageConfig,
  getBookingPageDraftPresentationState,
}));

vi.mock('@/libs/bookingPageContent', () => ({
  bookingPageContentPatchSchema: stubContentPatchSchema,
  updateBookingPageContentDraft,
  publishBookingPageContent,
  revertBookingPageContentDraft,
  resolveBookingPageContent,
}));

const SALON = { id: 'salon_1', slug: 'salon-a', settings: { some: 'settings' }, publicationStatus: 'published' };

function request(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe('admin booking-page route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonBySlug.mockResolvedValue(SALON);
    getSalonById.mockResolvedValue(SALON);
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    resolveBookingPageConfig.mockReturnValue({ version: 1, draft: { layout: 'quick_book' }, live: { layout: 'quick_book' } });
    resolveBookingPageContent.mockReturnValue({ version: 1, draft: { bio: null }, live: { bio: null } });
    applyBookingPageBuilderOperation.mockReturnValue({
      ok: true,
      patch: {
        sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
        sectionVariants: {},
        hiddenSections: [],
      },
    });
  });

  describe('auth / salon resolution', () => {
    it('400s when salonSlug is missing', async () => {
      const response = await GET(request('https://x.test/api/admin/booking-page'));

      expect(response.status).toBe(400);
    });

    it('404s when the salon does not exist', async () => {
      getSalonBySlug.mockResolvedValue(null);
      const response = await GET(request('https://x.test/api/admin/booking-page?salonSlug=nope'));

      expect(response.status).toBe(404);
    });

    it('propagates the requireAdmin failure response unchanged', async () => {
      const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      requireAdmin.mockResolvedValue({ ok: false, response: denied });

      const response = await GET(request('https://x.test/api/admin/booking-page?salonSlug=salon-a'));

      expect(response.status).toBe(401);
    });
  });

  describe('GET', () => {
    it('returns the resolved config and content for the authorized salon', async () => {
      const response = await GET(request('https://x.test/api/admin/booking-page?salonSlug=salon-a'));
      const body = await response.json();

      expect(requireAdmin).toHaveBeenCalledWith('salon_1');
      expect(resolveBookingPageConfig).toHaveBeenCalledWith(SALON.settings);
      expect(resolveBookingPageContent).toHaveBeenCalledWith(SALON.settings);
      expect(body.config.draft.layout).toBe('quick_book');
      expect(body.content).toBeDefined();
    });

    // Phase A (draft/publish split): the owner Booking Page surface reads
    // this field to decide whether to show its own "publish the salon"
    // affordance — see src/app/[locale]/admin/booking-page/page.tsx and its
    // test file.
    it('includes the salon publicationStatus so the owner surface can offer publishing the salon itself', async () => {
      getSalonBySlug.mockResolvedValue({ ...SALON, publicationStatus: 'draft' });
      const response = await GET(request('https://x.test/api/admin/booking-page?salonSlug=salon-a'));
      const body = await response.json();

      expect(body.salon).toEqual({ publicationStatus: 'draft' });
    });
  });

  describe('PATCH', () => {
    it('400s on an invalid body', async () => {
      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({ config: { layout: 123 } }),
      }));

      expect(response.status).toBe(400);
      expect(updateBookingPageDraft).not.toHaveBeenCalled();
    });

    it('400s when neither config nor content is present', async () => {
      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }));

      expect(response.status).toBe(400);
    });

    it('strictly rejects malformed or unknown builder operations before applying them', async () => {
      for (const builderOperation of [
        { type: 'move_section', sectionId: 'policies', direction: 'sideways' },
        { type: 'reset_all', arbitraryCss: 'body { display: none }' },
        { type: 'inject_markup', html: '<script />' },
      ]) {
        const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
          method: 'PATCH',
          body: JSON.stringify({ builderOperation }),
        }));

        expect(response.status).toBe(400);
      }

      expect(applyBookingPageBuilderOperation).not.toHaveBeenCalled();
      expect(updateBookingPageDraft).not.toHaveBeenCalled();
    });

    it('rejects combining a semantic builder operation with raw config or content writes', async () => {
      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({
          builderOperation: {
            type: 'reset_all',
            expectedPresentationSignature: 'current-signature',
          },
          config: { businessMode: 'team' },
        }),
      }));

      expect(response.status).toBe(400);
      expect(applyBookingPageBuilderOperation).not.toHaveBeenCalled();
      expect(updateBookingPageDraft).not.toHaveBeenCalled();
    });

    it('applies a semantic builder operation to the current draft and persists only its validated patch', async () => {
      const currentConfig = {
        version: 1,
        draft: {
          layout: 'editorial',
          sectionOrder: ['salonProfile', 'hoursLocation', 'policies', 'serviceMenu', 'bookingCta'],
          sectionVariants: {},
          hiddenSections: [],
        },
        live: { layout: 'editorial' },
        draftPresetBase: null,
        livePresetBase: null,
      };
      const operation = {
        type: 'move_section',
        sectionId: 'hoursLocation',
        targetSectionId: 'policies',
        direction: 'down',
      } as const;
      const patch = {
        sectionOrder: ['salonProfile', 'policies', 'hoursLocation', 'serviceMenu', 'bookingCta'],
        sectionVariants: {},
        hiddenSections: [],
      };
      resolveBookingPageConfig.mockReturnValue(currentConfig);
      applyBookingPageBuilderOperation.mockReturnValue({ ok: true, patch });

      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({ builderOperation: operation }),
      }));

      expect(response.status).toBe(200);
      expect(applyBookingPageBuilderOperation).toHaveBeenCalledWith({
        ...currentConfig.draft,
        presetBase: null,
      }, operation);
      expect(updateBookingPageDraft).toHaveBeenCalledTimes(1);
      expect(updateBookingPageDraft).toHaveBeenCalledWith('salon_1', patch, {
        builderOperation: operation,
      });
      expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ builderOperation: 'move_section' }),
      }));
    });

    it('persists one config-only preset operation and records its exact versioned identity', async () => {
      const operation = {
        type: 'apply_preset',
        presetId: 'menu',
        presetVersion: 1,
        expectedPresentationSignature: 'reviewed-signature',
      } as const;
      const patch = {
        layout: 'editorial',
        sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
        sectionVariants: { serviceMenu: 'grouped_categories' },
        hiddenSections: [],
        presetBase: { presetId: 'menu', recipeVersion: 1 },
      } as const;
      applyBookingPageBuilderOperation.mockReturnValue({ ok: true, patch });

      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({ builderOperation: operation }),
      }));

      expect(response.status).toBe(200);
      expect(updateBookingPageDraft).toHaveBeenCalledWith('salon_1', patch, {
        builderOperation: operation,
      });
      expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          builderOperation: 'apply_preset',
          presetId: 'menu',
          presetVersion: 1,
        }),
      }));
    });

    it('returns 409 without writing when the reviewed presentation is already stale', async () => {
      applyBookingPageBuilderOperation.mockReturnValue({
        ok: false,
        code: 'STALE_PRESENTATION',
      });

      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({
          builderOperation: {
            type: 'apply_preset',
            presetId: 'signature',
            presetVersion: 1,
            expectedPresentationSignature: 'stale-signature',
          },
        }),
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Invalid builder operation',
        code: 'STALE_PRESENTATION',
      });
      expect(updateBookingPageDraft).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('returns 409 when the authoritative transactional recheck detects a stale preset', async () => {
      applyBookingPageBuilderOperation.mockReturnValue({
        ok: true,
        patch: { sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'] },
      });
      updateBookingPageDraft.mockRejectedValueOnce(
        new BookingPageBuilderWriteError('STALE_PRESENTATION'),
      );

      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({
          builderOperation: {
            type: 'apply_preset',
            presetId: 'signature',
            presetVersion: 1,
            expectedPresentationSignature: 'reviewed-signature',
          },
        }),
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Invalid builder operation',
        code: 'STALE_PRESENTATION',
      });
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('returns 400 and performs no write when the pure builder rejects an operation', async () => {
      applyBookingPageBuilderOperation.mockReturnValue({
        ok: false,
        code: 'SECTION_NOT_CONFIGURABLE',
      });

      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({
          builderOperation: {
            type: 'set_visibility',
            sectionId: 'salonProfile',
            visible: false,
          },
        }),
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Invalid builder operation',
        code: 'SECTION_NOT_CONFIGURABLE',
      });
      expect(updateBookingPageDraft).not.toHaveBeenCalled();
      expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
    });

    it('applies a config-only patch through updateBookingPageDraft, not the content writer', async () => {
      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({ config: { businessMode: 'team' } }),
      }));

      expect(response.status).toBe(200);
      expect(updateBookingPageDraft).toHaveBeenCalledWith('salon_1', { businessMode: 'team' });
      expect(updateBookingPageContentDraft).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        salonId: 'salon_1',
        action: 'settings_updated',
        entityType: 'booking_page_draft',
      }));
    });

    it('applies a content-only patch through updateBookingPageContentDraft, not the config writer', async () => {
      const response = await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({ content: { bio: 'Hello' } }),
      }));

      expect(response.status).toBe(200);
      expect(updateBookingPageContentDraft).toHaveBeenCalledWith('salon_1', { bio: 'Hello' });
      expect(updateBookingPageDraft).not.toHaveBeenCalled();
    });

    it('a request carrying sectionOrder/hiddenSections is forwarded verbatim — server-side stripping of serviceMenu/bookingCta is `updateBookingPageDraft`\'s job, proven in bookingPageConfig.publishRevert.test.ts', async () => {
      await PATCH(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'PATCH',
        body: JSON.stringify({ config: { hiddenSections: ['serviceMenu', 'bookingCta', 'policies'] } }),
      }));

      expect(updateBookingPageDraft).toHaveBeenCalledWith('salon_1', {
        hiddenSections: ['serviceMenu', 'bookingCta', 'policies'],
      });
    });
  });

  describe('POST', () => {
    it('400s on an invalid action', async () => {
      const response = await POST(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete' }),
      }));

      expect(response.status).toBe(400);
    });

    it('publish calls both publish helpers, never the revert helpers', async () => {
      const response = await POST(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish' }),
      }));

      expect(response.status).toBe(200);
      expect(publishBookingPageConfig).toHaveBeenCalledWith('salon_1');
      expect(publishBookingPageContent).toHaveBeenCalledWith('salon_1');
      expect(revertBookingPageDraft).not.toHaveBeenCalled();
      expect(revertBookingPageContentDraft).not.toHaveBeenCalled();
    });

    it('revert calls both revert helpers, never the publish helpers', async () => {
      const response = await POST(request('https://x.test/api/admin/booking-page?salonSlug=salon-a', {
        method: 'POST',
        body: JSON.stringify({ action: 'revert' }),
      }));

      expect(response.status).toBe(200);
      expect(revertBookingPageDraft).toHaveBeenCalledWith('salon_1');
      expect(revertBookingPageContentDraft).toHaveBeenCalledWith('salon_1');
      expect(publishBookingPageConfig).not.toHaveBeenCalled();
      expect(publishBookingPageContent).not.toHaveBeenCalled();
    });
  });
});
