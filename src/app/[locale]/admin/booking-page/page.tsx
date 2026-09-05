'use client';

/**
 * Owner Booking Page surface (Luster UI/UX plan rev 3, PR 5).
 *
 * The guarded owner builder over the PR 2 `bookingPage` config: layout and
 * business-mode pickers, bounded section presentation operations, content
 * fields, a real-renderer draft preview, and Publish/Revert on the draft/live
 * pair. It is deliberately not a drag-and-drop or free-form page builder:
 * every presentation action is a typed operation that the server validates
 * against the canonical section contract.
 *
 * `salonProfile`, `serviceMenu`, and `bookingCta` are never rendered as
 * toggle controls here — see OPTIONAL_SECTIONS below, which deliberately
 * omits all three. Even if a malicious request bypassed this UI,
 * `@/libs/bookingPageConfig`'s `validateSectionOrder` (invoked by the API
 * route on every write, and again on every read) strips them from
 * `hiddenSections` server-side regardless.
 */

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BookingPageAppearance } from '@/components/admin/BookingPageAppearance';
import { BookingPageBuilder } from '@/components/admin/BookingPageBuilder';
import {
  BookingPagePresetPicker,
  type BookingPagePresetPickerStatus,
} from '@/components/admin/BookingPagePresetPicker';
import {
  disableBookingPagePreviewFrameInteraction,
  normalizeBookingPagePreviewFrame,
} from '@/components/admin/bookingPagePreviewFrame';
import { QuickBookProfileVisibilityCard } from '@/components/admin/QuickBookProfileVisibilityCard';
import type { BookingPageBuilderOperation } from '@/libs/bookingPageBuilder';
import type {
  BookingPageConfig,
  BusinessMode,
  SectionId,
  StylePack,
} from '@/libs/bookingPageConfig';
import type {
  BookingPageContent,
  LocationDisplayMode,
} from '@/libs/bookingPageContent';
import { SECTION_PRESENTATION_SECTION_IDS } from '@/libs/sectionPresentation';
import { getI18nPath } from '@/utils/Helpers';

// =============================================================================
// Client-safe option lists.
//
// `@/libs/bookingPageConfig` and `@/libs/bookingPageContent` both import
// `@/libs/DB` (`import 'server-only'`), so only *type* imports from them are
// safe in this 'use client' file — importing any runtime value (even an
// unrelated constant) would drag that server-only module graph into this
// component's bundle. `BookServiceClient.tsx` documents and follows the same
// rule for `QUICK_BOOK_SECTION_ORDER_FALLBACK`; these lists are this route's
// equivalent same-shape duplicates of the server enums.
// =============================================================================

/** Mirrors `REGISTERED_STYLE_PACKS`. Only `default` is implemented today (Rev 3 plan PR 20 adds the rest). */
const STYLE_PACK_OPTIONS: Array<{ id: StylePack; label: string; implemented: boolean }> = [
  { id: 'default', label: 'Default', implemented: true },
];

const BUSINESS_MODE_OPTIONS: Array<{ id: BusinessMode; label: string; description: string }> = [
  { id: 'solo', label: 'Solo', description: 'One tech — you.' },
  { id: 'team', label: 'Team', description: 'Multiple techs on your calendar.' },
];

const LOCATION_DISPLAY_MODE_OPTIONS: Array<{ id: LocationDisplayMode; label: string }> = [
  { id: 'full_address', label: 'Full address' },
  { id: 'city_only', label: 'City only' },
];

// =============================================================================
// Fetch helpers
// =============================================================================

type BookingPageApiResponse = {
  config: BookingPageConfig;
  content: BookingPageContent;
  /**
   * Phase A (draft/publish split). Present on every response from
   * `/api/admin/booking-page` — read here only to decide whether to show
   * the "publish the salon" affordance below (see `SalonPublishBanner`).
   * Unrelated to `config.draft`/`config.live`: this is the salon row's own
   * `publicationStatus`, not the booking-page config draft/live pair.
   */
  salon: { publicationStatus: string };
};

const EDITABLE_CONTENT_FIELDS = ['bio', 'specialtyLine', 'heroImageUrl'] as const;

type EditableContentField = typeof EDITABLE_CONTENT_FIELDS[number];

type BookingPageRequestIdentity = {
  requestGeneration: number;
  savedEditGenerations: Partial<Record<EditableContentField, number>>;
};

function contentDraftValue(
  content: BookingPageContent,
  field: EditableContentField,
): string {
  return content.draft[field] ?? '';
}

async function fetchBookingPageState(salonSlug: string): Promise<BookingPageApiResponse> {
  const response = await fetch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(salonSlug)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load booking page settings (${response.status})`);
  }
  return response.json();
}

async function patchBookingPage(
  salonSlug: string,
  body: {
    config?: Record<string, unknown>;
    content?: Record<string, unknown>;
    builderOperation?: BookingPageBuilderOperation;
  },
): Promise<BookingPageApiResponse> {
  const response = await fetch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(salonSlug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BookingPageRequestError(
      response.status,
      typeof payload?.code === 'string' ? payload.code : null,
    );
  }
  return payload;
}

class BookingPageRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Failed to save (${status})`);
    this.name = 'BookingPageRequestError';
  }
}

async function postBookingPageAction(
  salonSlug: string,
  action: 'publish' | 'revert',
): Promise<BookingPageApiResponse> {
  const response = await fetch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(salonSlug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    throw new Error(`Failed to ${action} (${response.status})`);
  }
  return response.json();
}

/**
 * Phase A (draft/publish split). A DIFFERENT endpoint and a DIFFERENT
 * resource than `postBookingPageAction` above: this flips the salon row
 * itself from `publicationStatus: 'draft'` to `'published'` — making the
 * booking page publicly reachable for the first time and permanently
 * locking the slug. `postBookingPageAction('publish')` only ever moves the
 * booking-page config/content draft onto the already-public live salon; it
 * never touches `publicationStatus`. Reusing that action's name or endpoint
 * for this would silently conflate the two — see `SalonPublishBanner`'s
 * copy, which is deliberately worded to keep them apart for the owner too.
 */
async function publishSalon(salonSlug: string): Promise<{ publicationStatus: string }> {
  const response = await fetch(`/api/admin/salon/publish?salonSlug=${encodeURIComponent(salonSlug)}`, {
    method: 'POST',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Failed to publish salon (${response.status})`);
  }
  return payload.data;
}

// =============================================================================
// Small UI primitives
// =============================================================================

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Phase A (draft/publish split) — the persistent, owner-reachable way to
 * take a salon from draft to published. Rendered ONLY while
 * `publicationStatus !== 'published'`; once the salon publishes it
 * disappears entirely (this is deliberately not a place to un-publish —
 * that is a separate, not-yet-built product decision).
 *
 * Copy is written to be unmistakably distinct from the plain "Publish"
 * button further down this page, which only pushes booking-page config
 * changes from draft to live on an ALREADY-public salon. This banner is the
 * one and only control that makes the salon itself publicly reachable and
 * permanently locks the slug — it never gets confused with the config
 * publish/revert pair below because it never uses the bare word "Publish"
 * alone: every label here says "salon" or "booking page public" explicitly.
 */
function SalonPublishBanner({
  status,
  onPublish,
}: {
  status: 'idle' | 'publishing' | 'error';
  onPublish: () => void;
}) {
  return (
    <div
      data-testid="salon-publish-banner"
      className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Private draft</p>
      <h2 className="mt-1 text-lg font-semibold">Your booking page isn't public yet</h2>
      <p className="mt-2 text-sm text-amber-900">
        Only you can see this booking page right now. Publishing your salon makes it publicly
        reachable for the first time and permanently locks your link — this is different from the
        plain "Publish" button further down, which only pushes booking-page layout/content changes
        once your salon is already public.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="salon-publish-button"
          disabled={status === 'publishing'}
          onClick={onPublish}
          className="rounded-full bg-amber-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-50"
        >
          {status === 'publishing' ? 'Publishing your salon…' : 'Publish my salon (locks my link)'}
        </button>
        {status === 'error' && (
          <span role="alert" className="text-sm text-red-800">Publishing failed. Please try again.</span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function BookingPageOwnerSurface() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const requestedPanel = searchParams.get('panel');
  const panel = ['layouts', 'appearance', 'information', 'text', 'policies', 'publish'].includes(requestedPanel ?? '') ? requestedPanel : null;
  const show = (name: string) => !panel || panel === name;
  const locale = String(params?.locale || 'en');
  const [salonSlug, setSalonSlug] = useState(searchParams.get('salon') || '');

  const [config, setConfig] = useState<BookingPageConfig | null>(null);
  const [content, setContent] = useState<BookingPageContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatusState]
    = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'stale' | 'error'>('idle');
  const [presentationPending, setPresentationPending] = useState(false);
  const [presetStatus, setPresetStatus]
    = useState<BookingPagePresetPickerStatus>('idle');
  const [previewRevision, setPreviewRevision] = useState(0);
  const [previewAdmission, setPreviewAdmission] = useState<{
    revision: number;
    reorderableSectionOrder: SectionId[];
    sectionIds: Set<SectionId>;
  } | null>(null);
  const [completedMoveRevision, setCompletedMoveRevision] = useState<number | null>(null);
  const [actionStatus, setActionStatus] = useState<'idle' | 'publishing' | 'reverting'>('idle');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Phase A (draft/publish split): the salon's OWN publicationStatus — not
  // the booking-page config draft/live pair above. Drives whether
  // `SalonPublishBanner` renders at all; null while unknown/loading so the
  // banner never flashes on before the real value is in.
  const [salonPublicationStatus, setSalonPublicationStatus] = useState<string | null>(null);
  const [salonPublishStatus, setSalonPublishStatus] = useState<'idle' | 'publishing' | 'error'>('idle');

  // Bio/specialty/heroImage text fields save on blur, not on every keystroke.
  const [bioDraft, setBioDraft] = useState('');
  const [specialtyDraft, setSpecialtyDraft] = useState('');
  const [heroImageDraft, setHeroImageDraft] = useState('');

  const presentationWritePendingRef = useRef(false);
  const ordinaryWriteGenerationRef = useRef(0);
  const latestOrdinaryWriteByFieldRef = useRef(new Map<string, number>());
  const failedOrdinaryWriteFieldsRef = useRef(new Set<string>());
  const pendingOrdinaryWritesRef = useRef(new Set<Promise<boolean>>());
  const ordinaryWriteTailRef = useRef<Promise<void>>(Promise.resolve());
  const bookingPageRequestGenerationRef = useRef(0);
  const contentEditGenerationRef = useRef(0);
  const contentEditGenerationByFieldRef = useRef<Record<EditableContentField, number>>({
    bio: 0,
    specialtyLine: 0,
    heroImageUrl: 0,
  });
  const savedContentEditGenerationByFieldRef = useRef<Record<EditableContentField, number>>({
    bio: 0,
    specialtyLine: 0,
    heroImageUrl: 0,
  });
  const hasUnsavedContentTextEdits = useCallback(() => EDITABLE_CONTENT_FIELDS.some(field => (
    contentEditGenerationByFieldRef.current[field]
    > savedContentEditGenerationByFieldRef.current[field]
  )), []);
  const setTruthfulSaveStatus = useCallback((
    requestedStatus: 'idle' | 'dirty' | 'saving' | 'saved' | 'stale' | 'error',
  ) => {
    const status = (requestedStatus === 'idle' || requestedStatus === 'saved')
      && hasUnsavedContentTextEdits()
      ? 'dirty'
      : requestedStatus;
    setSaveStatusState(status);
  }, [hasUnsavedContentTextEdits]);
  const previewRevisionRef = useRef(previewRevision);
  previewRevisionRef.current = previewRevision;
  const refreshPreview = useCallback((preserveAdmission = false) => {
    setCompletedMoveRevision(null);
    // Reordering changes canonical order, never Stage 2 admission. Preserve
    // the last renderer-attested set for that one refresh so the moved row's
    // focused controls remain mounted. Every operation that can change
    // admission still fails closed until the replacement iframe reports its
    // current public surfaces.
    if (!preserveAdmission) {
      setPreviewAdmission(null);
    }
    const nextRevision = previewRevisionRef.current + 1;
    previewRevisionRef.current = nextRevision;
    setPreviewRevision(nextRevision);
    return nextRevision;
  }, []);

  /**
   * Give every request returning the complete booking-page resource an
   * identity at the moment it starts. Ordinary writes are still serialized
   * below; this additional boundary prevents any older, unexpectedly late
   * response from replacing a state returned by a newer request.
   */
  const requestBookingPageState = useCallback(async (
    request: () => Promise<BookingPageApiResponse>,
    savedEditGenerations: Partial<Record<EditableContentField, number>> = {},
  ): Promise<{ state: BookingPageApiResponse; identity: BookingPageRequestIdentity }> => {
    const identity: BookingPageRequestIdentity = {
      requestGeneration: ++bookingPageRequestGenerationRef.current,
      savedEditGenerations: { ...savedEditGenerations },
    };
    const state = await request();
    return { state, identity };
  }, []);

  /**
   * The only place a complete API response enters owner-surface state.
   * Config, content, and salon metadata always move together. Controlled
   * text inputs follow the canonical content unless their local edit
   * generation proves they contain a newer, not-yet-saved owner edit.
   */
  const adoptBookingPageState = useCallback((
    state: BookingPageApiResponse,
    identity: BookingPageRequestIdentity,
    {
      discardLocalTextEdits = false,
      refresh = true,
      preservePreviewAdmission = false,
    }: {
      discardLocalTextEdits?: boolean;
      refresh?: boolean;
      preservePreviewAdmission?: boolean;
    } = {},
  ): { previewRevision: number | null } | null => {
    if (identity.requestGeneration !== bookingPageRequestGenerationRef.current) {
      return null;
    }

    for (const field of EDITABLE_CONTENT_FIELDS) {
      const savedGeneration = identity.savedEditGenerations[field];
      if (savedGeneration !== undefined) {
        savedContentEditGenerationByFieldRef.current[field] = Math.max(
          savedContentEditGenerationByFieldRef.current[field],
          savedGeneration,
        );
      }
    }

    setConfig(state.config);
    setContent(state.content);
    // Publishing a salon is irreversible on this surface. A complete booking
    // response may have started before that independent resource was
    // published, so its older salon snapshot must never resurrect the draft
    // banner after this client has observed `published`.
    setSalonPublicationStatus(currentStatus => (
      currentStatus === 'published' ? currentStatus : state.salon.publicationStatus
    ));

    const adoptTextDraft = (
      field: EditableContentField,
      setter: (value: string) => void,
    ) => {
      const currentEditGeneration = contentEditGenerationByFieldRef.current[field];
      if (discardLocalTextEdits) {
        savedContentEditGenerationByFieldRef.current[field] = currentEditGeneration;
      } else if (
        currentEditGeneration > savedContentEditGenerationByFieldRef.current[field]
      ) {
        return;
      }
      setter(contentDraftValue(state.content, field));
    };

    adoptTextDraft('bio', setBioDraft);
    adoptTextDraft('specialtyLine', setSpecialtyDraft);
    adoptTextDraft('heroImageUrl', setHeroImageDraft);

    return {
      previewRevision: refresh ? refreshPreview(preservePreviewAdmission) : null,
    };
  }, [refreshPreview]);

  const updateContentTextDraft = useCallback((
    field: EditableContentField,
    value: string,
    setter: (nextValue: string) => void,
  ) => {
    contentEditGenerationByFieldRef.current[field] = ++contentEditGenerationRef.current;
    setter(value);
    setTruthfulSaveStatus(
      failedOrdinaryWriteFieldsRef.current.size > 0 ? 'error' : 'dirty',
    );
  }, [setTruthfulSaveStatus]);

  const trackOrdinaryWrite = useCallback(async (
    fields: readonly string[],
    write: () => Promise<void>,
  ): Promise<boolean> => {
    const generation = ++ordinaryWriteGenerationRef.current;
    for (const field of fields) {
      latestOrdinaryWriteByFieldRef.current.set(field, generation);
    }

    const pendingWrite = ordinaryWriteTailRef.current.then(write).then(
      () => true,
      () => false,
    );
    ordinaryWriteTailRef.current = pendingWrite.then(() => undefined);
    pendingOrdinaryWritesRef.current.add(pendingWrite);
    try {
      const succeeded = await pendingWrite;
      for (const field of fields) {
        if (latestOrdinaryWriteByFieldRef.current.get(field) !== generation) {
          continue;
        }
        if (succeeded) {
          failedOrdinaryWriteFieldsRef.current.delete(field);
        } else {
          failedOrdinaryWriteFieldsRef.current.add(field);
        }
      }
      return succeeded;
    } finally {
      pendingOrdinaryWritesRef.current.delete(pendingWrite);
      if (failedOrdinaryWriteFieldsRef.current.size > 0) {
        setTruthfulSaveStatus('error');
      } else if (pendingOrdinaryWritesRef.current.size === 0) {
        setTruthfulSaveStatus('saved');
      }
    }
  }, [setTruthfulSaveStatus]);

  const settleOrdinaryWrites = useCallback(async (): Promise<boolean> => {
    while (pendingOrdinaryWritesRef.current.size > 0) {
      await Promise.all([...pendingOrdinaryWritesRef.current]);
    }

    return failedOrdinaryWriteFieldsRef.current.size === 0;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      let slug = salonSlug;
      if (!slug) {
        const me = await fetch('/api/admin/auth/me', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
        if (cancelled) {
          return;
        }
        slug = me?.user?.salons?.[0]?.slug || '';
        setSalonSlug(slug);
      }
      if (!slug) {
        if (!cancelled) {
          setLoading(false);
          setError('No salon found for this account.');
        }
        return;
      }

      try {
        const response = await requestBookingPageState(
          () => fetchBookingPageState(slug),
        );
        if (!cancelled) {
          adoptBookingPageState(response.state, response.identity, { refresh: false });
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load booking page settings.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptBookingPageState, requestBookingPageState]);

  const saveConfigPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!salonSlug || presentationWritePendingRef.current) {
      return;
    }
    setCompletedMoveRevision(null);
    setTruthfulSaveStatus('saving');
    await trackOrdinaryWrite(Object.keys(patch).map(field => `config:${field}`), async () => {
      const response = await requestBookingPageState(
        () => patchBookingPage(salonSlug, { config: patch }),
      );
      adoptBookingPageState(response.state, response.identity);
    });
  }, [adoptBookingPageState, requestBookingPageState, salonSlug, setTruthfulSaveStatus, trackOrdinaryWrite]);

  const saveContentPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!salonSlug || presentationWritePendingRef.current) {
      return;
    }
    setCompletedMoveRevision(null);
    setTruthfulSaveStatus('saving');
    const savedEditGenerations: Partial<Record<EditableContentField, number>> = {};
    for (const field of EDITABLE_CONTENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        savedEditGenerations[field] = contentEditGenerationByFieldRef.current[field];
      }
    }
    await trackOrdinaryWrite(Object.keys(patch).map(field => `content:${field}`), async () => {
      const response = await requestBookingPageState(
        () => patchBookingPage(salonSlug, { content: patch }),
        savedEditGenerations,
      );
      adoptBookingPageState(response.state, response.identity);
    });
  }, [adoptBookingPageState, requestBookingPageState, salonSlug, setTruthfulSaveStatus, trackOrdinaryWrite]);

  const handleStylePackSelect = (stylePack: StylePack) => {
    const option = STYLE_PACK_OPTIONS.find(p => p.id === stylePack);
    if (!option?.implemented) {
      return;
    }
    void saveConfigPatch({ stylePack });
  };

  const handleBusinessModeSelect = (businessMode: BusinessMode) => {
    void saveConfigPatch({ businessMode });
  };

  const handleLocationDisplayModeSelect = (locationDisplayMode: LocationDisplayMode) => {
    void saveContentPatch({ locationDisplayMode });
  };

  const handleBuilderOperation = useCallback(async (operation: BookingPageBuilderOperation) => {
    if (!salonSlug || presentationWritePendingRef.current) {
      return;
    }
    if (operation.type === 'reset_all' && !window.confirm(
      'Reset page customization to its starting design? Your salon content will not be deleted.',
    )) {
      return;
    }

    presentationWritePendingRef.current = true;
    setCompletedMoveRevision(null);
    setPresentationPending(true);
    setPresetStatus('idle');
    setTruthfulSaveStatus('saving');
    try {
      if (!await settleOrdinaryWrites()) {
        if (operation.type === 'apply_preset') {
          setPresetStatus('error');
        }
        setTruthfulSaveStatus('error');
        return;
      }
      const response = await requestBookingPageState(
        () => patchBookingPage(salonSlug, { builderOperation: operation }),
      );
      const adoption = adoptBookingPageState(response.state, response.identity, {
        preservePreviewAdmission: operation.type === 'move_section',
      });
      if (adoption) {
        setTruthfulSaveStatus('saved');
        if (operation.type === 'apply_preset') {
          setPresetStatus('success');
        }
        if (operation.type === 'move_section' && adoption.previewRevision !== null) {
          setCompletedMoveRevision(adoption.previewRevision);
        }
      }
    } catch (operationError) {
      const isSignatureGuardedOperation = operation.type === 'apply_preset'
        || operation.type === 'reset_all';
      if (isSignatureGuardedOperation
        && operationError instanceof BookingPageRequestError
        && operationError.status === 409
        && operationError.code === 'STALE_PRESENTATION') {
        try {
          const response = await requestBookingPageState(
            () => fetchBookingPageState(salonSlug),
          );
          const adoption = adoptBookingPageState(response.state, response.identity);
          if (adoption) {
            if (operation.type === 'apply_preset') {
              setPresetStatus('stale');
              setTruthfulSaveStatus('idle');
            } else {
              setTruthfulSaveStatus('stale');
            }
          }
          return;
        } catch {
          if (operation.type === 'apply_preset') {
            setPresetStatus('error');
          }
        }
      } else if (operation.type === 'apply_preset') {
        setPresetStatus('error');
      }
      setTruthfulSaveStatus('error');
    } finally {
      presentationWritePendingRef.current = false;
      setPresentationPending(false);
    }
  }, [adoptBookingPageState, requestBookingPageState, salonSlug, setTruthfulSaveStatus, settleOrdinaryWrites]);

  const handlePreviewLoad = useCallback((
    frame: HTMLIFrameElement,
    revision: number,
    expectedSrc: string,
  ) => {
    // The same iframe element can navigate from a previously attested draft
    // to a partial, login, or error document. Re-lock it before every load
    // decision so no failed or stale path inherits pointer access.
    disableBookingPagePreviewFrameInteraction(frame);
    if (revision !== previewRevisionRef.current) {
      return;
    }
    if (!normalizeBookingPagePreviewFrame({ expectedSrc, frame })) {
      return;
    }
    const previewDocument = frame.contentDocument;
    const completedRenderer = previewDocument?.querySelector(
      '[data-builder-reorderable-section-order]',
    );
    if (!previewDocument || !completedRenderer) {
      return;
    }
    const knownIds = new Set<string>(SECTION_PRESENTATION_SECTION_IDS);
    const rendered = new Set<SectionId>();
    for (const element of previewDocument.querySelectorAll<HTMLElement>('[data-public-surface]')) {
      const sectionId = element.dataset.publicSurface;
      if (sectionId && knownIds.has(sectionId) && !rendered.has(sectionId as SectionId)) {
        const knownSectionId = sectionId as SectionId;
        rendered.add(knownSectionId);
      }
    }
    const attestedOrderValue = completedRenderer.getAttribute(
      'data-builder-reorderable-section-order',
    );
    if (attestedOrderValue === null) {
      return;
    }
    const reorderableSectionOrder: SectionId[] = [];
    const attestedIds = new Set<SectionId>();
    for (const rawSectionId of attestedOrderValue.split(/\s+/).filter(Boolean)) {
      if (!knownIds.has(rawSectionId)
        || attestedIds.has(rawSectionId as SectionId)
        || !rendered.has(rawSectionId as SectionId)) {
        return;
      }
      const sectionId = rawSectionId as SectionId;
      attestedIds.add(sectionId);
      reorderableSectionOrder.push(sectionId);
    }
    setPreviewAdmission({ revision, reorderableSectionOrder, sectionIds: rendered });
  }, []);

  const handlePublish = async () => {
    if (!salonSlug || presentationWritePendingRef.current) {
      return;
    }
    presentationWritePendingRef.current = true;
    setPresentationPending(true);
    setPresetStatus('idle');
    setCompletedMoveRevision(null);
    setActionStatus('publishing');
    setActionMessage(null);
    try {
      if (!await settleOrdinaryWrites()) {
        setActionMessage('Publish paused because a draft field could not be saved. Retry the field, then publish again.');
        return;
      }
      const response = await requestBookingPageState(
        () => postBookingPageAction(salonSlug, 'publish'),
      );
      if (adoptBookingPageState(response.state, response.identity)) {
        setTruthfulSaveStatus('saved');
        setActionMessage('Published. Your live booking page now matches your draft.');
      }
    } catch {
      setActionMessage('Publish failed. Please try again.');
    } finally {
      setActionStatus('idle');
      presentationWritePendingRef.current = false;
      setPresentationPending(false);
    }
  };

  const handleRevert = async () => {
    if (!salonSlug || presentationWritePendingRef.current) {
      return;
    }

    const confirmed = window.confirm('Discard unpublished changes and reset the draft to match what is live?');
    if (!confirmed) {
      return;
    }
    presentationWritePendingRef.current = true;
    setPresentationPending(true);
    setPresetStatus('idle');
    setCompletedMoveRevision(null);
    setActionStatus('reverting');
    setActionMessage(null);
    try {
      // Drain every queued field request so none can land after the owner has
      // confirmed the discard. A failed field does not block Revert: the
      // explicit purpose of this action is to replace unsaved draft input.
      await settleOrdinaryWrites();
      const response = await requestBookingPageState(
        () => postBookingPageAction(salonSlug, 'revert'),
      );
      failedOrdinaryWriteFieldsRef.current.clear();
      latestOrdinaryWriteByFieldRef.current.clear();
      if (adoptBookingPageState(response.state, response.identity, {
        discardLocalTextEdits: true,
      })) {
        setTruthfulSaveStatus('saved');
        setActionMessage('Reverted. Your draft now matches what is live.');
      }
    } catch {
      setActionMessage('Revert failed. Please try again.');
    } finally {
      setActionStatus('idle');
      presentationWritePendingRef.current = false;
      setPresentationPending(false);
    }
  };

  /**
   * Phase A (draft/publish split). Deliberately independent of
   * `handlePublish`/`handleRevert` above — different endpoint, different
   * resource (`salon.publicationStatus`, not `bookingPage` config), and its
   * own status/error state so a booking-page config save in flight never
   * disables this button (and vice versa).
   */
  const handlePublishSalon = async () => {
    if (!salonSlug) {
      return;
    }
    setSalonPublishStatus('publishing');
    try {
      const data = await publishSalon(salonSlug);
      setSalonPublicationStatus(data.publicationStatus);
      refreshPreview();
      setSalonPublishStatus('idle');
    } catch {
      setSalonPublishStatus('error');
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8F3F0]">
        <div className="size-8 animate-spin rounded-full border-2 border-rose-200 border-t-rose-700" />
      </main>
    );
  }

  if (error || !config || !content) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8F3F0] px-6 text-center">
        <p className="text-sm text-stone-600">{error ?? 'Something went wrong.'}</p>
      </main>
    );
  }

  const draft = config.draft;
  // Owner preview stays on a dedicated dashboard-origin route. That route
  // establishes Clerk context and performs an exact salon ownership /
  // impersonation check before invoking the same canonical booking renderer.
  // Public booking URLs may live on a custom host where the Owner's session is
  // unavailable, and must never be treated as a privileged DRAFT capability.
  const previewPath = salonSlug
    ? getI18nPath(`/admin/booking-page/preview/${encodeURIComponent(salonSlug)}`, locale)
    : null;
  const previewFrameSrc = previewPath
    ? `${previewPath}?builderPreview=${previewRevision}`
    : null;

  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 pb-16 pt-8 text-stone-900">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => router.push(`/${locale}/admin/website${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)}
          className="inline-flex items-center gap-2 text-sm text-stone-600"
        >
          <ArrowLeft size={16} />
          Booking Page
        </button>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Booking Page</p>
            <h1 className="mt-2 text-3xl font-semibold">{({ layouts: 'Layouts', appearance: 'Style & Colours', information: 'Your Information', text: 'About & Website Text', policies: 'Policies & Booking Rules', publish: 'Review & Publish' } as Record<string, string>)[panel ?? ''] ?? 'Layout, style and content'}</h1>
            <p className="mt-2 text-stone-600">Changes here save to your draft. Nothing goes live until you publish.</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <a
              href={previewPath ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!previewPath}
              data-testid="booking-page-preview-link"
              className={`inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors ${
                previewPath ? 'hover:bg-rose-100' : 'pointer-events-none opacity-50'
              }`}
            >
              Preview
              <ExternalLink size={14} />
            </a>
            <span className="text-[11px] text-stone-400">Shows your draft — only you can see it</span>
          </div>
        </div>

        {salonPublicationStatus !== null && salonPublicationStatus !== 'published' && (
          <SalonPublishBanner status={salonPublishStatus} onPublish={() => void handlePublishSalon()} />
        )}

        <div className="mt-3 h-5 text-xs text-stone-500" role="status" aria-live="polite">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'dirty' && 'Unsaved changes'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'stale' && 'Your draft changed elsewhere. The latest presentation is loaded; review it before trying again.'}
          {saveStatus === 'error' && 'Could not save — please retry.'}
        </div>

        <div className="mt-6 space-y-6">
          {!panel && (
            <SectionCard
              title="Live preview"
              description="This is your real draft booking page. Saved presentation changes refresh here before anything is published."
            >
              <div
                data-booking-page-preview-scroll
                className="h-[620px] overflow-hidden overscroll-contain rounded-2xl border border-stone-200 bg-white"
              >
                {previewFrameSrc
                  ? (
                      <iframe
                        key={previewRevision}
                        title="Live booking page preview"
                        src={previewFrameSrc}
                        aria-hidden="true"
                        inert
                        sandbox="allow-same-origin"
                        tabIndex={-1}
                        onLoad={event => handlePreviewLoad(
                          event.currentTarget,
                          previewRevision,
                          previewFrameSrc,
                        )}
                        className="pointer-events-none block size-full bg-white"
                      />
                    )
                  : (
                      <p className="p-4 text-sm text-stone-500">Preview is unavailable until a salon is selected.</p>
                    )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-stone-500">
                  View-only preview using your real salon content and the same booking renderer clients see.
                  Use Open preview for the fully interactive page.
                </p>
                <button
                  type="button"
                  data-testid="booking-page-preview-refresh"
                  onClick={() => refreshPreview()}
                  className="min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Refresh preview
                </button>
              </div>
            </SectionCard>
          )}

          {show('information') && (
            <QuickBookProfileVisibilityCard
              disabled={presentationPending}
              draft={draft}
              onConfigPatch={patch => void saveConfigPatch(patch)}
            />
          )}

          {(panel === 'layouts' || panel === 'appearance') && <BookingPageAppearance disabled={presentationPending} draft={draft} mode={panel} onChange={patch => void saveConfigPatch(patch)} />}

          {panel === 'information' && (
            <SectionCard title="Edit saved business information" description="Visibility above changes your website draft. Business settings below use the existing shared editors and may affect live bookings immediately.">
              <a className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings&view=location`}>Location, address privacy & arrival details</a>
              <a className="mt-3 flex min-h-11 items-center rounded-xl border border-stone-300 px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings`}>Open business settings</a>
            </SectionCard>
          )}

          {panel === 'policies' && (
            <>
              <SectionCard title="Customer-facing policies" description="Review the policy wording and acknowledgment clients see. Policy wording does not enable automatic charges.">
                <a className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings&view=booking-policy`}>Edit booking policy</a>
              </SectionCard>
              <SectionCard title="Operational booking settings" description="These settings affect booking logic directly. Saving here is separate from publishing website appearance.">
                <a className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings&view=booking`}>Booking rules & availability</a>
                <a className="mt-3 flex min-h-11 items-center rounded-xl border border-stone-300 px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings&view=payments`}>Payments & deposits</a>
              </SectionCard>
            </>
          )}

          {!panel && (
            <BookingPagePresetPicker
              draft={{ ...draft, presetBase: config.draftPresetBase }}
              pending={presentationPending}
              status={presetStatus}
              previewBaseUrl={previewFrameSrc}
              onOperation={operation => void handleBuilderOperation(operation)}
            />
          )}

          {!panel && (
            <SectionCard title="Style pack" description="Only Default is available today.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {STYLE_PACK_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!option.implemented || presentationPending}
                    data-testid={`style-pack-option-${option.id}`}
                    aria-pressed={draft.stylePack === option.id}
                    onClick={() => handleStylePackSelect(option.id)}
                    className={`rounded-2xl border p-3 text-left text-sm font-medium transition-colors ${
                      draft.stylePack === option.id
                        ? 'border-rose-600 bg-rose-50 text-rose-800'
                        : 'border-stone-200 bg-white text-stone-700'
                    } ${!option.implemented ? 'cursor-not-allowed opacity-50' : 'hover:border-rose-300'}`}
                  >
                    {option.label}
                  </button>
                ))}
                <span className="col-span-full text-[11px] text-stone-400">More style packs coming soon.</span>
              </div>
            </SectionCard>
          )}

          {!panel && (
            <SectionCard title="Business mode">
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS_MODE_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={presentationPending}
                    data-testid={`business-mode-option-${option.id}`}
                    aria-pressed={draft.businessMode === option.id}
                    onClick={() => handleBusinessModeSelect(option.id)}
                    className={`rounded-2xl border p-3 text-left text-sm font-medium transition-colors ${
                      draft.businessMode === option.id
                        ? 'border-rose-600 bg-rose-50 text-rose-800'
                        : 'border-stone-200 bg-white text-stone-700 hover:border-rose-300'
                    }`}
                  >
                    {option.label}
                    <span className="mt-1 block text-[11px] font-normal text-stone-400">{option.description}</span>
                  </button>
                ))}
              </div>
            </SectionCard>
          )}

          {!panel && (
            <BookingPageBuilder
              draft={draft}
              completedMoveRevision={completedMoveRevision}
              pending={presentationPending}
              presetBase={config.draftPresetBase}
              previewAdmissionRevision={previewAdmission?.revision ?? null}
              previewRequestRevision={previewRevision}
              previewedSectionIds={previewAdmission?.sectionIds ?? null}
              previewedReorderableSectionOrder={previewAdmission?.reorderableSectionOrder ?? null}
              onOperation={operation => void handleBuilderOperation(operation)}
            />
          )}

          {show('text') && (
            <SectionCard title="About & Website Text" description="Edit the introduction and bio used by your customer site.">
              <div className="space-y-4">
                {!panel && (
                  <label className="block">
                    <span className="text-sm font-medium text-stone-800">Hero / profile image URL</span>
                    <input
                      type="url"
                      data-testid="content-hero-image-url"
                      disabled={presentationPending}
                      value={heroImageDraft}
                      onChange={event => updateContentTextDraft(
                        'heroImageUrl',
                        event.target.value,
                        setHeroImageDraft,
                      )}
                      onBlur={() => void saveContentPatch({ heroImageUrl: heroImageDraft.trim() === '' ? null : heroImageDraft.trim() })}
                      placeholder="https://…"
                      className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                    />
                  </label>
                )}

                <label className="block">
                  <span className="text-sm font-medium text-stone-800">Specialty line</span>
                  <input
                    type="text"
                    data-testid="content-specialty-line"
                    disabled={presentationPending}
                    value={specialtyDraft}
                    onChange={event => updateContentTextDraft(
                      'specialtyLine',
                      event.target.value,
                      setSpecialtyDraft,
                    )}
                    onBlur={() => void saveContentPatch({ specialtyLine: specialtyDraft.trim() === '' ? null : specialtyDraft })}
                    placeholder="Russian manicure & BIAB · Toronto"
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-stone-800">Bio</span>
                  <textarea
                    data-testid="content-bio"
                    disabled={presentationPending}
                    value={bioDraft}
                    onChange={event => updateContentTextDraft(
                      'bio',
                      event.target.value,
                      setBioDraft,
                    )}
                    onBlur={() => void saveContentPatch({ bio: bioDraft.trim() === '' ? null : bioDraft })}
                    rows={4}
                    placeholder="Tell clients about your studio…"
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                  />
                </label>

                {!panel && (
                  <div>
                    <span className="text-sm font-medium text-stone-800">Location shown as</span>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {LOCATION_DISPLAY_MODE_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          disabled={presentationPending}
                          data-testid={`location-display-mode-${option.id}`}
                          aria-pressed={content.draft.locationDisplayMode === option.id}
                          onClick={() => handleLocationDisplayModeSelect(option.id)}
                          className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                            content.draft.locationDisplayMode === option.id
                              ? 'border-rose-600 bg-rose-50 text-rose-800'
                              : 'border-stone-200 bg-white text-stone-700 hover:border-rose-300'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {content.draft.locationDisplayMode === 'city_only' && (
                      <p data-testid="location-display-mode-city-only-warning" className="mt-2 text-xs text-stone-500">
                        "City only" hides your street address, postal code, and phone number. Your location's name is
                        still shown — avoid putting an address in the location name if you're keeping it private.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="mt-8 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          {/*
            Phase A (draft/publish split) copy note: this row's "Publish"
            only pushes the booking-page layout/content draft onto what is
            already live — it never touches publicationStatus and never
            makes an unpublished salon public. The caption below exists
            specifically to keep it from being misread as the salon-level
            action in SalonPublishBanner above.
          */}
          <p className="mb-3 text-xs text-stone-500">Publishes booking-page layout &amp; content changes only — not the same as publishing your salon above.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="booking-page-publish"
              disabled={actionStatus !== 'idle' || presentationPending}
              onClick={() => void handlePublish()}
              className="rounded-full bg-rose-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:opacity-50"
            >
              {actionStatus === 'publishing' ? 'Publishing…' : 'Publish'}
            </button>
            <button
              type="button"
              data-testid="booking-page-revert"
              disabled={actionStatus !== 'idle' || presentationPending}
              onClick={() => void handleRevert()}
              className="rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
            >
              {actionStatus === 'reverting' ? 'Reverting…' : 'Revert draft to live'}
            </button>
            {actionMessage && (
              <span role="status" className="text-sm text-stone-600">{actionMessage}</span>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
