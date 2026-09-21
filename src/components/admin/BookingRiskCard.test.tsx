import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingRiskCard } from './BookingRiskCard';

describe('BookingRiskCard', () => {
  it('automatically shows a network warning for a recorded no-show regardless of protection consequence', () => {
    render(
      <BookingRiskCard risk={{
        state: 'available',
        activeNoShowCount: 1,
        windowMonths: 12,
        protection: 'warn_only',
      }}
      />,
    );

    expect(screen.getByTestId('booking-risk-warning')).toHaveTextContent('Higher no-show risk');
    expect(screen.getByTestId('booking-risk-warning')).toHaveTextContent('1 recorded no-show on Luster in the last 12 months.');
    expect(screen.getByTestId('booking-risk-warning')).toHaveTextContent('Warning only');
  });

  it('does not represent unavailable history as a clear record', () => {
    render(<BookingRiskCard risk={{ state: 'unavailable' }} />);

    expect(screen.getByTestId('booking-risk-unavailable')).toHaveTextContent('Network no-show history unavailable.');
    expect(screen.queryByTestId('booking-risk-clear')).not.toBeInTheDocument();
  });

  it('shows a compact clear state for an available matched customer with no active events', () => {
    render(
      <BookingRiskCard risk={{
        state: 'available',
        activeNoShowCount: 0,
        windowMonths: 12,
        protection: 'deposit_2',
      }}
      />,
    );

    expect(screen.getByTestId('booking-risk-clear')).toHaveTextContent('No recorded no-shows in the active risk window.');
  });
});
