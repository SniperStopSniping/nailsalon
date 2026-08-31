/**
 * Component coverage for the owner Section Gallery.
 *
 * The route itself cannot be driven in a browser on this machine (the Clerk
 * dev-instance handshake loops on plain http://localhost — a pre-existing
 * condition verified at the base commit and recorded in the evidence), so
 * the gallery's behaviour is pinned here: it lists all twenty sections,
 * previews the selected one through the real customer renderer, exposes the
 * full style/palette/device matrix, tells the truth about sample content,
 * and refuses to fake Custom Design artwork.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider',
  () => ({
    CustomDesignAssetProvider: ({ children }: { children: React.ReactNode }) => children,
    useCustomDesignAssetMap: () => new Map(),
  }),
);

import { SECTION_LIBRARY_REGISTRY } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/section-library/registry';
import { WEBSITE_RECIPES } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/model/section-library/recipes';
import { SITE_PALETTE_PRESETS } from '../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/palettes';

import { SectionGalleryClient } from './SectionGalleryClient';

afterEach(() => {
  cleanup();
});

describe('SectionGalleryClient', () => {
  it('lists all twenty sections in the responsibility-matrix order', () => {
    render(<SectionGalleryClient />);
    const list = screen.getByRole('navigation', { name: 'Sections' });
    const items = within(list).getAllByRole('button');

    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent('Announcement Bar');
    expect(items[1]).toHaveTextContent('Hero');
    expect(items.at(-1)).toHaveTextContent('Footer');

    // Every library type is present, plus the two engine sections.
    const labels = items.map(item => item.textContent ?? '');
    for (const entry of Object.values(SECTION_LIBRARY_REGISTRY)) {
      expect(
        labels.some(label => label.includes(entry.label)),
        `${entry.label} missing from the gallery`,
      ).toBe(true);
    }
    expect(labels.some(label => label.includes('Services & Booking'))).toBe(true);
    expect(labels.some(label => label.includes('Custom Design'))).toBe(true);
  });

  it('previews the selected section through the real customer renderer', () => {
    render(<SectionGalleryClient />);
    fireEvent.click(screen.getByRole('button', { name: /Reviews/ }));

    expect(screen.getByRole('heading', { level: 2, name: 'Reviews' })).toBeInTheDocument();
    // Sample-content sections say so plainly.
    expect(screen.getByText(/Shown with sample content/)).toBeInTheDocument();
    // The real renderer is used — demo reviews are on screen.
    expect(screen.getByText(/most meticulous Russian manicure/)).toBeInTheDocument();
  });

  it('offers every style, palette, and device, and applies the chosen palette', () => {
    const { container } = render(<SectionGalleryClient />);

    const styles = within(screen.getByRole('group', { name: 'Style' })).getAllByRole('button');
    const palettes = within(screen.getByRole('group', { name: 'Palette' })).getAllByRole('button');
    const devices = within(screen.getByRole('group', { name: 'Device' })).getAllByRole('button');
    expect(styles).toHaveLength(6);
    expect(palettes).toHaveLength(SITE_PALETTE_PRESETS.length);
    expect(devices).toHaveLength(3);

    const champagne = SITE_PALETTE_PRESETS.find(preset => preset.id === 'black_champagne')!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(champagne.label) }));

    const preview = container.querySelector('.onboarding-site-preview');
    expect(preview?.getAttribute('style')).toContain(
      `--customer-accent: ${champagne.roles.accent}`,
    );
  });

  it('refuses to fake Custom Design artwork', () => {
    render(<SectionGalleryClient />);
    fireEvent.click(screen.getByRole('button', { name: /Custom Design/ }));

    expect(screen.getByRole('heading', {
      name: /previews with your artwork only/i,
    })).toBeInTheDocument();
    expect(screen.queryByText(/Shown with sample content/)).not.toBeInTheDocument();
  });

  it('shows the six complete websites, each built from registered sections', () => {
    render(<SectionGalleryClient />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete websites' }));

    const list = screen.getByRole('navigation', { name: 'Website recipes' });
    const recipes = within(list).getAllByRole('button');
    expect(recipes).toHaveLength(WEBSITE_RECIPES.length);
    expect(recipes[0]).toHaveTextContent('Quick Book');

    fireEvent.click(screen.getByRole('button', { name: /Promo Led/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Promo Led' })).toBeInTheDocument();
    // The recipe renders real sections, not a description of them.
    expect(screen.getByText('Current offers')).toBeInTheDocument();
  });
});
