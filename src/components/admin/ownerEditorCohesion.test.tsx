import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingPageHub } from './BookingPageHub';

/**
 * r28 — the owner design system across the EDITOR surfaces.
 *
 * The workspace editors were painted from three unrelated palettes at once:
 * the iOS system colours (`#007AFF`, `#1C1C1E`, `#8E8E93`, `#F2F2F7`,
 * `#34C759`), eight saturated category gradients, and a stone/rose Tailwind
 * scale — next to onboarding, which is one warm plum system. This file is the
 * guard: it fails when a system colour or a decorative gradient comes back to
 * a surface that has been converted to the `--owner-*` token layer.
 */

const ROOT = join(__dirname, '..', '..', '..');

const CONVERTED_FILES = [
  'src/components/admin/ServicesModal.tsx',
  'src/components/admin/serviceLibrary/ServiceLibraryTab.tsx',
  'src/components/admin/serviceLibrary/AddOnCreateDialog.tsx',
  'src/components/admin/BookingPageHub.tsx',
  'src/components/admin/BookingPageAppearance.tsx',
  'src/components/admin/BookingPageInformationEditor.tsx',
  'src/app/[locale]/admin/booking-page/page.tsx',
  'src/components/admin/SettingsModal.tsx',
  'src/components/admin/IntegrationsModal.tsx',
  'src/components/admin/MarketingModal.tsx',
  'src/components/admin/ReviewsModal.tsx',
  'src/components/admin/RewardsModal.tsx',
  'src/components/admin/PortfolioModal.tsx',
];

/** The iOS system palette these surfaces used to be painted with. */
const SYSTEM_COLOURS = [
  '#007AFF',
  '#1C1C1E',
  '#8E8E93',
  '#636366',
  '#C7C7CC',
  '#D1D1D6',
  '#E5E5EA',
  '#E9E9EA',
  '#F2F2F7',
  '#34C759',
  '#AF52DE',
  '#5856D6',
  '#FF3B30',
  '#D70015',
];

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('owner editor cohesion', () => {
  it.each(CONVERTED_FILES)('%s carries no iOS system colour', (file) => {
    const source = read(file);
    const found = SYSTEM_COLOURS.filter(colour =>
      source.toUpperCase().includes(colour.toUpperCase()),
    );

    expect(found).toEqual([]);
  });

  it.each(CONVERTED_FILES)('%s paints no decorative colour gradient', (file) => {
    // `bg-gradient-to-*` with a hard-coded hex stop was the category tile and
    // the rewards stat tile; both are one blush tile with a plum glyph now.
    expect(read(file)).not.toMatch(/bg-gradient-to-\w[^`"']*from-\[#/u);
  });

  it.each(CONVERTED_FILES)(
    '%s never puts an opacity modifier on an --owner-* token',
    (file) => {
      // Tailwind cannot inject an alpha channel into `var(--x)`, so
      // `bg-[var(--owner-ground)]/80` silently renders nothing at all.
      expect(read(file)).not.toMatch(/\[var\(--owner-[a-z-]+\)\]\/\d/u);
    },
  );

  it('Settings rows paint one owner icon container, not a per-row colour', () => {
    const source = read('src/components/admin/SettingsModal.tsx');

    expect(source).toContain('const OWNER_ROW_ICON_CLASS');
    expect(source).toContain('bg-[var(--owner-blush)] text-[var(--owner-accent)]');
    // The old row rendered `className={`… ${iconColor}`}` — eleven saturated
    // squares in one screen.
    expect(source).not.toMatch(/rounded-\[6px\] text-white shadow-sm \$\{iconColor\}/u);
  });

  it('Settings toggles use the owner accent, never the iOS switch green', () => {
    const source = read('src/components/admin/SettingsModal.tsx');
    const trackStates = source.match(/'bg-\[var\(--owner-accent\)\]' : 'bg-\[var\(--owner-line\)\]'/gu);

    expect(trackStates).toHaveLength(2);
    expect(source).toContain('focus-visible:ring-[var(--owner-focus)]');
  });

  it('the Booking Page hub resolves the owner token layer', () => {
    // The hub is a standalone route, not an AppModal portal: without the scope
    // class every `var(--owner-*)` on it resolves to nothing.
    const { container } = render(
      <BookingPageHub
        hasDraftChanges={false}
        locale="en"
        published
        publicUrl="https://example.test/en/salon-a"
        salonName="Salon A"
        salonSlug="salon-a"
        setupUrl={null}
      />,
    );
    const main = container.querySelector('main');

    expect(main).toHaveClass('owner-workspace-theme');
    expect(main).toHaveAttribute('data-theme-scope', 'owner');
    expect(screen.getByRole('heading', { level: 1, name: 'Booking Page' })).toBeInTheDocument();
  });
});
