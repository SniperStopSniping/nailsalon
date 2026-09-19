/**
 * The registry is the ONLY way the model can point an owner anywhere, so a
 * stale target is not a cosmetic bug — it is the assistant confidently sending
 * someone to a screen that does not open.
 *
 * Every id the registry emits is pinned here against the admin shell's own
 * allowlists, duplicated as constants (the shell files are client components
 * full of JSX and cannot be imported into a node-environment test). A drift in
 * either direction fails: the duplicated constant is also asserted to still
 * match the source file's text, so this test cannot rot into a tautology.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildRegistryHref,
  getRegistryEntry,
  isRegistryKey,
  OWNER_ASSISTANT_REGISTRY,
  searchRegistry,
} from './registry';

/** Source: `URL_APP_IDS` in src/app/[locale]/admin/page.tsx. */
const URL_APP_IDS = [
  'hours',
  'booking-rules',
  'plan-usage',
  'help',
  'bookings',
  'schedule',
  'settings',
  'analytics',
  'clients',
  'staff',
  'services',
  'marketing',
  'reviews',
  'rewards',
  'rewards-reviews',
  'staff-ops',
  'team',
  'payments',
  'integrations',
  'portfolio',
] as const;

/** Source: `SETTINGS_VIEW_IDS` in src/components/admin/SettingsModal.tsx. */
const SETTINGS_VIEW_IDS = [
  'index',
  'business',
  'business-profile',
  'booking-availability',
  'messages',
  'advanced',
  'account',
  'location',
  'branding',
  'booking',
  'booking-policy',
  'booking-flow',
  'smart-fit',
  'payments',
  'notifications',
  'communications',
  'review-requests',
  'features',
  'visibility',
] as const;

/** Source: the `panel` allowlist in src/app/[locale]/admin/booking-page/page.tsx. */
const BOOKING_PAGE_PANEL_IDS = [
  'business',
  'layouts',
  'appearance',
  'information',
  'text',
  'gallery',
  'policies',
  'publish',
] as const;

function sourceText(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('the duplicated allowlists still match their source files', () => {
  it('pins URL_APP_IDS to the admin page', () => {
    const source = sourceText('src/app/[locale]/admin/page.tsx');
    const declared = /const URL_APP_IDS = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? '';
    const ids = [...declared.matchAll(/'([a-z-]+)'/g)].map(match => match[1]);

    expect(ids).toEqual([...URL_APP_IDS]);
  });

  it('pins SETTINGS_VIEW_IDS to the settings modal', () => {
    const source = sourceText('src/components/admin/SettingsModal.tsx');
    const declared = /const SETTINGS_VIEW_IDS: readonly SettingsView\[\] = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    const ids = [...declared.matchAll(/'([a-z-]+)'/g)].map(match => match[1]);

    expect(ids).toEqual([...SETTINGS_VIEW_IDS]);
  });

  it('pins the booking-page panel allowlist to the booking-page route', () => {
    const source = sourceText('src/app/[locale]/admin/booking-page/page.tsx');

    for (const panel of BOOKING_PAGE_PANEL_IDS) {
      expect(source, panel).toContain(`'${panel}'`);
    }

    expect(source).toContain(
      `['business', 'layouts', 'appearance', 'information', 'text', 'gallery', 'policies', 'publish'].includes(`,
    );
  });
});

describe('every registry target resolves against the shell allowlists', () => {
  it('has unique keys', () => {
    const keys = OWNER_ASSISTANT_REGISTRY.map(entry => entry.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(OWNER_ASSISTANT_REGISTRY.map(entry => [entry.key, entry] as const))(
    '%s uses only addressable ids',
    (_key, entry) => {
      if (entry.target.type === 'admin') {
        if (entry.target.app !== undefined) {
          expect(URL_APP_IDS as readonly string[]).toContain(entry.target.app);
        }
        if (entry.target.view !== undefined) {
          // Settings tracks `view=` live; Team reads it once at open and only
          // for `permissions`, which is not a Settings view id.
          const allowed = entry.target.app === 'settings'
            ? (SETTINGS_VIEW_IDS as readonly string[])
            : entry.target.app === 'booking-rules'
              ? ['rules', 'policies']
              : entry.target.app === 'hours'
                ? ['working-hours', 'time-off', 'requests']
                : entry.target.app === 'marketing' ? ['reviews'] : ['permissions'];

          expect(allowed).toContain(entry.target.view);
        }
      }

      if (entry.target.type === 'bookingPage') {
        expect(BOOKING_PAGE_PANEL_IDS as readonly string[]).toContain(entry.target.panel);
      }

      if (entry.target.type === 'path') {
        expect(entry.target.path.startsWith('/admin/')).toBe(true);
      }
    },
  );

  it.each(OWNER_ASSISTANT_REGISTRY.map(entry => [entry.key, entry] as const))(
    '%s builds a well-formed href',
    (key, entry) => {
      const href = buildRegistryHref(entry, { locale: 'en', salonSlug: 'isla-nail-studio' });

      expect(href).not.toBeNull();

      const url = new URL(href as string, 'https://app.test');

      expect(url.pathname.startsWith('/en/admin')).toBe(true);
      expect(url.searchParams.get('salon')).toBe('isla-nail-studio');
      expect(isRegistryKey(key)).toBe(true);
    },
  );

  it('encodes the salon slug rather than interpolating it', () => {
    const href = buildRegistryHref('services', { locale: 'en', salonSlug: 'a b&c' });

    expect(href).toBe('/en/admin?salon=a+b%26c&app=services');
  });

  it('honours the fr locale and falls back to en for anything else', () => {
    expect(buildRegistryHref('services', { locale: 'fr', salonSlug: 'isla' })).toContain('/fr/admin');
    expect(buildRegistryHref('services', { locale: 'de', salonSlug: 'isla' })).toContain('/en/admin');
  });

  it('returns null for a key that is not in the registry', () => {
    expect(buildRegistryHref('not_a_key', { locale: 'en', salonSlug: 'isla' })).toBeNull();
    expect(getRegistryEntry('not_a_key')).toBeNull();
    expect(isRegistryKey('not_a_key')).toBe(false);
  });

  it('carries path query parameters through', () => {
    expect(buildRegistryHref('policies_photos', { locale: 'en', salonSlug: 'isla' }))
      .toBe('/en/admin/policies?salon=isla&section=photos');
  });
});

describe('searchRegistry answers the questions this slice must handle', () => {
  it.each([
    ['logo', 'page_gallery'],
    ['upload my logo', 'page_gallery'],
    ['hours', 'business_hours'],
    ['minimum notice', 'booking_rules'],
    ['address privacy', 'page_information'],
    ['hide address', 'page_information'],
    ['publish', 'page_publish'],
  ])('%s → %s', (query, expectedKey) => {
    expect(searchRegistry(query)[0]?.key).toBe(expectedKey);
  });

  it('returns at most the requested number of matches', () => {
    expect(searchRegistry('booking', 5).length).toBeLessThanOrEqual(5);
    expect(searchRegistry('booking', 2).length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(searchRegistry('')).toEqual([]);
    expect(searchRegistry('   ')).toEqual([]);
    expect(searchRegistry('!!!')).toEqual([]);
  });

  it('returns nothing rather than a bad guess for an unrelated query', () => {
    expect(searchRegistry('zzzzqqq')).toEqual([]);
  });

  it('is deterministic for the same query', () => {
    expect(searchRegistry('hours').map(entry => entry.key))
      .toEqual(searchRegistry('hours').map(entry => entry.key));
  });
});

describe('owner IA stable destination keys', () => {
  it.each([
    ['business_hours', 'hours', null],
    ['booking_rules', 'booking-rules', 'rules'],
    ['settings_booking_policy', 'booking-rules', 'policies'],
    ['settings_review_requests', 'marketing', 'reviews'],
  ])('resolves %s to its canonical screen without changing the key', (key, app, view) => {
    const href = buildRegistryHref(key!, { locale: 'fr', salonSlug: 'studio & nails' });
    const url = new URL(href!, 'https://luster.test');

    expect(url.pathname).toBe('/fr/admin');
    expect(url.searchParams.get('salon')).toBe('studio & nails');
    expect(url.searchParams.get('app')).toBe(app);
    expect(url.searchParams.get('view')).toBe(view);
  });
});
