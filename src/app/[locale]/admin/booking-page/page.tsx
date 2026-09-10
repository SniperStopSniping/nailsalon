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
import { ADDRESS_PRIVACY_OPTIONS, BookingPageInformationEditor } from '@/components/admin/BookingPageInformationEditor';
import type { BookingPagePresentationPreview, CoverUploadState } from '@/components/admin/BookingPageLayoutChooser';
import {
  BookingPagePresetPicker,
  type BookingPagePresetPickerStatus,
} from '@/components/admin/BookingPagePresetPicker';
import {
  disableBookingPagePreviewFrameInteraction,
  normalizeBookingPagePreviewFrame,
} from '@/components/admin/bookingPagePreviewFrame';
import { QUICK_BOOK_VISIBILITY_OPTIONS, QuickBookProfileVisibilityCard, QuickBookVisibilitySwitch } from '@/components/admin/QuickBookProfileVisibilityCard';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { BookingPageBuilderOperation } from '@/libs/bookingPageBuilder';
import type {
  BookingPageConfig,
  BusinessMode,
  SectionId,
} from '@/libs/bookingPageConfig';
import type {
  BookingPageContent,
  LocationDisplayMode,
} from '@/libs/bookingPageContent';
import { getQuickBookLayout } from '@/libs/quickBookSiteLayout';
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

/*
 * The legacy no-panel mode of this route predates the Booking Page hub and
 * still carries every control the hub since gave a home. Two of them were
 * retired here rather than left to contradict a panel:
 *
 *  - "Style pack" offered exactly one option, `Default`, with every other
 *    `REGISTERED_STYLE_PACKS` entry unimplemented (Rev 3 plan PR 20). A
 *    picker with one choice that is already selected teaches nothing and
 *    competes with the hub's Style & Colours panel for the same words.
 *    `stylePack` keeps its config field, its default and its server
 *    validation; only the dead control is gone.
 *  - "Location shown as" duplicated the Your Information panel's Address
 *    privacy radiogroup over the same `locationDisplayMode` record. It stays
 *    editable here (with the live-vs-draft warning it gained for
 *    AG-w2-information-parity-03) but under the canonical name, and it links
 *    to the panel that owns the rest of the address.
 *
 * The remaining legacy-only controls (business type, profile photo) have no
 * panel to defer to, so they were relabelled in onboarding's vocabulary
 * instead of removed — deleting the only editor for a saved field is an
 * owner decision, not a cohesion fix.
 */
const BUSINESS_MODE_OPTIONS: Array<{ id: BusinessMode; label: string; description: string }> = [
  { id: 'solo', label: 'Independent nail tech', description: 'I work on my own — one calendar.' },
  { id: 'team', label: 'Salon / studio', description: 'We have multiple nail techs or staff.' },
];

/** The same three owner choices as onboarding and the Your Information editor. */
const LOCATION_DISPLAY_MODE_OPTIONS: Array<{ id: LocationDisplayMode; label: string }> = ADDRESS_PRIVACY_OPTIONS.map(option => ({ id: option.value, label: option.label }));

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
  savedDetails?: Record<string, string[]>;
  /** Owner-only identity/image facts for the Layouts chooser thumbnails. */
  presentationPreview?: BookingPagePresentationPreview;
};

/**
 * AG-hub-publish-03 — the draft promise belongs only on the panels whose
 * writes really are staged in `settings.bookingPage.draft` /
 * `bookingPageContent.draft`. `panel=information` writes the canonical salon
 * record through `PATCH /api/admin/salon/information` (name, phone, email,
 * hours, Instagram are public the moment they save), and `panel=policies`
 * only links out to Settings editors that are equally live-immediate. Saying
 * "nothing goes live until you publish" on either one is false, and it sat
 * directly above body copy that said the opposite.
 */
const DRAFT_PANEL_SUBTITLE = 'Changes here save to your draft. Nothing goes live until you publish.';

const PANEL_SUBTITLES: Record<string, string> = {
  information: 'Saved changes apply immediately. This is the business record your live site and bookings already use.',
  policies: 'These links open settings that save immediately. Nothing here waits for a publish.',
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

async function fetchBookingPageState(salonSlug: string, includeInformation = false): Promise<BookingPageApiResponse> {
  const response = await fetch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(salonSlug)}${includeInformation ? '&include=information' : ''}`, {
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
    <section className="rounded-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-[var(--owner-ink)]">{title}</h2>
      {description && <p className="mt-1 text-sm text-[var(--owner-muted)]">{description}</p>}
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
  const reviewPanels = ['information', 'text', 'policies', 'layouts', 'appearance', 'publish'];
  const reviewIndex = searchParams.get('guided') === '1' && panel ? reviewPanels.indexOf(panel) : -1;
  const show = (name: string) => !panel || panel === name;
  const locale = String(params?.locale || 'en');
  const [salonSlug, setSalonSlug] = useState(searchParams.get('salon') || '');

  const [config, setConfig] = useState<BookingPageConfig | null>(null);
  const [content, setContent] = useState<BookingPageContent | null>(null);
  const [savedDetails, setSavedDetails] = useState<Record<string, string[]> | undefined>();
  const [presentationPreview, setPresentationPreview] = useState<BookingPagePresentationPreview | null>(null);
  const [coverUpload, setCoverUpload] = useState<CoverUploadState>({ status: 'idle', error: null, note: null });
  // Every cover choice (upload or "use default") bumps this; a slow upload
  // whose generation is no longer current is abandoned client-side, and the
  // route's baseline check keeps the newer choice server-side too.
  const coverChoiceGenerationRef = useRef(0);
  const coverUploadAbortRef = useRef<AbortController | null>(null);
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
  // AG-hub-publish-07: true from the tap until the destination takes over.
  const [navigationPending, setNavigationPending] = useState(false);

  // Phase A (draft/publish split): the salon's OWN publicationStatus — not
  // the booking-page config draft/live pair above. Drives whether
  // `SalonPublishBanner` renders at all; null while unknown/loading so the
  // banner never flashes on before the real value is in.
  const [salonPublicationStatus, setSalonPublicationStatus] = useState<string | null>(null);
  const [salonPublishStatus, setSalonPublishStatus] = useState<'idle' | 'publishing' | 'error'>('idle');

  // AG-hub-publish-02: both consequential actions on this screen ask first, in
  // the product's own dialog. `publish-salon` is irreversible (the public URL
  // is locked for good); `revert-draft` throws away unpublished draft edits.
  // The revert used to raise a native `window.confirm` ("localhost says…"),
  // which put the reversible action behind a scarier-looking gate than the
  // permanent one.
  const [pendingConfirmation, setPendingConfirmation]
    = useState<null | 'publish-salon' | 'revert-draft'>(null);
  // Read by `handlePublish` when its request resolves: the salon may have been
  // published (by the banner above) while that request was in flight, and the
  // success wording has to describe the state the owner is actually in.
  const salonPublicationStatusRef = useRef<string | null>(null);
  useEffect(() => {
    salonPublicationStatusRef.current = salonPublicationStatus;
  }, [salonPublicationStatus]);

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
  // Your Information forms save explicitly; the guided review asks them to
  // flush before leaving so an unsaved edit is never silently dropped.
  const informationFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  const registerInformationFlush = useCallback((flush: (() => Promise<boolean>) | null) => {
    informationFlushRef.current = flush;
  }, []);
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
    if (state.presentationPreview) {
      setPresentationPreview(state.presentationPreview);
    }
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
          () => fetchBookingPageState(slug, panel === 'information'),
        );
        if (!cancelled) {
          setSavedDetails(response.state.savedDetails);
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
  }, [adoptBookingPageState, panel, requestBookingPageState]);

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

  const saveCoverChoice = useCallback(async (patch: Record<string, unknown>) => {
    coverChoiceGenerationRef.current += 1;
    coverUploadAbortRef.current?.abort();
    setCoverUpload({ status: 'idle', error: null, note: null });
    await saveContentPatch(patch);
  }, [saveContentPatch]);

  const uploadCover = useCallback(async (file: File) => {
    if (!salonSlug) {
      return;
    }
    coverChoiceGenerationRef.current += 1;
    const generation = coverChoiceGenerationRef.current;
    coverUploadAbortRef.current?.abort();
    const controller = new AbortController();
    coverUploadAbortRef.current = controller;
    setCoverUpload({ status: 'uploading', error: null, note: null });
    setTruthfulSaveStatus('saving');
    const body = new FormData();
    body.append('file', file);
    body.append('baselineHeroImageUrl', content?.draft.heroImageUrl ?? '');
    try {
      const response = await fetch(`/api/admin/booking-page/cover?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as {
        data?: { heroImageUrl: string; qualityNote: string | null };
        error?: { code?: string; message?: string };
      } | null;
      if (generation !== coverChoiceGenerationRef.current) {
        return;
      }
      if (!response.ok || !payload?.data) {
        const stale = payload?.error?.code === 'STALE_CHOICE';
        setCoverUpload({
          status: stale ? 'idle' : 'error',
          error: stale ? null : payload?.error?.message ?? 'Could not upload the cover. Your current cover is unchanged.',
          note: stale ? payload?.error?.message ?? null : null,
        });
        setTruthfulSaveStatus(stale ? 'saved' : 'error');
        return;
      }
      setCoverUpload({ status: 'idle', error: null, note: payload.data.qualityNote });
      // Re-read both pairs from the server rather than trusting one field.
      const fresh = await requestBookingPageState(() => fetchBookingPageState(salonSlug));
      adoptBookingPageState(fresh.state, fresh.identity);
      setTruthfulSaveStatus('saved');
    } catch (uploadError) {
      if (controller.signal.aborted || generation !== coverChoiceGenerationRef.current) {
        return;
      }
      setCoverUpload({
        status: 'error',
        error: uploadError instanceof Error ? uploadError.message : 'Could not upload the cover. Your current cover is unchanged.',
        note: null,
      });
      setTruthfulSaveStatus('error');
    }
  }, [adoptBookingPageState, content?.draft.heroImageUrl, requestBookingPageState, salonSlug, setTruthfulSaveStatus]);

  /**
   * AG-hub-publish-07 — every guided-review move drains the queued ordinary
   * writes before it routes, which is correct (an unsaved edit is never
   * silently dropped) but can take seconds. The button used to say nothing
   * while that happened: same label, merely disabled, so the last action of a
   * six-step flow looked broken and invited a second tap.
   *
   * `navigationPending` stays true through `router.push` on purpose — the
   * pending label must survive until the destination replaces this screen —
   * and is only cleared when the navigation does NOT happen.
   */
  async function navigateAfterSaving(destination: string) {
    if (presentationWritePendingRef.current || navigationPending) {
      return;
    }
    setNavigationPending(true);
    try {
      await runNavigation(destination);
    } catch (navigationError) {
      setNavigationPending(false);
      throw navigationError;
    }
  }

  async function runNavigation(destination: string) {
    if (hasUnsavedContentTextEdits()) {
      const values = { bio: bioDraft, specialtyLine: specialtyDraft, heroImageUrl: heroImageDraft };
      const patch = Object.fromEntries(EDITABLE_CONTENT_FIELDS
        .filter(field => contentEditGenerationByFieldRef.current[field] > savedContentEditGenerationByFieldRef.current[field])
        .map(field => [field, values[field].trim() || null]));
      await saveContentPatch(patch);
    }
    const informationSaved = informationFlushRef.current ? await informationFlushRef.current() : true;
    if (!await settleOrdinaryWrites() || hasUnsavedContentTextEdits() || !informationSaved) {
      setActionMessage('Your changes could not be saved. Please retry before leaving this editor.');
      setNavigationPending(false);
      return;
    }
    router.push(destination);
  }

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
        // AG-hub-publish-06: this action only moves the booking-page draft onto
        // the published side of the same salon. While the salon itself is still
        // a private draft there is no public page yet, so saying "live" here
        // contradicts the banner directly above it.
        setActionMessage(
          salonPublicationStatusRef.current === 'published'
            ? 'Published. Your live booking page now matches your draft.'
            : 'Saved to your draft site — publish your salon to make it public.',
        );
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
    setPendingConfirmation('revert-draft');
  };

  const confirmRevert = async () => {
    if (!salonSlug || presentationWritePendingRef.current) {
      setPendingConfirmation(null);
      return;
    }
    setPendingConfirmation(null);
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
  const handlePublishSalon = () => {
    if (!salonSlug) {
      return;
    }
    setPendingConfirmation('publish-salon');
  };

  const confirmPublishSalon = async () => {
    if (!salonSlug) {
      setPendingConfirmation(null);
      return;
    }
    setPendingConfirmation(null);
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
      <main className="owner-workspace-theme flex min-h-screen items-center justify-center bg-[var(--owner-ground)]" data-theme-scope="owner">
        <div className="size-8 animate-spin rounded-full border-2 border-[var(--owner-line-strong)] border-t-[var(--owner-accent)]" />
      </main>
    );
  }

  if (error || !config || !content) {
    return (
      <main className="owner-workspace-theme flex min-h-screen items-center justify-center bg-[var(--owner-ground)] px-6 text-center" data-theme-scope="owner">
        <p className="text-sm text-[var(--owner-muted)]">{error ?? 'Something went wrong.'}</p>
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
  // The address the salon publish locks for good. Shown in the confirmation so
  // the owner reads the exact string before it becomes permanent.
  const publicSalonPath = salonSlug
    ? getI18nPath(`/${encodeURIComponent(salonSlug)}`, locale)
    : '';
  const publicSalonUrlLabel = publicSalonPath
    ? (typeof window === 'undefined'
        ? publicSalonPath
        : new URL(publicSalonPath, window.location.origin).href)
    : 'your booking page address';

  return (
    <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] px-4 pb-16 pt-8 text-[var(--owner-ink)]" data-theme-scope="owner">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => void navigateAfterSaving(`/${locale}/admin/website${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)}
          aria-busy={navigationPending}
          disabled={presentationPending || navigationPending}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--owner-muted)] disabled:opacity-50"
        >
          <ArrowLeft size={16} />
          {navigationPending ? 'Saving…' : 'Booking Page'}
        </button>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--owner-accent)]">Booking Page</p>
            <h1 className="mt-2 text-3xl font-semibold">{({ layouts: 'Layouts', appearance: 'Style & Colours', information: 'Your Information', text: 'About & Website Text', policies: 'Policies & Booking Rules', publish: 'Review & Publish' } as Record<string, string>)[panel ?? ''] ?? 'Layout, style and content'}</h1>
            <p className="mt-2 text-[var(--owner-muted)]" data-testid="booking-page-panel-subtitle">{PANEL_SUBTITLES[panel ?? ''] ?? DRAFT_PANEL_SUBTITLE}</p>
            {reviewIndex >= 0 && (
              <p className="mt-2 text-sm font-semibold text-[var(--owner-accent)]">
                {`Guided review · Step ${reviewIndex + 1} of ${reviewPanels.length} · Your current saved setup`}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <a
              href={previewPath ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!previewPath}
              data-testid="booking-page-preview-link"
              className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--owner-line-strong)] bg-[var(--owner-blush)] px-4 py-2 text-sm font-semibold text-[var(--owner-accent)] transition-colors ${
                previewPath ? 'hover:bg-[var(--owner-blush)]' : 'pointer-events-none opacity-50'
              }`}
            >
              Preview
              <ExternalLink size={14} />
            </a>
            <span className="text-[11px] text-[var(--owner-line-strong)]">Shows your draft — only you can see it</span>
          </div>
        </div>

        {/* The irreversible salon-level publish is offered outside the guided review or on its final step only — never from step 1 of a "review" that promises nothing is reset. */}
        {salonPublicationStatus !== null && salonPublicationStatus !== 'published' && (reviewIndex < 0 || panel === 'publish') && (
          <SalonPublishBanner status={salonPublishStatus} onPublish={handlePublishSalon} />
        )}

        <div className="mt-3 h-5 text-xs text-[var(--owner-muted)]" role="status" aria-live="polite">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'dirty' && 'Unsaved changes'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'stale' && 'Your draft changed elsewhere. The latest presentation is loaded; review it before trying again.'}
          {saveStatus === 'error' && 'Could not save — please retry.'}
        </div>

        <div className="mt-6 space-y-6">
          {(!panel || panel === 'layouts') && (
            <SectionCard
              title="Live preview"
              description="This is your real draft booking page. Saved presentation changes refresh here before anything is published."
            >
              <div
                data-booking-page-preview-scroll
                className="h-[620px] overflow-hidden overscroll-contain rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)]"
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
                        className="pointer-events-none block size-full bg-[var(--owner-surface)]"
                      />
                    )
                  : (
                      <p className="p-4 text-sm text-[var(--owner-muted)]">Preview is unavailable until a salon is selected.</p>
                    )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[var(--owner-muted)]">
                  View-only preview using your real salon content and the same booking renderer clients see.
                  Use Open preview for the fully interactive page.
                </p>
                <button
                  type="button"
                  data-testid="booking-page-preview-refresh"
                  onClick={() => refreshPreview()}
                  className="min-h-11 rounded-full border border-[var(--owner-line-strong)] bg-[var(--owner-surface)] px-4 py-2 text-sm font-semibold text-[var(--owner-muted)] hover:bg-[var(--owner-ground)]"
                >
                  Refresh preview
                </button>
              </div>
            </SectionCard>
          )}

          {!panel && (
            <QuickBookProfileVisibilityCard
              disabled={presentationPending}
              draft={draft}
              onConfigPatch={patch => void saveConfigPatch(patch)}
            />
          )}

          {panel === 'information' && salonSlug && (
            <BookingPageInformationEditor
              addressPrivacy={content.draft.locationDisplayMode}
              coverUpload={coverUpload}
              coverUrl={content.draft.heroImageUrl}
              coverUsedByLayout={getQuickBookLayout(draft.quickBookLayout ?? 'clean_card').cover}
              disabled={presentationPending}
              draft={draft}
              liveAddressPrivacy={content.live.locationDisplayMode}
              locale={locale}
              mode="booking"
              onAddressPrivacyChange={mode => void saveContentPatch({ locationDisplayMode: mode })}
              onConfigPatch={patch => void saveConfigPatch(patch)}
              onUploadCover={file => void uploadCover(file)}
              onUseDefaultCover={() => void saveCoverChoice({ heroImageUrl: null })}
              registerFlush={registerInformationFlush}
              salonSlug={salonSlug}
              savedDetails={savedDetails}
            />
          )}

          {(panel === 'layouts' || panel === 'appearance') && (
            <BookingPageAppearance
              content={content?.draft ?? null}
              coverUpload={coverUpload}
              disabled={presentationPending}
              draft={draft}
              informationHref={salonSlug ? `/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}&panel=information` : null}
              mode={panel}
              onChange={patch => void saveConfigPatch(patch)}
              onContentChange={patch => void (Object.prototype.hasOwnProperty.call(patch, 'heroImageUrl') ? saveCoverChoice(patch) : saveContentPatch(patch))}
              onUploadCover={file => void uploadCover(file)}
              portfolioHref={salonSlug ? `/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=portfolio` : null}
              presentationPreview={presentationPreview}
              textHref={salonSlug ? `/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}&panel=text` : null}
            />
          )}

          {panel === 'policies' && (
            <>
              {draft.layout === 'quick_book' && (
                <SectionCard title="Policies display" description="Choose which saved policies and real review information appear on Quick Book. These display choices wait for Publish.">
                  <fieldset disabled={presentationPending} className="divide-y divide-[var(--owner-line)]">
                    <legend className="sr-only">Policies shown publicly</legend>
                    {QUICK_BOOK_VISIBILITY_OPTIONS.filter(option => ['showBookingPolicy', 'showCancellationPolicy', 'showReviews'].includes(option.key)).map(option => (
                      <QuickBookVisibilitySwitch checked={draft.quickBookProfile[option.key]} key={option.key} onConfigPatch={patch => void saveConfigPatch(patch)} option={option} />
                    ))}
                  </fieldset>
                </SectionCard>
              )}
              <SectionCard title="Customer-facing policies" description="Review the policy wording and acknowledgment clients see. Policy wording does not enable automatic charges.">
                <a className="inline-flex min-h-11 items-center rounded-xl border border-[var(--owner-line-strong)] px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings&view=booking-policy`}>Edit booking policy</a>
              </SectionCard>
              <SectionCard title="Operational booking settings" description="These settings affect booking logic directly. Saving here is separate from publishing website appearance.">
                <a className="inline-flex min-h-11 items-center rounded-xl border border-[var(--owner-line-strong)] px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=settings&view=booking`}>Booking rules & availability</a>
                <a className="mt-3 flex min-h-11 items-center rounded-xl border border-[var(--owner-line-strong)] px-4" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=payments`}>Payments & deposits</a>
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
            <SectionCard
              title="Business type"
              description="Chosen during setup. It decides whether your booking page and calendar show one nail tech or several."
            >
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
                        ? 'border-rose-600 bg-[var(--owner-blush)] text-[var(--owner-accent)]'
                        : 'border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-muted)] hover:border-rose-300'
                    }`}
                  >
                    {option.label}
                    <span className="mt-1 block text-[11px] font-normal text-[var(--owner-line-strong)]">{option.description}</span>
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
                  <div>
                    <label className="block">
                      <span className="text-sm font-medium text-[var(--owner-ink)]">Profile photo link</span>
                      <span className="mt-0.5 block text-xs text-[var(--owner-muted)]">The photo at the top of your booking page — the one setup called your profile photo. Paste the address of a photo you have already uploaded.</span>
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
                        className="mt-1 w-full rounded-xl border border-[var(--owner-line)] px-3 py-2 text-sm"
                      />
                    </label>
                    <a className="mt-2 inline-flex text-sm font-semibold text-[var(--owner-accent)] underline" href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}&app=portfolio`}>Photos &amp; Gallery</a>
                  </div>
                )}

                <label className="block">
                  <span className="text-sm font-medium text-[var(--owner-ink)]">Specialty line</span>
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
                    className="mt-1 w-full rounded-xl border border-[var(--owner-line)] px-3 py-2 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-[var(--owner-ink)]">Bio</span>
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
                    className="mt-1 w-full rounded-xl border border-[var(--owner-line)] px-3 py-2 text-sm"
                  />
                </label>

                {!panel && (
                  <div>
                    {/*
                      Same record, same name as the panel that owns it: this
                      used to be called "Location shown as" while Your
                      Information called the identical choice "Address
                      privacy", so an owner could not tell they were the same
                      setting.
                    */}
                    <span className="text-sm font-medium text-[var(--owner-ink)]">Address privacy</span>
                    <span className="mt-0.5 block text-xs text-[var(--owner-muted)]">
                      The same choice as
                      {' '}
                      <a className="font-semibold text-[var(--owner-accent)] underline" data-testid="location-display-mode-canonical-link" href={`/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}&panel=information`}>Your Information</a>
                      , where your address, hours and contact details live.
                    </span>
                    <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                              ? 'border-rose-600 bg-[var(--owner-blush)] text-[var(--owner-accent)]'
                              : 'border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-muted)] hover:border-rose-300'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {/*
                      One record, two controls: this one must carry the same
                      live-vs-draft warning as the Your Information radiogroup
                      or an owner changing address privacy here is told nothing
                      about what their live site still shows
                      (AG-w2-information-parity-03).
                    */}
                    {content.live.locationDisplayMode !== content.draft.locationDisplayMode && (
                      <p data-testid="location-display-mode-unpublished" className="mt-2 text-xs text-amber-800">
                        {`Your live site still uses “${ADDRESS_PRIVACY_OPTIONS.find(option => option.value === content.live.locationDisplayMode)?.label}” until you publish.`}
                      </p>
                    )}
                    {content.draft.locationDisplayMode !== 'full_address' && (
                      <p data-testid="location-display-mode-city-only-warning" className="mt-2 text-xs text-[var(--owner-muted)]">
                        {content.draft.locationDisplayMode === 'after_booking'
                          ? 'While browsing, clients see only your city. Your street address, postal code and phone appear on their private appointment link once a booking is confirmed.'
                          : '"Show only my city" hides your street address, postal code, and phone number.'}
                        {' '}
                        Your location's name is still shown — avoid putting an address in the location name if you're keeping it private.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="mt-8 rounded-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm">
          {reviewIndex >= 0 && (
            <div className="mb-5 border-b border-[var(--owner-line)] pb-5">
              <div className="flex flex-wrap gap-3">
                {reviewIndex > 0 && (
                  <button type="button" aria-busy={navigationPending} data-testid="guided-review-previous" disabled={presentationPending || navigationPending} className="min-h-11 rounded-xl border border-[var(--owner-line-strong)] px-4 py-3 text-sm font-semibold disabled:opacity-50" onClick={() => void navigateAfterSaving(`/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}&panel=${reviewPanels[reviewIndex - 1]}&guided=1`)}>Previous step</button>
                )}
                {/* AG-hub-publish-07 — the label, not just the disabled state, says a save is draining. */}
                <button type="button" aria-busy={navigationPending} data-testid="guided-review-next" disabled={presentationPending || navigationPending} className="min-h-11 rounded-xl bg-[var(--owner-accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void navigateAfterSaving(reviewIndex < reviewPanels.length - 1 ? `/${locale}/admin/booking-page?salon=${encodeURIComponent(salonSlug)}&panel=${reviewPanels[reviewIndex + 1]}&guided=1` : `/${locale}/admin/website?salon=${encodeURIComponent(salonSlug)}`)}>
                  {reviewIndex < reviewPanels.length - 1
                    ? (navigationPending ? 'Saving…' : 'Save & next step')
                    : (navigationPending ? 'Finishing review…' : 'Finish review')}
                </button>
              </div>
              <p className="mt-2 h-4 text-xs text-[var(--owner-muted)]" role="status">
                {navigationPending
                  ? (reviewIndex < reviewPanels.length - 1
                      ? 'Saving your changes before the next step…'
                      : 'Saving your changes and returning to Booking Page…')
                  : ''}
              </p>
            </div>
          )}
          {/*
            Phase A (draft/publish split) copy note: this row's "Publish"
            only pushes the booking-page layout/content draft onto what is
            already live — it never touches publicationStatus and never
            makes an unpublished salon public. The caption below exists
            specifically to keep it from being misread as the salon-level
            action in SalonPublishBanner above.
          */}
          {(reviewIndex < 0 || panel === 'publish') && <p className="mb-3 text-xs text-[var(--owner-muted)]">Publishes booking-page layout &amp; content changes only — not the same as publishing your salon above.</p>}
          {(reviewIndex < 0 || panel === 'publish') && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="booking-page-publish"
                disabled={actionStatus !== 'idle' || presentationPending}
                onClick={() => void handlePublish()}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--owner-accent)] px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-50"
              >
                {actionStatus === 'publishing' ? 'Publishing…' : 'Publish'}
              </button>
              <button
                type="button"
                data-testid="booking-page-revert"
                disabled={actionStatus !== 'idle' || presentationPending}
                onClick={() => void handleRevert()}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--owner-line-strong)] bg-[var(--owner-surface)] px-5 text-sm font-semibold text-[var(--owner-muted)] outline-none transition-colors hover:bg-[var(--owner-ground)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-50"
              >
                {actionStatus === 'reverting' ? 'Reverting…' : 'Revert draft to live'}
              </button>
            </div>
          )}
          {actionMessage && (
            <span role="status" className="text-sm text-[var(--owner-muted)]">{actionMessage}</span>
          )}
        </div>
      </div>

      {/*
        AG-hub-publish-02 — one dialog component for both consequential
        actions, so the permanent one is never the easier tap. The salon
        publish names the exact address that gets locked; the revert names
        what is discarded.
      */}
      <ConfirmDialog
        isOpen={pendingConfirmation === 'publish-salon'}
        title="Publish your salon?"
        tone="danger"
        confirmLabel="Publish my salon"
        cancelLabel="Not yet"
        onClose={() => setPendingConfirmation(null)}
        onConfirm={() => void confirmPublishSalon()}
        description={(
          <>
            <p>Your link becomes permanent and your site goes live. Anyone with the address can book.</p>
            <p className="mt-2 break-all font-medium text-neutral-900" data-testid="salon-publish-confirm-url">{publicSalonUrlLabel}</p>
            <p className="mt-2">This address can't be changed afterwards.</p>
          </>
        )}
      />

      <ConfirmDialog
        isOpen={pendingConfirmation === 'revert-draft'}
        title="Discard your unpublished changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onClose={() => setPendingConfirmation(null)}
        onConfirm={() => void confirmRevert()}
        description="Your draft goes back to matching what is already live. Anything you changed since your last publish is lost."
      />
    </main>
  );
}
