'use client';

import type { BookingPageConfigSide, BookingPageDraftPatch } from '@/libs/bookingPageConfig';
import type { BookingPageContentPatch, BookingPageContentSide } from '@/libs/bookingPageContent';
import {
  CUSTOMER_SITE_PALETTE_PRESETS,
  CUSTOMER_SITE_STYLE_PRESETS,
  getCustomerSitePresentationCssVariables,
} from '@/libs/customerSitePresentation';
import { SERVICE_MENU_LAYOUTS } from '@/libs/serviceMenuLayout';

import {
  BookingPageLayoutChooser,
  type BookingPagePresentationPreview,
  type CoverUploadState,
} from './BookingPageLayoutChooser';

const names: Record<string, string> = {
  luster_berry: 'Luster Berry',
  blush_cocoa: 'Blush & Cocoa',
  terracotta_cream: 'Terracotta & Cream',
  sage_stone: 'Sage & Stone',
  lilac_plum: 'Lilac & Plum',
  navy_ivory: 'Navy & Ivory',
  monochrome: 'Monochrome',
  black_champagne: 'Black & Champagne',
  visual_grid: 'Visual Grid',
  clean_list: 'Clean List',
  editorial_cards: 'Editorial Cards',
  category_menu: 'Category Menu',
  editorial_price_list: 'Editorial Price List',
};

/**
 * AG-hub-publish-04 — a presentation chooser has to show what it is choosing.
 *
 * Both groups render the same miniature card through the SAME resolver the
 * customer site uses (`getCustomerSitePresentationCssVariables`), so a
 * specimen can never drift from what publishing actually produces:
 *
 *   - "Choose your style" holds the owner's current palette constant and
 *     varies the style, so the heading typeface, card corner radius and
 *     button shape are the only things that differ between cards.
 *   - "Choose your colours" holds the style constant and varies the palette,
 *     painting THREE stops (page ground, primary button, secondary accent)
 *     instead of the single `--booking-brand-primary` bar that used to hide
 *     the second half of every paired palette name — "Navy & Ivory" showed
 *     navy only, "Black & Champagne" champagne only.
 *
 * The specimen is `aria-hidden` throughout, so each card's accessible name
 * stays the style/palette name on its own.
 */
function PresetSpecimen({ tokens, value }: { tokens: Record<string, string>; value: string }) {
  return (
    <span
      aria-hidden="true"
      className="mb-2 block overflow-hidden border p-1.5"
      data-testid={`appearance-specimen-${value}`}
      style={{
        backgroundColor: tokens['--theme-background'],
        borderColor: tokens['--theme-card-border'],
        borderRadius: tokens['--customer-site-card-radius'],
      }}
    >
      <span
        className="flex items-center gap-1.5 border px-1.5 py-1"
        data-specimen-role="surface"
        style={{
          backgroundColor: tokens['--theme-card-background'],
          borderColor: tokens['--theme-card-border'],
          borderRadius: tokens['--customer-site-card-radius'],
        }}
      >
        <span
          className="text-sm font-semibold leading-none"
          data-specimen-role="heading"
          style={{
            color: tokens['--customer-site-ink'],
            fontFamily: tokens['--customer-site-heading-font'],
          }}
        >
          Aa
        </span>
        <span
          className="h-3.5 w-8"
          data-specimen-role="primary"
          style={{
            backgroundColor: tokens['--theme-primary'],
            borderRadius: tokens['--customer-site-button-radius'],
          }}
        />
        <span
          className="size-3.5 rounded-full"
          data-specimen-role="secondary"
          style={{ backgroundColor: tokens['--theme-primary-light'] }}
        />
      </span>
    </span>
  );
}

const IDLE_COVER_UPLOAD: CoverUploadState = { status: 'idle', error: null, note: null };

export function BookingPageAppearance({
  draft,
  disabled,
  mode,
  onChange,
  content = null,
  presentationPreview = null,
  onContentChange,
  onUploadCover,
  coverUpload = IDLE_COVER_UPLOAD,
  informationHref = null,
  textHref = null,
  portfolioHref = null,
}: {
  draft: BookingPageConfigSide;
  disabled: boolean;
  mode: 'layouts' | 'appearance';
  onChange: (patch: BookingPageDraftPatch) => void;
  /** Draft content (cover, focal points, cover writing, gallery) for the Layouts chooser. */
  content?: BookingPageContentSide | null;
  presentationPreview?: BookingPagePresentationPreview | null;
  onContentChange?: (patch: BookingPageContentPatch) => void;
  onUploadCover?: (file: File) => void;
  coverUpload?: CoverUploadState;
  informationHref?: string | null;
  textHref?: string | null;
  portfolioHref?: string | null;
}) {
  const groups = mode === 'layouts'
    ? [
        { key: 'serviceMenuLayout' as const, title: 'Booking menu layout', values: SERVICE_MENU_LAYOUTS, selected: draft.serviceMenuLayout },
      ]
    : [
        { key: 'siteStylePreset' as const, title: 'Choose your style', values: CUSTOMER_SITE_STYLE_PRESETS, selected: draft.siteStylePreset ?? 'modern' },
        { key: 'sitePalettePreset' as const, title: 'Choose your colours', values: CUSTOMER_SITE_PALETTE_PRESETS, selected: draft.sitePalettePreset ?? 'luster_berry' },
      ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--owner-muted)]">These choices change presentation only. Your business details and services stay the same. Preview your draft before publishing.</p>
      {mode === 'layouts' && draft.layout === 'quick_book' && (
        <BookingPageLayoutChooser
          content={content}
          coverUpload={coverUpload}
          disabled={disabled}
          draft={draft}
          informationHref={informationHref}
          onConfigPatch={onChange}
          onContentPatch={patch => onContentChange?.(patch)}
          onUploadCover={file => onUploadCover?.(file)}
          portfolioHref={portfolioHref}
          preview={presentationPreview}
          textHref={textHref}
        />
      )}
      {groups.map(group => (
        <fieldset className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4" disabled={disabled} key={group.key}>
          <legend className="px-2 text-xl font-semibold">{group.title}</legend>
          {group.key === 'siteStylePreset' && (
            <p className="mb-3 text-xs text-[var(--owner-muted)]">Every sample uses your chosen colours, so only the lettering, corners and button shape change.</p>
          )}
          {group.key === 'sitePalettePreset' && (
            <p className="mb-3 text-xs text-[var(--owner-muted)]">Every sample shows that palette's page background, button colour and accent colour.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {group.values.map((value) => {
              const tokens = group.key === 'siteStylePreset'
                ? getCustomerSitePresentationCssVariables({ palettePreset: draft.sitePalettePreset, stylePreset: value })
                : group.key === 'sitePalettePreset'
                  ? getCustomerSitePresentationCssVariables({ palettePreset: value, stylePreset: draft.siteStylePreset })
                  : null;
              return (
                <button
                  aria-pressed={group.selected === value}
                  className={`min-h-14 rounded-xl border p-3 text-left text-sm font-semibold disabled:opacity-50 ${group.selected === value ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent-strong)]' : 'border-[var(--owner-line-strong)] text-[var(--owner-ink)]'}`}
                  key={value}
                  onClick={() => onChange({ [group.key]: value } as BookingPageDraftPatch)}
                  type="button"
                >
                  {tokens && <PresetSpecimen tokens={tokens} value={value} />}
                  {/* A style card shows its look: the name is set in that style's own display face. */}
                  <span
                    data-testid={`appearance-option-label-${value}`}
                    style={group.key === 'siteStylePreset' && tokens
                      ? { fontFamily: tokens['--customer-site-heading-font'] }
                      : undefined}
                  >
                    {names[value] ?? `${value[0]?.toUpperCase()}${value.slice(1)}`}
                  </span>
                  {group.selected === value && <span className="mt-1 block text-xs">✓ Selected</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
