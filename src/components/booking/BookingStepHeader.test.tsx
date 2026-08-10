import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type BookingStep, getFirstStep } from '@/libs/bookingFlow';

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

  // Luster UI/UX plan rev 3, PR 4: "the identity/trust band renders on
  // whichever step is first via the existing isFirstStep signal". These two
  // tests exercise that signal for real rather than asserting it manually:
  // BookingStepHeader's own isFirstStep-gated rendering, then the same
  // `getFirstStep` computation every booking step page already uses to
  // derive it, proving the band follows a staff-first flow's actual first
  // step rather than being hardcoded to the service step.
  it('shows the identity/trust band (no back button, full-width centered name) only when isFirstStep is true', () => {
    const { rerender } = render(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        title="Choose Your Service"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        currentStep="service"
        isFirstStep
        onBack={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
    expect(screen.getByTestId('booking-salon-name')).toHaveClass('w-full', 'text-center');

    rerender(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        title="Choose Your Artist"
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        currentStep="tech"
        isFirstStep={false}
        onBack={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(screen.getByTestId('booking-salon-name')).not.toHaveClass('w-full', 'text-center');
  });

  it('renders on whichever step is first for a staff-first flow, not just the service step', () => {
    const staffFirstFlow: BookingStep[] = ['tech', 'service', 'time', 'confirm'];

    // The same computation BookServiceClient.tsx / BookTechClient.tsx each
    // do for their own step: isFirstStep = getFirstStep(bookingFlow) === thisStep.
    const isTechFirstStep = getFirstStep(staffFirstFlow) === 'tech';
    const isServiceFirstStep = getFirstStep(staffFirstFlow) === 'service';

    expect(isTechFirstStep).toBe(true);
    expect(isServiceFirstStep).toBe(false);

    const { rerender } = render(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        title="Choose Your Artist"
        bookingFlow={[...staffFirstFlow]}
        currentStep="tech"
        isFirstStep={isTechFirstStep}
        onBack={() => {}}
      />,
    );

    // Tech is first in this flow: the trust band shows, no back button.
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();

    rerender(
      <BookingStepHeader
        salonName="Isla Nail Studio"
        mounted
        title="Choose Your Service"
        bookingFlow={[...staffFirstFlow]}
        currentStep="service"
        isFirstStep={isServiceFirstStep}
        onBack={() => {}}
      />,
    );

    // Service is NOT first in a staff-first flow: back button reappears.
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });
});
