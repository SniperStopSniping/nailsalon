import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';

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

  it('keeps the six site compositions independent from the five booking menus', () => {
    const onChange = vi.fn();
    const draft = resolveBookingPageConfig({}).draft;
    render(<BookingPageAppearance disabled={false} draft={draft} mode="layouts" onChange={onChange} />);

    expect(screen.getAllByRole('button')).toHaveLength(11);

    fireEvent.click(screen.getByRole('button', { name: 'Profile Story' }));

    expect(onChange).toHaveBeenLastCalledWith({ quickBookLayout: 'profile_story' });

    fireEvent.click(screen.getByRole('button', { name: 'Editorial Price List' }));

    expect(onChange).toHaveBeenLastCalledWith({ serviceMenuLayout: 'editorial_price_list' });
  });
});
