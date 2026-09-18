import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CustomerReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

import { CustomerBookingReviewCard } from './CustomerBookingReviewCard';

const review: CustomerReviewSnapshot = {
  status: 'INCOMPLETE',
  fingerprint: 'f'.repeat(64),
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  salon: { id: 'salon', slug: 'isla-nail-studio', name: 'Isla Nail Studio' },
  location: null,
  services: [{ id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 }],
  addOns: [{ id: 'french', name: 'French', quantity: 1, priceCents: 1500 }],
  technician: { kind: 'any_artist' },
  date: '2026-09-19',
  time: '13:00',
  timeZone: 'America/Toronto',
  durationMinutes: 120,
  financial: { subtotalCents: 10000, estimatedTaxCents: 1300, estimatedTotalCents: 11300, currency: 'CAD' },
  deposit: { status: 'required', amountCents: 2500, currency: 'CAD', label: 'Deposit' },
  confirmationMode: 'request_approval',
  bookingPolicy: { required: true, title: 'Booking policy', text: 'Please arrive on time.', acknowledgmentText: 'I agree.', version: 'policy-v1:fixture' },
  blockers: ['reminder_integration', 'identity_pricing'],
};

describe('CustomerBookingReviewCard', () => {
  it('clearly presents incomplete pricing, payment and approval without a confirm action', () => {
    render(<CustomerBookingReviewCard review={review} locale="en" />);

    expect(screen.getByRole('status')).toHaveTextContent('Not booked yet');
    expect(screen.getByText('$113.00')).toBeVisible();
    expect(screen.getByText('$25.00')).toBeVisible();
    expect(screen.getByText('Any available artist')).toBeVisible();
    expect(screen.getByText(/salon must approve/)).toBeVisible();
    expect(screen.getByText(/final amount is not yet confirmed/)).toBeVisible();
    expect(screen.getByText(/Location details are shared/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('marks an expired review as needing a fresh check and supports French', () => {
    const { rerender } = render(<CustomerBookingReviewCard review={{ ...review, expiresAt: '2020-01-01T00:00:00Z' }} locale="en" />);

    expect(screen.getByRole('status')).toHaveTextContent('fresh check');

    rerender(<CustomerBookingReviewCard review={review} locale="fr" />);

    expect(screen.getByRole('region', { name: 'Détails de votre réservation' })).toBeVisible();
    expect(screen.getByText('Total estimé')).toBeVisible();
  });
});
