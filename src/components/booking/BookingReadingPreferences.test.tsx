import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookingReadingPreferences } from './BookingReadingPreferences';

const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ locale: locale.value }) }));

describe('BookingReadingPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    locale.value = 'en';
  });

  afterEach(() => vi.restoreAllMocks());

  it('is opt-in, accessible and remembered across booking screens', () => {
    const { unmount } = render(<BookingReadingPreferences><p>Booking content</p></BookingReadingPreferences>);
    const control = screen.getByRole('button', { name: 'Easier to read Off' });

    expect(control).toHaveAttribute('aria-pressed', 'false');
    expect(control).toHaveAccessibleDescription(/Larger text, clear backgrounds/);

    fireEvent.click(control);

    expect(control).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('luster:booking-reading:v1')).toBe('easy');

    unmount();

    render(<BookingReadingPreferences><p>Next screen</p></BookingReadingPreferences>);

    expect(screen.getByRole('button', { name: 'Easier to read On' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Easier to read On' }));

    expect(localStorage.getItem('luster:booking-reading:v1')).toBe('standard');
  });

  it('still works when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<BookingReadingPreferences><p>Booking content</p></BookingReadingPreferences>);
    fireEvent.click(screen.getByRole('button', { name: 'Easier to read Off' }));

    expect(screen.getByRole('button', { name: 'Easier to read On' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Booking content')).toBeVisible();
  });

  it('ignores unknown saved values and provides French controls', () => {
    locale.value = 'fr';
    localStorage.setItem('luster:booking-reading:v1', 'unexpected');
    render(<BookingReadingPreferences><p>Réservation</p></BookingReadingPreferences>);

    expect(screen.getByRole('button', { name: 'Lecture facilitée Désactivée' })).toHaveAttribute('aria-pressed', 'false');
  });
});
