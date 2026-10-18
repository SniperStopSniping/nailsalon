import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { bookingConfigSchema } from '@/libs/bookingConfig.shared';

import { resolveSetupPolicy } from './booking-policy';
import { BookingSetupSummary } from './BookingSetupSummary';
import { CLOSED_HOURS, type SetupDocument } from './contracts';

afterEach(cleanup);

const document: Pick<SetupDocument, 'business' | 'hours' | 'booking' | 'services'> = {
  business: { name: 'Synthetic studio', city: 'Toronto', exactAddress: '100 Synthetic Private Lane', homeBased: true, locationDisplayMode: 'after_booking', workMode: 'team' },
  hours: { ...CLOSED_HOURS, friday: { open: '11:00', close: '16:00' } },
  booking: bookingConfigSchema.parse({ minimumNoticeMinutes: 180, bufferMinutes: 10 }),
  services: [{ id: 'draft_gel', name: 'Gel', description: null, category: 'manicure', bookingCategory: 'manicure', priceCents: 5000, durationMinutes: 60, preparationBufferMinutes: 5, cleanupBufferMinutes: 10, confirmed: false, origin: 'owner' }],
};

it('shows proposed notice, hours and separate buffers without exposing the exact address', () => {
  render(<BookingSetupSummary document={document} />);

  expect(screen.getByText(/180 minutes notice · 10 minutes extra buffer/u)).toBeInTheDocument();
  expect(screen.getByText('11:00–16:00')).toBeInTheDocument();
  expect(screen.getAllByText('Closed')).toHaveLength(6);
  expect(screen.getByText(/5 minutes preparation and 10 minutes cleanup, separate from the appointment length/u)).toBeInTheDocument();
  expect(screen.getByText('Exact service address shared after booking; hidden from public pages.')).toBeInTheDocument();
  expect(screen.queryByText(document.business.exactAddress)).not.toBeInTheDocument();
});

it('labels original-engine examples as simulated and excludes live customer/calendar information', () => {
  render(<BookingSetupSummary document={document} examples={{ serviceName: 'Gel', technicianNames: ['Alex'], days: [{ date: '2026-10-23', times: ['11:00', '11:15'] }] }} />);

  expect(screen.getByText('Active team: Alex')).toBeInTheDocument();
  expect(screen.getByText('2026-10-23: 11:00, 11:15')).toBeInTheDocument();
  expect(screen.getByText(/Simulated times for Gel.*Existing appointments, time off and external calendars are excluded/u)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('shows required booking agreement wording as a proposal with no active acceptance control', () => {
  const bookingPolicy = resolveSetupPolicy({ enabled: true, title: 'Visit agreement', text: 'Please come alone.', showOnServicePage: false, showBeforeConfirmation: true, showAfterConfirmation: false, showInConfirmationEmail: true, acknowledgment: { required: true, text: 'I agree.' } });
  render(<BookingSetupSummary document={{ ...document, bookingPolicy }} />);

  expect(screen.getByRole('heading', { name: 'Visit agreement' })).toBeInTheDocument();
  expect(screen.getByText('Please come alone.')).toBeInTheDocument();
  expect(screen.getByText('Customers must accept this agreement during booking after you publish.')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('does not invent example times when the original engine finds none', () => {
  render(<BookingSetupSummary document={document} examples={{ serviceName: null, technicianNames: [], days: [] }} />);

  expect(screen.getByText('No example times are available with this setup.')).toBeInTheDocument();
});
