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
          <div className="grid grid-cols-2 gap-3">
            {group.values.map((value) => {
              const palette = group.key === 'sitePalettePreset' ? getCustomerSitePresentationCssVariables({ palettePreset: value, stylePreset: draft.siteStylePreset }) : null;
              return (
                <button
                  aria-pressed={group.selected === value}
                  className={`min-h-14 rounded-xl border p-3 text-left text-sm font-semibold disabled:opacity-50 ${group.selected === value ? 'border-rose-800 bg-rose-50 text-rose-900' : 'border-stone-300 text-stone-900'}`}
                  key={value}
                  onClick={() => onChange({ [group.key]: value } as BookingPageDraftPatch)}
                  type="button"
                >
                  {palette && <span aria-hidden="true" className="mb-2 block h-5 rounded border border-stone-200" style={{ backgroundColor: palette['--booking-brand-primary'] }} />}
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
