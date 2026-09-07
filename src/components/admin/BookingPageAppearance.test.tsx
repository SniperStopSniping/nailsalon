import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { getCustomerSitePresentationCssVariables } from '@/libs/customerSitePresentation';
import { QUICK_BOOK_SITE_LAYOUTS } from '@/libs/quickBookSiteLayout';

import { BookingPageAppearance } from './BookingPageAppearance';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

describe('Booking Page appearance', () => {
  it('uses the shared six styles and eight palettes and writes only the chosen field', () => {
    const onChange = vi.fn();
    const draft = resolveBookingPageConfig({}).draft;
    const before = JSON.stringify(draft);
    render(<BookingPageAppearance disabled={false} draft={draft} mode="appearance" onChange={onChange} />);

    expect(screen.getAllByRole('button')).toHaveLength(14);

    fireEvent.click(screen.getByRole('button', { name: 'Luxury' }));

    expect(onChange).toHaveBeenLastCalledWith({ siteStylePreset: 'luxury' });

    fireEvent.click(screen.getByRole('button', { name: 'Black & Champagne' }));

    expect(onChange).toHaveBeenLastCalledWith({ sitePalettePreset: 'black_champagne' });
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('keeps every registered site composition independent from the five booking menus', () => {
    const onChange = vi.fn();
    const draft = resolveBookingPageConfig({}).draft;
    render(<BookingPageAppearance disabled={false} draft={draft} mode="layouts" onChange={onChange} />);

    // 22 site layouts (the six originals plus the design-system compositions)
    // and the five booking-menu layouts stay two independent choices.
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(2);
    expect(screen.getAllByRole('button').filter(button => button.hasAttribute('aria-pressed'))).toHaveLength(QUICK_BOOK_SITE_LAYOUTS.length + 5);

    fireEvent.click(screen.getByRole('button', { name: /^Profile Story/u }));

    expect(onChange).toHaveBeenLastCalledWith({ quickBookLayout: 'profile_story' });

    fireEvent.click(screen.getByRole('button', { name: /^Editorial Price List/u }));

    expect(onChange).toHaveBeenLastCalledWith({ serviceMenuLayout: 'editorial_price_list' });
  });

  // AG-hub-publish-04
  it('paints every palette card with its ground, button and accent colours, not one stop', () => {
    const draft = resolveBookingPageConfig({}).draft;
    render(<BookingPageAppearance disabled={false} draft={draft} mode="appearance" onChange={vi.fn()} />);

    for (const [preset, expected] of [
      ['navy_ivory', { ground: 'rgb(250, 247, 239)', primary: 'rgb(41, 77, 115)', secondary: 'rgb(141, 164, 188)' }],
      ['black_champagne', { ground: 'rgb(21, 19, 21)', primary: 'rgb(225, 194, 126)', secondary: 'rgb(110, 41, 79)' }],
      ['blush_cocoa', { ground: 'rgb(255, 242, 244)', primary: 'rgb(116, 64, 82)', secondary: 'rgb(216, 165, 174)' }],
    ] as const) {
      const specimen = screen.getByTestId(`appearance-specimen-${preset}`);
      const primary = specimen.querySelector<HTMLElement>('[data-specimen-role="primary"]');
      const secondary = specimen.querySelector<HTMLElement>('[data-specimen-role="secondary"]');

      expect(specimen.style.backgroundColor).toBe(expected.ground);
      expect(primary?.style.backgroundColor).toBe(expected.primary);
      expect(secondary?.style.backgroundColor).toBe(expected.secondary);
      // The second half of a paired name is never the same swatch as the first.
      expect(primary?.style.backgroundColor).not.toBe(specimen.style.backgroundColor);
      expect(secondary?.style.backgroundColor).not.toBe(primary?.style.backgroundColor);
    }
  });

  // AG-hub-publish-04 — a style card has to render a specimen, not a bare label.
  it('gives every style card a typography and shape specimen in the salon palette', () => {
    const draft = resolveBookingPageConfig({}).draft;
    render(<BookingPageAppearance disabled={false} draft={draft} mode="appearance" onChange={vi.fn()} />);

    const soft = screen.getByTestId('appearance-specimen-soft');
    const bold = screen.getByTestId('appearance-specimen-bold');

    expect(soft.querySelector('[data-specimen-role="heading"]')).toHaveTextContent('Aa');
    // Style specimens differ from one another by shape…
    expect(soft).toHaveStyle({ borderRadius: '32px' });
    expect(bold).toHaveStyle({ borderRadius: '0px' });
    expect(soft.querySelector('[data-specimen-role="primary"]')).toHaveStyle({ borderRadius: '999px' });
    expect(bold.querySelector('[data-specimen-role="primary"]')).toHaveStyle({ borderRadius: '4px' });
    expect(soft.querySelector<HTMLElement>('[data-specimen-role="heading"]')?.style.fontFamily)
      .not.toBe(bold.querySelector<HTMLElement>('[data-specimen-role="heading"]')?.style.fontFamily);
    // …and never by colour: they all show the palette the owner already chose.
    expect(soft.style.backgroundColor).toBe(bold.style.backgroundColor);
  });

  // The specimen must not leak into the control's accessible name.
  it('sets each style card name in that style\'s own display face, palette cards untouched', () => {
    const draft = resolveBookingPageConfig({}).draft;
    render(<BookingPageAppearance disabled={false} draft={draft} mode="appearance" onChange={vi.fn()} />);

    const editorialTokens = getCustomerSitePresentationCssVariables({
      palettePreset: draft.sitePalettePreset,
      stylePreset: 'editorial',
    });
    const editorialLabel = screen.getByTestId('appearance-option-label-editorial');

    expect(editorialLabel.style.fontFamily).toBe(editorialTokens['--customer-site-heading-font']);
    expect(editorialTokens['--customer-site-heading-font']).toBeTruthy();

    const styleIds = new Set(['modern', 'editorial', 'soft', 'minimal', 'bold', 'luxury']);
    const paletteLabels = screen.getAllByTestId(/^appearance-option-label-/)
      .filter(label => !styleIds.has(label.getAttribute('data-testid')!.replace('appearance-option-label-', '')));

    expect(paletteLabels.length).toBeGreaterThan(0);

    for (const paletteLabel of paletteLabels) {
      expect(paletteLabel).not.toHaveAttribute('style');
    }
  });

  it('keeps the accessible name of each card the preset name alone', () => {
    const draft = resolveBookingPageConfig({}).draft;
    render(<BookingPageAppearance disabled={false} draft={draft} mode="appearance" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Terracotta & Cream' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Editorial' })).toBeVisible();
    expect(screen.getByTestId('appearance-specimen-editorial')).toHaveAttribute('aria-hidden', 'true');
  });
});
