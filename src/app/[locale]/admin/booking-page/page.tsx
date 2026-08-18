'use client';

/**
 * Owner Booking Page surface (Luster UI/UX plan rev 3, PR 5).
 *
 * The small, non-builder owner destination over the PR 2 `bookingPage`
 * config: layout picker, style pack picker, business mode, section
 * show/hide, hero image / specialty line / bio / location presentation, an
 * owner preview link (reusing PR 3's owner-preview primitive — see the
 * comment on `previewHref` below), and Publish/Revert on the draft/live
 * pair. Explicitly NOT a drag-and-drop or free-form layout builder — every
 * control here is a plain picker, toggle, or text field over a value the
 * server already validates.
 *
 * `serviceMenu` and `bookingCta` are never rendered as toggle controls here —
 * see OPTIONAL_SECTIONS below, which deliberately omits both. Even if a
 * malicious request bypassed this UI, `@/libs/bookingPageConfig`'s
 * `validateSectionOrder` (invoked by the API route on every write) strips
 * them from `hiddenSections` server-side regardless.
 */

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BookingPageConfig,
  BookingPageLayout,
  BusinessMode,
  SectionId,
  StylePack,
} from '@/libs/bookingPageConfig';
import type {
  BookingPageContent,
  LocationDisplayMode,
} from '@/libs/bookingPageContent';

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

/**
 * Mirrors `BOOKING_PAGE_LAYOUTS` in `@/libs/bookingPageConfig`. `quick_book`
 * and, as of PR 6, `editorial` are implemented — extended additively here
 * (only the `editorial` entry's `implemented` flag flips; the array's shape
 * and every other entry are unchanged) rather than restructuring this list.
 * `tech_profile`/`portfolio`/`catalogue` remain PR 21/22/23's job.
 */
const LAYOUT_OPTIONS: Array<{ id: BookingPageLayout; label: string; implemented: boolean }> = [
  { id: 'quick_book', label: 'Quick Book', implemented: true },
  { id: 'editorial', label: 'Editorial Luxury', implemented: true },
  { id: 'tech_profile', label: 'Tech Profile', implemented: false },
  { id: 'portfolio', label: 'Portfolio', implemented: false },
  { id: 'catalogue', label: 'Catalogue', implemented: false },
];

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

/**
 * The nine OPTIONAL sections from the PR 4 registry, per this PR's spec.
 * `serviceMenu` and `bookingCta` are intentionally absent — this is the one
 * and only list this component reads to build toggle controls, so there is
 * no code path here that can ever render a toggle for either.
 *
 * `comingSoon` sections are disabled here because turning them on has no
 * possible visible effect anywhere, and are shown that way rather than left
 * as a silently-inert toggle (post-launch audit finding — "no inert toggle
 * may remain"):
 *   - `portfolio`/`reviews`: PR 4's registry always resolves both to empty
 *     (`content.proof.{portfolio,reviews}` are `[]` until PR 10).
 *   - `whatsIncluded`: `SECTION_REGISTRY.whatsIncluded.canRender` is
 *     `() => false` unconditionally (`@/libs/sectionRegistry`) — data gap
 *     17, no per-service inclusions field exists yet in `SalonContent`.
 *   - `technicianList`: no layout has a `technicianList` renderer yet (only
 *     `canRender` — "≥2 technicians" — is implemented; see
 *     `BookServiceClient.tsx`'s `quickBookRenderers`/`editorialRenderers`,
 *     neither of which defines one).
 *
 * `technicianProfile`/`hoursLocation` are NOT marked `comingSoon`: both have
 * a real, working renderer today — in the `editorial` layout only
 * (`BookServiceClient.tsx`'s `editorialRenderers`). Quick Book has no
 * renderer for either, so toggling them on while on `quick_book` currently
 * has no visible effect there — a known, separately-tracked gap (not fixed
 * by this PR: layout-gating them here would disable the SAME toggle this
 * surface's own regression test exercises against the default `quick_book`
 * config, and building new Quick Book sections for them is a larger,
 * untested change outside this PR's scope). Recorded as deferred debt, not
 * silently accepted.
 */
const OPTIONAL_SECTIONS: Array<{ id: SectionId; label: string; comingSoon: boolean }> = [
  { id: 'technicianProfile', label: 'Technician profile', comingSoon: false },
  { id: 'featuredServices', label: 'Featured services', comingSoon: false },
  { id: 'whatsIncluded', label: 'What\'s included', comingSoon: true },
  { id: 'technicianList', label: 'Technician list', comingSoon: true },
  { id: 'portfolio', label: 'Portfolio', comingSoon: true },
  { id: 'reviews', label: 'Reviews', comingSoon: true },
  { id: 'hoursLocation', label: 'Hours & location', comingSoon: false },
  { id: 'policies', label: 'Policies', comingSoon: false },
  { id: 'socialLinks', label: 'Social links', comingSoon: false },
];

// =============================================================================
// Fetch helpers
// =============================================================================

type BookingPageApiResponse = {
  config: BookingPageConfig;
  content: BookingPageContent;
};

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
  body: { config?: Record<string, unknown>; content?: Record<string, unknown> },
): Promise<BookingPageApiResponse> {
  const response = await fetch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(salonSlug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to save (${response.status})`);
  }
  return response.json();
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

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        onClick={() => !disabled && onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
          checked ? 'bg-rose-600' : 'bg-stone-300'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </label>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function BookingPageOwnerSurface() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = String(params?.locale || 'en');
  const [salonSlug, setSalonSlug] = useState(searchParams.get('salon') || '');

  const [config, setConfig] = useState<BookingPageConfig | null>(null);
  const [content, setContent] = useState<BookingPageContent | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [actionStatus, setActionStatus] = useState<'idle' | 'publishing' | 'reverting'>('idle');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Bio/specialty/heroImage text fields save on blur, not on every keystroke.
  const [bioDraft, setBioDraft] = useState('');
  const [specialtyDraft, setSpecialtyDraft] = useState('');
  const [heroImageDraft, setHeroImageDraft] = useState('');

  const saveTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      let slug = salonSlug;
      if (!slug) {
        const me = await fetch('/api/admin/auth/me', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
        slug = me?.user?.salons?.[0]?.slug || '';
        if (!cancelled) {
          setSalonSlug(slug);
        }
      }
      if (!slug) {
        if (!cancelled) {
          setLoading(false);
          setError('No salon found for this account.');
        }
        return;
      }

      const me = await fetch(`/api/admin/auth/me?salonSlug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
      const bookingUrl = me?.user?.salons?.[0]?.bookingUrl ?? null;
      if (!cancelled) {
        setPreviewUrl(bookingUrl);
      }

      try {
        const state = await fetchBookingPageState(slug);
        if (!cancelled) {
          setConfig(state.config);
          setContent(state.content);
          setBioDraft(state.content.draft.bio ?? '');
          setSpecialtyDraft(state.content.draft.specialtyLine ?? '');
          setHeroImageDraft(state.content.draft.heroImageUrl ?? '');
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
  }, []);

  const saveConfigPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!salonSlug) {
      return;
    }
    const token = ++saveTokenRef.current;
    setSaveStatus('saving');
    try {
      const state = await patchBookingPage(salonSlug, { config: patch });
      if (saveTokenRef.current === token) {
        setConfig(state.config);
        setSaveStatus('saved');
      }
    } catch {
      if (saveTokenRef.current === token) {
        setSaveStatus('error');
      }
    }
  }, [salonSlug]);

  const saveContentPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!salonSlug) {
      return;
    }
    const token = ++saveTokenRef.current;
    setSaveStatus('saving');
    try {
      const state = await patchBookingPage(salonSlug, { content: patch });
      if (saveTokenRef.current === token) {
        setContent(state.content);
        setSaveStatus('saved');
      }
    } catch {
      if (saveTokenRef.current === token) {
        setSaveStatus('error');
      }
    }
  }, [salonSlug]);

  const handleLayoutSelect = (layout: BookingPageLayout) => {
    const option = LAYOUT_OPTIONS.find(l => l.id === layout);
    if (!option?.implemented) {
      return;
    }
    void saveConfigPatch({ layout });
  };

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

  /**
   * "shown" = the id is present in sectionOrder AND absent from
   * hiddenSections. Turning a section on both removes it from
   * hiddenSections and ensures it is present in sectionOrder (inserted
   * before `bookingCta`, or appended if `bookingCta` is somehow absent) —
   * several of the nine toggleable ids (technicianProfile, whatsIncluded,
   * technicianList, hoursLocation) are not in today's default sectionOrder
   * at all, so "on" must add them, not just un-hide them. Turning a section
   * off adds it to hiddenSections and leaves sectionOrder untouched, so its
   * position is preserved if the owner re-enables it later. The server
   * (`validateSectionOrder`) re-validates and re-strips serviceMenu/
   * bookingCta from hiddenSections regardless of what is sent here.
   */
  const handleSectionToggle = (id: SectionId, show: boolean) => {
    if (!config) {
      return;
    }
    const hiddenSet = new Set(config.draft.hiddenSections);
    let sectionOrder = [...config.draft.sectionOrder];

    if (show) {
      hiddenSet.delete(id);
      if (!sectionOrder.includes(id)) {
        const ctaIndex = sectionOrder.indexOf('bookingCta');
        if (ctaIndex === -1) {
          sectionOrder = [...sectionOrder, id];
        } else {
          sectionOrder = [...sectionOrder.slice(0, ctaIndex), id, ...sectionOrder.slice(ctaIndex)];
        }
      }
    } else {
      hiddenSet.add(id);
    }

    void saveConfigPatch({ sectionOrder, hiddenSections: [...hiddenSet] });
  };

  const handlePublish = async () => {
    if (!salonSlug) {
      return;
    }
    setActionStatus('publishing');
    setActionMessage(null);
    try {
      const state = await postBookingPageAction(salonSlug, 'publish');
      setConfig(state.config);
      setContent(state.content);
      setBioDraft(state.content.draft.bio ?? '');
      setSpecialtyDraft(state.content.draft.specialtyLine ?? '');
      setHeroImageDraft(state.content.draft.heroImageUrl ?? '');
      setActionMessage('Published. Your live booking page now matches your draft.');
    } catch {
      setActionMessage('Publish failed. Please try again.');
    } finally {
      setActionStatus('idle');
    }
  };

  const handleRevert = async () => {
    if (!salonSlug) {
      return;
    }

    const confirmed = window.confirm('Discard unpublished changes and reset the draft to match what is live?');
    if (!confirmed) {
      return;
    }
    setActionStatus('reverting');
    setActionMessage(null);
    try {
      const state = await postBookingPageAction(salonSlug, 'revert');
      setConfig(state.config);
      setContent(state.content);
      setBioDraft(state.content.draft.bio ?? '');
      setSpecialtyDraft(state.content.draft.specialtyLine ?? '');
      setHeroImageDraft(state.content.draft.heroImageUrl ?? '');
      setActionMessage('Reverted. Your draft now matches what is live.');
    } catch {
      setActionMessage('Revert failed. Please try again.');
    } finally {
      setActionStatus('idle');
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
  const hiddenSet = new Set(draft.hiddenSections);
  const isShown = (id: SectionId) => draft.sectionOrder.includes(id) && !hiddenSet.has(id);

  return (
    <main className="min-h-screen bg-[#F8F3F0] px-4 pb-16 pt-8 text-stone-900">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => router.push(`/${locale}/admin${salonSlug ? `?salon=${encodeURIComponent(salonSlug)}` : ''}`)}
          className="inline-flex items-center gap-2 text-sm text-stone-600"
        >
          <ArrowLeft size={16} />
          Dashboard
        </button>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Booking Page</p>
            <h1 className="mt-2 text-3xl font-semibold">Layout, style and content</h1>
            <p className="mt-2 text-stone-600">Changes here save to your draft. Nothing goes live until you publish.</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <a
              href={previewUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!previewUrl}
              data-testid="booking-page-preview-link"
              className={`inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors ${
                previewUrl ? 'hover:bg-rose-100' : 'pointer-events-none opacity-50'
              }`}
            >
              Preview
              <ExternalLink size={14} />
            </a>
            <span className="text-[11px] text-stone-400">Shows your draft — only you can see it</span>
          </div>
        </div>

        <div className="mt-3 h-5 text-xs text-stone-500" role="status" aria-live="polite">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Could not save — please retry.'}
        </div>

        <div className="mt-6 space-y-6">
          <SectionCard title="Layout" description="Quick Book and Editorial Luxury are available today. The rest are on the way.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LAYOUT_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  disabled={!option.implemented}
                  data-testid={`layout-option-${option.id}`}
                  aria-pressed={draft.layout === option.id}
                  onClick={() => handleLayoutSelect(option.id)}
                  className={`rounded-2xl border p-3 text-left text-sm font-medium transition-colors ${
                    draft.layout === option.id
                      ? 'border-rose-600 bg-rose-50 text-rose-800'
                      : 'border-stone-200 bg-white text-stone-700'
                  } ${!option.implemented ? 'cursor-not-allowed opacity-50' : 'hover:border-rose-300'}`}
                >
                  {option.label}
                  {!option.implemented && (
                    <span className="mt-1 block text-[11px] font-normal text-stone-400">Coming soon</span>
                  )}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Style pack" description="Only Default is available today.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STYLE_PACK_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  disabled={!option.implemented}
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

          <SectionCard title="Business mode">
            <div className="grid grid-cols-2 gap-2">
              {BUSINESS_MODE_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
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

          <SectionCard
            title="Sections"
            description="Show or hide optional sections. Services and the booking button are always shown and can't be hidden here."
          >
            <div className="divide-y divide-stone-100">
              {OPTIONAL_SECTIONS.map(section => (
                <Toggle
                  key={section.id}
                  testId={`section-toggle-${section.id}`}
                  label={section.comingSoon ? `${section.label} (coming soon)` : section.label}
                  checked={section.comingSoon ? false : isShown(section.id)}
                  disabled={section.comingSoon}
                  onChange={next => handleSectionToggle(section.id, next)}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Content" description="Hero image, specialty line, bio and how your location is shown.">
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-stone-800">Hero / profile image URL</span>
                <input
                  type="url"
                  data-testid="content-hero-image-url"
                  value={heroImageDraft}
                  onChange={event => setHeroImageDraft(event.target.value)}
                  onBlur={() => void saveContentPatch({ heroImageUrl: heroImageDraft.trim() === '' ? null : heroImageDraft.trim() })}
                  placeholder="https://…"
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-stone-800">Specialty line</span>
                <input
                  type="text"
                  data-testid="content-specialty-line"
                  value={specialtyDraft}
                  onChange={event => setSpecialtyDraft(event.target.value)}
                  onBlur={() => void saveContentPatch({ specialtyLine: specialtyDraft.trim() === '' ? null : specialtyDraft })}
                  placeholder="Russian manicure & BIAB · Toronto"
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-stone-800">Bio</span>
                <textarea
                  data-testid="content-bio"
                  value={bioDraft}
                  onChange={event => setBioDraft(event.target.value)}
                  onBlur={() => void saveContentPatch({ bio: bioDraft.trim() === '' ? null : bioDraft })}
                  rows={4}
                  placeholder="Tell clients about your studio…"
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </label>

              <div>
                <span className="text-sm font-medium text-stone-800">Location shown as</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {LOCATION_DISPLAY_MODE_OPTIONS.map(option => (
                    <button
                      key={option.id}
                      type="button"
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
                    "City only" hides your street address and postal code. Your location's name and phone number
                    are still shown — avoid putting an address in the location name if you're keeping it private.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <button
            type="button"
            data-testid="booking-page-publish"
            disabled={actionStatus !== 'idle'}
            onClick={() => void handlePublish()}
            className="rounded-full bg-rose-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:opacity-50"
          >
            {actionStatus === 'publishing' ? 'Publishing…' : 'Publish'}
          </button>
          <button
            type="button"
            data-testid="booking-page-revert"
            disabled={actionStatus !== 'idle'}
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
    </main>
  );
}
