import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingStepHeader } from './BookingStepHeader';

describe('BookingStepHeader', () => {
  it('renders the compact mobile header treatment while preserving the step labels', () => {
    render(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        title="Choose Your Service"
        description="Pick your main service, then add optional extras."
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        currentStep="service"
        isFirstStep
      />,
    );

    expect(screen.getByTestId('booking-step-header')).toBeInTheDocument();
    expect(screen.getByText('Isla Nail Studio')).toHaveClass('text-base');
    expect(screen.getByTestId('booking-step-marker-service')).toHaveClass('size-5', 'text-[10px]');
    expect(screen.getByTestId('booking-step-label-service')).toHaveClass('text-[10px]');
    expect(screen.getByTestId('booking-step-label-tech')).toHaveTextContent('Artist');
    expect(screen.getByRole('heading', { name: 'Choose Your Service' })).toHaveClass('text-[1.7rem]');
    expect(screen.getByText('Pick your main service, then add optional extras.')).toHaveClass('text-[13px]');
  });
});
