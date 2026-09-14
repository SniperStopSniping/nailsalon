import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingReadingPreferences } from './BookingReadingPreferences';

describe('BookingReadingPreferences', () => {
  it('renders booking content without a reading preference control', () => {
    const { container } = render(<BookingReadingPreferences><p>Booking content</p></BookingReadingPreferences>);

    expect(screen.getByText('Booking content')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('data-booking-readability', 'standard');
  });
});
