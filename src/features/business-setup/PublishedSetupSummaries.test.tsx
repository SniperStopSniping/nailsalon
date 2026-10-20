import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { bookingConfigSchema } from '@/libs/bookingConfig.shared';

import { AddOnBookingSummary } from './AddOnBookingSummary';
import { BookingExtrasSummary } from './BookingExtrasSummary';
import type { SetupDocument } from './contracts';
import { TeamBookingSummary } from './TeamBookingSummary';

afterEach(cleanup);

const document: Pick<SetupDocument, 'booking' | 'services' | 'staff' | 'addOns' | 'deposit' | 'depositEditedFields'> = {
  booking: bookingConfigSchema.parse({}),
  services: [{ id: 'gel', name: 'Gel', description: null, priceCents: 5000, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure', confirmed: true, origin: 'owner' }],
  staff: [{ id: 'alex', name: 'Alex', isActive: true, hours: null, serviceIds: ['gel'], assignmentMode: 'explicit' }],
  addOns: [{ id: 'art', name: 'Nail art', category: 'nail_art', descriptionItems: null, priceCents: 1000, durationMinutes: 5, pricingType: 'fixed', unitLabel: null, maxQuantity: null, isActive: true, serviceIds: ['gel'], confirmed: true, origin: 'owner' }],
  deposit: { enabled: true, amountCents: 2000 },
  depositEditedFields: ['enabled', 'amountCents'],
};

it.each([false, true])('keeps saved publication labels separate from draft proposals without activating payments: %s', (published) => {
  render(
    <>
      <TeamBookingSummary document={document} published={published} />
      <AddOnBookingSummary document={document} published={published} />
      <BookingExtrasSummary document={document} published={published} />
    </>,
  );

  expect(screen.getByText(published ? 'Team and service choices' : 'Proposed team and service choices', { exact: true })).toBeInTheDocument();
  expect(screen.getByText(published ? 'Add-ons' : 'Proposed add-ons', { exact: true })).toBeInTheDocument();
  expect(screen.getByText(published ? 'Deposits and reminders' : 'Proposed deposits and reminders', { exact: true })).toBeInTheDocument();
  expect(screen.getByText(/Simulated preview times show the base service only/)).toBeInTheDocument();
  expect(screen.getByText(/Nothing is charged in preview/)).toBeInTheDocument();
  expect(screen.getByText(published ? /Collection depends on your payment connection/ : /payment readiness must pass before activation/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
