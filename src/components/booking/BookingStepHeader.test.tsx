import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookingStepHeader } from './BookingStepHeader';

vi.mock('next/font/google', () => ({
  Playfair_Display: () => ({ className: 'font-playfair-display' }),
}));

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
    expect(screen.getByTestId('booking-salon-name')).toHaveClass('text-base');
    expect(screen.getByTestId('booking-step-marker-service')).toHaveClass('size-5', 'text-[10px]');
    expect(screen.getByTestId('booking-step-label-service')).toHaveClass('text-[10px]');
    expect(screen.getByTestId('booking-step-label-tech')).toHaveTextContent('Artist');
    expect(screen.getByRole('heading', { name: 'Choose Your Service' })).toHaveClass('text-[1.7rem]');
    expect(screen.getByText('Pick your main service, then add optional extras.')).toHaveClass('text-[13px]');
  });

  it('renders the editorial salon name treatment with an announcement slot when requested', () => {
    render(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        salonNameVariant="editorial"
        announcement={<div>✨ 25% off for new clients — until April 30</div>}
        title="Choose Your Service"
        description="Pick your main service, then add optional extras."
        bookingFlow={['service', 'time', 'confirm']}
        currentStep="service"
        isFirstStep
      />,
    );

    expect(screen.getByTestId('booking-salon-name')).toHaveClass(
      'font-playfair-display',
      'text-[1.36rem]',
      'font-normal',
      'tracking-wider',
    );
    expect(screen.getByTestId('booking-step-announcement')).toBeInTheDocument();
    expect(screen.getByText('✨ 25% off for new clients — until April 30')).toBeInTheDocument();
  });

  it('keeps the salon-name row clear of the top safe area on notched phones', () => {
    render(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        title="Choose Your Service"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        currentStep="service"
        isFirstStep
      />,
    );

    const topRow = screen.getByTestId('booking-salon-name').parentElement;

    // The utility resolves to calc(1rem + env(safe-area-inset-top, 0px)) —
    // plain 1rem on non-notched devices, pushed below the notch elsewhere.
    expect(topRow).toHaveClass('booking-header-safe-top');
    expect(topRow).not.toHaveClass('pt-4');
  });
});
