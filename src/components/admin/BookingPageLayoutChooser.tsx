'use client';

/**
 * Layouts panel — choose a Quick Book site layout and manage the images it
 * uses, all from the owner's current draft.
 *
 * Every card is a miniature of the real composition rendered from the same
 * registry and the same image-state rules as the public page, so a thumbnail
 * can never promise an image the published page will not show. Selecting a
 * card writes ONLY `quickBookLayout` to the draft; uploads, focal points,
 * cover writing, visibility, palette and style are separate saved settings
 * that survive every switch.
 *
 * The contextual "Images for this layout" block edits the SAME assignments
 * the Your Information panel edits (technician photo visibility, cover
 * photo), never a per-layout copy.
 */
import '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/quick-book/quick-book-presentation.css';

import { Info, Upload } from 'lucide-react';
import { type ChangeEvent, type CSSProperties, useEffect, useId, useState } from 'react';

import { QuickBookLayoutPoster } from '@/components/customer-site/QuickBookPresentation';
import type { BookingPageConfigSide, BookingPageDraftPatch } from '@/libs/bookingPageConfig';
import type { BookingPageContentPatch, BookingPageContentSide } from '@/libs/bookingPageContent';
import { getCustomerSitePresentationCssVariables } from '@/libs/customerSitePresentation';
import type { QuickBookFocalPoint } from '@/libs/quickBookPresentation';
import {
  describeQuickBookLayoutCapabilities,
  getQuickBookLayout,
  getQuickBookLayoutsByFamily,
  QUICK_BOOK_LAYOUT_FAMILIES,
  QUICK_BOOK_LAYOUT_FAMILY_LABELS,
  type QuickBookLayoutDefinition,
  type QuickBookSiteLayout,
} from '@/libs/quickBookSiteLayout';

/** Owner-only preview facts returned by `GET /api/admin/booking-page`. */
export type BookingPagePresentationPreview = {
  salonName: string;
  logoUrl: string | null;
  technicianName: string | null;
  technicianPhotoUrl: string | null;
  specialties: string[];
  hasBio: boolean;
  gallery: Array<{ id: string; imageUrl: string; altText: string | null }>;
};

export type CoverUploadState = {
  status: 'idle' | 'uploading' | 'error';
  error: string | null;
  note: string | null;
};

type BookingPageLayoutChooserProps = {
  draft: BookingPageConfigSide;
  content: BookingPageContentSide | null;
  preview: BookingPagePresentationPreview | null;
  disabled: boolean;
  /** Links to the canonical editors that own each record. */
  informationHref: string | null;
  textHref: string | null;
  portfolioHref: string | null;
  coverUpload: CoverUploadState;
  onConfigPatch: (patch: BookingPageDraftPatch) => void;
  onContentPatch: (patch: BookingPageContentPatch) => void;
  onUploadCover: (file: File) => void;
};

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const buttonClass = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--owner-line-strong)] bg-[var(--owner-surface)] px-4 py-2 text-sm font-semibold text-[var(--owner-ink)] disabled:opacity-50';
const linkClass = 'font-semibold text-[var(--owner-accent)] underline';

/** Maps the owner's chosen palette/style onto the shared `--qb-*` tokens. */
function presentationTokens(draft: BookingPageConfigSide): CSSProperties {
  const tokens = getCustomerSitePresentationCssVariables({
    palettePreset: draft.sitePalettePreset,
    stylePreset: draft.siteStylePreset,
  });
  return {
    '--qb-accent': tokens['--theme-primary-dark'],
    '--qb-secondary': tokens['--theme-primary-light'],
    '--qb-button': tokens['--theme-primary'],
    '--qb-button-text': tokens['--booking-brand-foreground'],
    '--qb-ground': tokens['--theme-background'],
    '--qb-surface': tokens['--theme-card-background'],
    '--qb-ink': tokens['--customer-site-ink'],
    '--qb-muted': tokens['--customer-site-muted'],
    '--qb-line': tokens['--theme-card-border'],
    '--qb-heading-font': tokens['--customer-site-heading-font'],
    '--qb-body-font': tokens['--customer-site-body-font'],
    '--qb-radius': tokens['--customer-site-card-radius'],
    '--qb-button-radius': tokens['--customer-site-button-radius'],
  } as CSSProperties;
}

function FocalPointControl({
  id,
  label,
  value,
  imageUrl,
  shape,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: QuickBookFocalPoint | null;
  imageUrl: string;
  shape: 'circle' | 'wide';
  disabled: boolean;
  onCommit: (value: QuickBookFocalPoint) => void;
}) {
  const fallback = shape === 'circle' ? { x: 50, y: 40 } : { x: 50, y: 50 };
  const [local, setLocal] = useState<QuickBookFocalPoint>(value ?? fallback);
  useEffect(() => {
    setLocal(value ?? fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync only when the saved value changes
  }, [value?.x, value?.y]);
  const update = (axis: 'x' | 'y', next: number) => {
    setLocal(current => ({ ...current, [axis]: next }));
  };
  return (
    <fieldset className="mt-3 grid gap-3 rounded-xl border border-[var(--owner-line)] p-3 sm:grid-cols-[auto_1fr]" data-testid={`${id}-reposition`} disabled={disabled}>
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">{label}</legend>
      <span
        aria-hidden="true"
        className={`block overflow-hidden border border-[var(--owner-line)] ${shape === 'circle' ? 'size-24 rounded-full' : 'h-24 w-40 rounded-lg'}`}
      >
        <img alt="" className="size-full object-cover" src={imageUrl} style={{ objectPosition: `${local.x}% ${local.y}%` }} />
      </span>
      <span className="grid gap-2 text-sm">
        <label className="grid gap-1">
          <span>Left ↔ right</span>
          <input max={100} min={0} onChange={event => update('x', Number(event.target.value))} onMouseUp={() => onCommit(local)} onTouchEnd={() => onCommit(local)} onKeyUp={() => onCommit(local)} step={5} type="range" value={local.x} />
        </label>
        <label className="grid gap-1">
          <span>Top ↕ bottom</span>
          <input max={100} min={0} onChange={event => update('y', Number(event.target.value))} onMouseUp={() => onCommit(local)} onTouchEnd={() => onCommit(local)} onKeyUp={() => onCommit(local)} step={5} type="range" value={local.y} />
        </label>
        <span className="text-xs text-[var(--owner-muted)]">Your original photo is kept. Only where it is centred changes.</span>
      </span>
    </fieldset>
  );
}

function LayoutCard({
  layout,
  selected,
  disabled,
  draft,
  content,
  preview,
  tokens,
  onSelect,
}: {
  layout: QuickBookLayoutDefinition;
  selected: boolean;
  disabled: boolean;
  draft: BookingPageConfigSide;
  content: BookingPageContentSide | null;
  preview: BookingPagePresentationPreview | null;
  tokens: CSSProperties;
  onSelect: () => void;
}) {
  const capabilities = describeQuickBookLayoutCapabilities(layout);
  const variationOf = layout.variationOf ? getQuickBookLayout(layout.variationOf as QuickBookSiteLayout) : null;
  return (
    <button
      aria-pressed={selected}
      className={`min-h-14 rounded-xl border p-3 text-left text-sm font-semibold disabled:opacity-50 ${selected ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent-strong)]' : 'border-[var(--owner-line-strong)] text-[var(--owner-ink)]'}`}
      data-testid={`quick-book-layout-option-${layout.id}`}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <QuickBookLayoutPoster
        businessName={preview?.salonName ?? 'Your business'}
        className="mb-2"
        coverUrl={content?.heroImageUrl ?? null}
        galleryCount={content?.galleryPhotoIds?.length ?? 0}
        hasStory={preview?.hasBio ?? false}
        layout={layout.id as QuickBookSiteLayout}
        logoUrl={preview?.logoUrl ?? null}
        portraitUrl={preview?.technicianPhotoUrl ?? null}
        portraitVisible={draft.quickBookProfile.showTechPhoto}
        specialties={preview?.specialties ?? []}
        style={tokens}
        technicianName={draft.quickBookProfile.showTechName ? preview?.technicianName ?? null : null}
      />
      <span className="block" data-testid={`appearance-option-label-${layout.id}`}>{layout.label}</span>
      <span className="mt-0.5 block text-xs font-normal text-[var(--owner-muted)]">{layout.description}</span>
      {capabilities.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {capabilities.map(capability => (
            <span className="rounded-full bg-[var(--owner-ground)] px-2 py-0.5 text-[11px] font-medium text-[var(--owner-muted)]" key={capability}>{capability}</span>
          ))}
        </span>
      )}
      {variationOf && <span className="mt-1 block text-[11px] font-normal text-[var(--owner-muted)]">{`A variation of ${variationOf.label}`}</span>}
      {selected && <span className="mt-1 block text-xs">✓ Selected</span>}
    </button>
  );
}

export function BookingPageLayoutChooser({
  draft,
  content,
  preview,
  disabled,
  informationHref,
  textHref,
  portfolioHref,
  coverUpload,
  onConfigPatch,
  onContentPatch,
  onUploadCover,
}: BookingPageLayoutChooserProps) {
  const selectedId = draft.quickBookLayout ?? 'clean_card';
  const selected = getQuickBookLayout(selectedId);
  const tokens = presentationTokens(draft);
  const coverInputId = useId();
  const [coverTextDraft, setCoverTextDraft] = useState(content?.coverText ?? '');
  useEffect(() => {
    setCoverTextDraft(content?.coverText ?? '');
  }, [content?.coverText]);

  const hasCustomPortrait = Boolean(preview?.technicianPhotoUrl);
  const portraitShown = draft.quickBookProfile.showTechPhoto && hasCustomPortrait;
  const coverUrl = content?.heroImageUrl ?? null;
  const galleryIds = content?.galleryPhotoIds ?? [];

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      onUploadCover(file);
    }
  };

  const toggleGalleryPhoto = (id: string) => {
    const next = galleryIds.includes(id)
      ? galleryIds.filter(item => item !== id)
      : [...galleryIds, id].slice(0, 5);
    onContentPatch({ galleryPhotoIds: next });
  };

  return (
    <div className="space-y-6" data-testid="quick-book-layout-chooser">
      {QUICK_BOOK_LAYOUT_FAMILIES.map((family) => {
        const meta = QUICK_BOOK_LAYOUT_FAMILY_LABELS[family];
        return (
          <fieldset className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4" data-testid={`quick-book-layout-family-${family}`} disabled={disabled} key={family}>
            <legend className="px-2 text-xl font-semibold">{meta.title}</legend>
            <p className="mb-3 text-xs text-[var(--owner-muted)]">{meta.description}</p>
            <div className="grid grid-cols-2 gap-3">
              {getQuickBookLayoutsByFamily(family).map(layout => (
                <LayoutCard
                  content={content}
                  disabled={disabled}
                  draft={draft}
                  key={layout.id}
                  layout={layout}
                  onSelect={() => {
                    if (layout.id !== selectedId) {
                      onConfigPatch({ quickBookLayout: layout.id as QuickBookSiteLayout });
                    }
                  }}
                  preview={preview}
                  selected={layout.id === selectedId}
                  tokens={tokens}
                />
              ))}
            </div>
          </fieldset>
        );
      })}

      <section aria-labelledby="quick-book-layout-images-heading" className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4" data-testid="quick-book-layout-images">
        <h3 className="text-lg font-semibold" id="quick-book-layout-images-heading">{`Images for ${selected.label}`}</h3>
        <p className="mt-1 text-xs text-[var(--owner-muted)]">Your uploads are shared by every layout. Switching layouts never removes them.</p>

        {/* Logo: never invented. */}
        <div className="mt-4 border-t border-[var(--owner-line)] pt-3" data-testid="quick-book-layout-logo">
          <p className="text-sm font-semibold">Business logo</p>
          {preview?.logoUrl
            ? <p className="text-sm text-[var(--owner-muted)]">Your logo is shown on this layout.</p>
            : (
                <p className="text-sm text-[var(--owner-muted)]">
                  No logo saved, so your business name is shown on its own.
                  {informationHref && (
                    <>
                      {' '}
                      <a className={linkClass} href={informationHref}>Add a logo in Your Information</a>
                      .
                    </>
                  )}
                </p>
              )}
        </div>

        {/* Profile photo */}
        {selected.portrait !== 'none' && (
          <div className="mt-4 border-t border-[var(--owner-line)] pt-3" data-testid="quick-book-layout-portrait">
            <p className="text-sm font-semibold">Profile photo · optional</p>
            <p className="text-xs text-[var(--owner-muted)]">Introduce yourself to your clients.</p>
            {portraitShown
              ? (
                  <>
                    <div className="mt-2 flex items-center gap-3">
                      <img alt="Your current profile" className="size-16 rounded-full border border-[var(--owner-line)] object-cover" src={preview?.technicianPhotoUrl ?? ''} style={{ objectPosition: content?.portraitFocalPoint ? `${content.portraitFocalPoint.x}% ${content.portraitFocalPoint.y}%` : '50% 40%' }} />
                      <p className="text-sm text-[var(--owner-muted)]">Showing your photo.</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className={buttonClass} data-testid="quick-book-portrait-use-default" onClick={() => onConfigPatch({ quickBookProfile: { showTechPhoto: false } })} type="button">
                        {selected.portrait === 'essential' ? 'Use default illustration instead' : 'Hide my photo'}
                      </button>
                      {informationHref && <a className={buttonClass} href={informationHref}>Replace photo</a>}
                    </div>
                    {preview?.technicianPhotoUrl && (
                      <FocalPointControl disabled={disabled} id="quick-book-portrait" imageUrl={preview.technicianPhotoUrl} label="Reposition your photo" onCommit={value => onContentPatch({ portraitFocalPoint: value })} shape="circle" value={content?.portraitFocalPoint ?? null} />
                    )}
                  </>
                )
              : (
                  <>
                    <p className="mt-2 flex items-start gap-2 rounded-xl bg-[var(--owner-ground)] p-3 text-sm" data-testid="quick-book-portrait-default-note">
                      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--owner-accent)]" />
                      <span>
                        {selected.portrait === 'essential'
                          ? 'Using a default profile illustration. Add your photo to personalise profile-led layouts. The illustration stays visible to clients until you do.'
                          : 'Your photo is not shown on this layout. Show it to add a personal touch.'}
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {hasCustomPortrait
                        ? <button className={buttonClass} data-testid="quick-book-portrait-show" onClick={() => onConfigPatch({ quickBookProfile: { showTechPhoto: true } })} type="button">Show my photo</button>
                        : informationHref && (
                          <a className={buttonClass} href={informationHref}>
                            <Upload aria-hidden="true" className="size-4" />
                            Add your photo in Your Information
                          </a>
                        )}
                    </div>
                  </>
                )}
          </div>
        )}

        {/* Cover photo */}
        <div className="mt-4 border-t border-[var(--owner-line)] pt-3" data-testid="quick-book-layout-cover">
          <p className="text-sm font-semibold">Cover photo · optional</p>
          <p className="text-xs text-[var(--owner-muted)]">A large photo of your work or studio, used in selected layouts.</p>
          {!selected.cover && coverUrl && (
            <p className="mt-2 text-sm text-[var(--owner-muted)]" data-testid="quick-book-cover-unused-note">Your cover is saved. This layout does not display it.</p>
          )}
          {!selected.cover && !coverUrl && (
            <p className="mt-2 text-sm text-[var(--owner-muted)]">This layout does not use a cover photo. Choose a cover-photo layout to add one.</p>
          )}
          {selected.cover && (
            <>
              {coverUrl
                ? (
                    <div className="mt-2 flex items-center gap-3">
                      <img alt="Your current cover" className="h-16 w-28 rounded-lg border border-[var(--owner-line)] object-cover" src={coverUrl} style={{ objectPosition: content?.coverFocalPoint ? `${content.coverFocalPoint.x}% ${content.coverFocalPoint.y}%` : '50% 50%' }} />
                      <p className="text-sm text-[var(--owner-muted)]">Showing your cover.</p>
                    </div>
                  )
                : (
                    <p className="mt-2 flex items-start gap-2 rounded-xl bg-[var(--owner-ground)] p-3 text-sm" data-testid="quick-book-cover-default-note">
                      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--owner-accent)]" />
                      <span>Using a default cover. It appears in cover-photo layouts until you replace it, and clients can see it in the meantime.</span>
                    </p>
                  )}
              <div className="mt-2 flex flex-wrap gap-2">
                <label className={`${buttonClass} cursor-pointer`} htmlFor={coverInputId}>
                  <Upload aria-hidden="true" className="size-4" />
                  {coverUpload.status === 'uploading' ? 'Uploading…' : coverUrl ? 'Replace cover' : 'Upload a cover'}
                  <input accept={IMAGE_ACCEPT} className="sr-only" data-testid="quick-book-cover-upload" disabled={disabled || coverUpload.status === 'uploading'} id={coverInputId} onChange={chooseFile} type="file" />
                </label>
                {coverUrl && (
                  <button className={buttonClass} data-testid="quick-book-cover-use-default" onClick={() => onContentPatch({ heroImageUrl: null })} type="button">Use default cover</button>
                )}
              </div>
              {coverUpload.status === 'error' && coverUpload.error && (
                <p className="mt-2 text-sm text-red-700" role="alert">{coverUpload.error}</p>
              )}
              {coverUpload.note && (
                <p className="mt-2 text-sm text-[var(--owner-muted)]">{coverUpload.note}</p>
              )}
              {coverUrl && (
                <FocalPointControl disabled={disabled} id="quick-book-cover" imageUrl={coverUrl} label="Reposition your cover" onCommit={value => onContentPatch({ coverFocalPoint: value })} shape="wide" value={content?.coverFocalPoint ?? null} />
              )}
            </>
          )}
        </div>

        {/* Cover writing */}
        {selected.coverText && (
          <fieldset className="mt-4 border-t border-[var(--owner-line)] pt-3" data-testid="quick-book-layout-cover-text">
            <legend className="text-sm font-semibold">Writing on the cover</legend>
            <div className="mt-2 grid gap-2 text-sm">
              {([
                ['website_copy', 'Use my website text', content?.specialtyLine ? `“${content.specialtyLine}”` : 'No website text saved yet.'],
                ['custom', 'Custom text', null],
                ['none', 'No writing', null],
              ] as const).map(([mode, label, hint]) => (
                <label className="flex min-h-11 items-start gap-2" key={mode}>
                  <input checked={(content?.coverTextMode ?? 'website_copy') === mode} className="mt-1" name="quick-book-cover-text-mode" onChange={() => onContentPatch({ coverTextMode: mode })} type="radio" value={mode} />
                  <span>
                    <span className="block font-medium">{label}</span>
                    {hint && (
                      <span className="block text-xs text-[var(--owner-muted)]">
                        {hint}
                        {!content?.specialtyLine && textHref && (
                          <>
                            {' '}
                            <a className={linkClass} href={textHref}>Add it in About &amp; Website Text</a>
                            .
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              {(content?.coverTextMode ?? 'website_copy') === 'custom' && (
                <label className="grid gap-1">
                  <span className="text-xs text-[var(--owner-muted)]">Short line shown on the cover (up to 120 characters)</span>
                  <input className="min-h-11 rounded-xl border border-[var(--owner-line-strong)] px-3" data-testid="quick-book-cover-text-input" maxLength={120} onBlur={() => onContentPatch({ coverText: coverTextDraft.trim() === '' ? null : coverTextDraft.trim() })} onChange={event => setCoverTextDraft(event.target.value)} type="text" value={coverTextDraft} />
                </label>
              )}
            </div>
          </fieldset>
        )}

        {/* Gallery strip */}
        {selected.gallery && (
          <div className="mt-4 border-t border-[var(--owner-line)] pt-3" data-testid="quick-book-layout-gallery">
            <p className="text-sm font-semibold">Gallery strip</p>
            {preview && preview.gallery.length > 0
              ? (
                  <>
                    <p className="text-xs text-[var(--owner-muted)]">Choose up to five portfolio photos in the order you want them shown. Default images are never added here.</p>
                    <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {preview.gallery.map((photo) => {
                        const position = galleryIds.indexOf(photo.id);
                        return (
                          <li key={photo.id}>
                            <button aria-pressed={position >= 0} className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 ${position >= 0 ? 'border-[var(--owner-accent)]' : 'border-transparent'}`} data-testid={`quick-book-gallery-option-${photo.id}`} onClick={() => toggleGalleryPhoto(photo.id)} type="button">
                              <img alt={photo.altText ?? 'Portfolio photo'} className="size-full object-cover" src={photo.imageUrl} />
                              {position >= 0 && <span className="absolute left-1 top-1 rounded-full bg-[var(--owner-accent)] px-1.5 text-[11px] font-semibold text-white">{position + 1}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )
              : (
                  <p className="mt-1 text-sm text-[var(--owner-muted)]">
                    No portfolio photos yet, so the strip stays hidden.
                    {portfolioHref && (
                      <>
                        {' '}
                        <a className={linkClass} href={portfolioHref}>Add photos in Photos &amp; Gallery</a>
                        .
                      </>
                    )}
                  </p>
                )}
          </div>
        )}
      </section>
    </div>
  );
}
