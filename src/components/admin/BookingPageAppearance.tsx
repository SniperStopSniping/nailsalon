'use client';

import type { BookingPageConfigSide, BookingPageDraftPatch } from '@/libs/bookingPageConfig';
import {
  CUSTOMER_SITE_PALETTE_PRESETS,
  CUSTOMER_SITE_STYLE_PRESETS,
  getCustomerSitePresentationCssVariables,
} from '@/libs/customerSitePresentation';
import { QUICK_BOOK_SITE_LAYOUTS } from '@/libs/quickBookSiteLayout';
import { SERVICE_MENU_LAYOUTS } from '@/libs/serviceMenuLayout';

const names: Record<string, string> = {
  luster_berry: 'Luster Berry',
  blush_cocoa: 'Blush & Cocoa',
  terracotta_cream: 'Terracotta & Cream',
  sage_stone: 'Sage & Stone',
  lilac_plum: 'Lilac & Plum',
  navy_ivory: 'Navy & Ivory',
  monochrome: 'Monochrome',
  black_champagne: 'Black & Champagne',
  compact_dropdown: 'Compact Dropdown',
  clean_card: 'Clean Card',
  editorial: 'Editorial',
  hub_menu: 'Hub Menu',
  profile_story: 'Profile Story',
  ultra_minimal: 'Ultra Minimal',
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

export function BookingPageAppearance({ draft, disabled, mode, onChange }: {
  draft: BookingPageConfigSide;
  disabled: boolean;
  mode: 'layouts' | 'appearance';
  onChange: (patch: BookingPageDraftPatch) => void;
}) {
  const groups = mode === 'layouts'
    ? [
        ...(draft.layout === 'quick_book' ? [{ key: 'quickBookLayout' as const, title: 'Site layout', values: QUICK_BOOK_SITE_LAYOUTS, selected: draft.quickBookLayout ?? 'clean_card' }] : []),
        { key: 'serviceMenuLayout' as const, title: 'Booking menu layout', values: SERVICE_MENU_LAYOUTS, selected: draft.serviceMenuLayout },
      ]
    : [
        { key: 'siteStylePreset' as const, title: 'Choose your style', values: CUSTOMER_SITE_STYLE_PRESETS, selected: draft.siteStylePreset ?? 'modern' },
        { key: 'sitePalettePreset' as const, title: 'Choose your colours', values: CUSTOMER_SITE_PALETTE_PRESETS, selected: draft.sitePalettePreset ?? 'luster_berry' },
      ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600">These choices change presentation only. Your business details and services stay the same. Preview your draft before publishing.</p>
      {groups.map(group => (
        <fieldset className="rounded-2xl border border-stone-200 bg-white p-4" disabled={disabled} key={group.key}>
          <legend className="px-2 text-xl font-semibold">{group.title}</legend>
          {group.key === 'siteStylePreset' && (
            <p className="mb-3 text-xs text-stone-500">Every sample uses your chosen colours, so only the lettering, corners and button shape change.</p>
          )}
          {group.key === 'sitePalettePreset' && (
            <p className="mb-3 text-xs text-stone-500">Every sample shows that palette's page background, button colour and accent colour.</p>
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
                  className={`min-h-14 rounded-xl border p-3 text-left text-sm font-semibold disabled:opacity-50 ${group.selected === value ? 'border-rose-800 bg-rose-50 text-rose-900' : 'border-stone-300 text-stone-900'}`}
                  key={value}
                  onClick={() => onChange({ [group.key]: value } as BookingPageDraftPatch)}
                  type="button"
                >
                  {tokens && <PresetSpecimen tokens={tokens} value={value} />}
                  {names[value] ?? `${value[0]?.toUpperCase()}${value.slice(1)}`}
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
