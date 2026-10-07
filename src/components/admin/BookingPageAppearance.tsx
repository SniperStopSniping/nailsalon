'use client';

import type { BookingPageConfigSide, BookingPageDraftPatch } from '@/libs/bookingPageConfig';
import type { BookingPageContentPatch, BookingPageContentSide } from '@/libs/bookingPageContent';
import {
  CUSTOMER_SITE_BODY_FONT_PRESETS,
  CUSTOMER_SITE_PALETTE_PRESETS,
  CUSTOMER_SITE_STYLE_PRESETS,
  getCustomerSitePresentationCssVariables,
} from '@/libs/customerSitePresentation';
import { SERVICE_MENU_LAYOUTS } from '@/libs/serviceMenuLayout';

import {
  BookingPageLayoutChooser,
  type BookingPagePresentationPreview,
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
  inter: 'Inter',
  nunito: 'Nunito',
  outfit: 'Outfit',
};

const headingFontNames: Record<(typeof CUSTOMER_SITE_STYLE_PRESETS)[number], string> = {
  bold: 'Archivo',
  editorial: 'Newsreader',
  luxury: 'Playfair Display',
  minimal: 'Inter',
  modern: 'Outfit',
  soft: 'Nunito',
};

/**
 * AG-hub-publish-04 — a presentation chooser has to show what it is choosing.
 *
 * Every group renders the same miniature card through the SAME resolver the
 * customer site uses (`getCustomerSitePresentationCssVariables`), so a
 * specimen can never drift from what publishing actually produces:
 *
 *   - "Choose your style" holds the owner's current palette and fonts
 *     constant, varying card corner radius and button shape only.
 *   - "Choose your colours" holds the style constant and varies the palette,
 *     painting THREE stops (page ground, primary button, secondary accent)
 *     instead of the single `--booking-brand-primary` bar that used to hide
 *     the second half of every paired palette name — "Navy & Ivory" showed
 *     navy only, "Black & Champagne" champagne only.
 *   - "Choose your fonts" holds the current style and palette constant and
 *     varies either the heading or body typeface.
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
          className="text-[9px] leading-none"
          data-specimen-role="body"
          style={{
            color: tokens['--customer-site-muted'],
            fontFamily: tokens['--customer-site-body-font'],
          }}
        >
          Book now
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

export function BookingPageAppearance({
  draft,
  disabled,
  mode,
  onChange,
  content = null,
  presentationPreview = null,
  onContentChange,
  photosHref = null,
  textHref = null,
  portfolioHref = null,
  customIsla = false,
}: {
  draft: BookingPageConfigSide;
  disabled: boolean;
  mode: 'layouts' | 'appearance';
  onChange: (patch: BookingPageDraftPatch) => void;
  /** Draft content (cover, focal points, cover writing, gallery) for the Layouts chooser. */
  content?: BookingPageContentSide | null;
  presentationPreview?: BookingPagePresentationPreview | null;
  onContentChange?: (patch: BookingPageContentPatch) => void;
  photosHref?: string | null;
  textHref?: string | null;
  portfolioHref?: string | null;
  customIsla?: boolean;
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
      <p className="text-sm text-[var(--owner-muted)]">
        {customIsla
          ? 'These styles apply after service selection, including the artist, time and confirmation steps. Isla’s custom opening page keeps its cream, gold and black design. Changes go live when you publish.'
          : 'These choices change presentation only. Your business details and services stay the same. Preview your draft before publishing.'}
      </p>
      {mode === 'layouts' && draft.layout === 'quick_book' && (
        <BookingPageLayoutChooser
          content={content}
          disabled={disabled}
          draft={draft}
          onConfigPatch={onChange}
          onContentPatch={patch => onContentChange?.(patch)}
          photosHref={photosHref}
          portfolioHref={portfolioHref}
          preview={presentationPreview}
          textHref={textHref}
        />
      )}
      {groups.map(group => (
        <fieldset className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4" disabled={disabled} key={group.key}>
          <legend className="px-2 text-xl font-semibold">{group.title}</legend>
          {group.key === 'siteStylePreset' && (
            <p className="mb-3 text-xs text-[var(--owner-muted)]">Styles set the corners, button shape and starting heading font. Your chosen fonts remain when you switch styles.</p>
          )}
          {group.key === 'sitePalettePreset' && (
            <p className="mb-3 text-xs text-[var(--owner-muted)]">Every sample shows that palette's page background, button colour and accent colour.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {group.values.map((value) => {
              const tokens = group.key === 'siteStylePreset'
                ? getCustomerSitePresentationCssVariables({
                  bodyFont: draft.siteBodyFont,
                  headingFont: draft.siteHeadingFont,
                  palettePreset: draft.sitePalettePreset,
                  stylePreset: value,
                })
                : group.key === 'sitePalettePreset'
                  ? getCustomerSitePresentationCssVariables({
                    bodyFont: draft.siteBodyFont,
                    headingFont: draft.siteHeadingFont,
                    palettePreset: value,
                    stylePreset: draft.siteStylePreset,
                  })
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
      {mode === 'appearance' && (
        <fieldset className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4" disabled={disabled}>
          <legend className="px-2 text-xl font-semibold">Choose your fonts</legend>
          <p className="mb-4 text-xs text-[var(--owner-muted)]">Choose a display font for headings and a readable font for booking details. Your style and colours stay the same.</p>
          <div className="space-y-5">
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--owner-ink)]">Heading font</h3>
                {draft.siteHeadingFont && (
                  <button className="text-sm font-semibold text-[var(--owner-accent)] underline" onClick={() => onChange({ siteHeadingFont: null })} type="button">
                    Follow style font
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CUSTOMER_SITE_STYLE_PRESETS.map((value) => {
                  const selected = (draft.siteHeadingFont ?? draft.siteStylePreset ?? 'modern') === value;
                  const tokens = getCustomerSitePresentationCssVariables({
                    bodyFont: draft.siteBodyFont,
                    headingFont: value,
                    palettePreset: draft.sitePalettePreset,
                    stylePreset: draft.siteStylePreset,
                  });
                  return (
                    <button
                      aria-label={`${headingFontNames[value]} heading font`}
                      aria-pressed={selected}
                      className={`min-h-14 rounded-xl border p-3 text-left text-sm font-semibold disabled:opacity-50 ${selected ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent-strong)]' : 'border-[var(--owner-line-strong)] text-[var(--owner-ink)]'}`}
                      key={value}
                      onClick={() => onChange({ siteHeadingFont: value })}
                      type="button"
                    >
                      <PresetSpecimen tokens={tokens} value={`heading-${value}`} />
                      <span style={{ fontFamily: tokens['--customer-site-heading-font'] }}>{headingFontNames[value]}</span>
                      {selected && <span className="mt-1 block text-xs">✓ Selected</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-[var(--owner-ink)]">Body font</h3>
              <div className="grid grid-cols-3 gap-3">
                {CUSTOMER_SITE_BODY_FONT_PRESETS.map((value) => {
                  const selected = (draft.siteBodyFont ?? 'inter') === value;
                  const tokens = getCustomerSitePresentationCssVariables({
                    bodyFont: value,
                    headingFont: draft.siteHeadingFont,
                    palettePreset: draft.sitePalettePreset,
                    stylePreset: draft.siteStylePreset,
                  });
                  return (
                    <button
                      aria-label={`${names[value]} body font`}
                      aria-pressed={selected}
                      className={`min-h-14 rounded-xl border p-3 text-left text-sm font-semibold disabled:opacity-50 ${selected ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)] text-[var(--owner-accent-strong)]' : 'border-[var(--owner-line-strong)] text-[var(--owner-ink)]'}`}
                      key={value}
                      onClick={() => onChange({ siteBodyFont: value })}
                      type="button"
                    >
                      <PresetSpecimen tokens={tokens} value={`body-${value}`} />
                      <span style={{ fontFamily: tokens['--customer-site-body-font'] }}>{names[value]}</span>
                      {selected && <span className="mt-1 block text-xs">✓ Selected</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}
