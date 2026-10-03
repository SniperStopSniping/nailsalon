import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RescheduleAppointmentClient } from './RescheduleAppointmentClient';

const baseProps = {
  token: 'manage-token-d6-1',
  salonSlug: 'luster-test',
  manageHref: '/en/luster-test/manage/manage-token-d6-1',
  serviceSummary: 'BIAB Fill',
  technicianName: 'Ari',
  technicianId: 'tech_1',
  locationId: null,
  totalDurationMinutes: 60,
  appointmentId: 'appt_1',
  currentDateKey: '2026-08-20',
  currentTimeKey: '10:00',
  currentLabel: 'Thursday, August 20 at 10:00 AM',
  priceLabel: 'Current invoice estimate: $113.00 CAD',
  discountNote: null,
  currency: 'CAD',
  financialReviewRequired: false,
  subtotalCents: 10_000,
  committedDiscountCents: 0,
  committedDiscountLabel: null,
  hasCommittedSmartFit: false,
} as const;

describe('RescheduleAppointmentClient financial presentation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      slots: [],
      bookedSlots: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  it('separates the frozen invoice estimate from before-tax editable service pricing', () => {
    render(<RescheduleAppointmentClient {...baseProps} />);

    expect(screen.getByTestId('reschedule-current-invoice-estimate'))
      .toHaveTextContent('Current invoice estimate: $113.00 CAD');
    expect(screen.getByTestId('reschedule-price-summary'))
      .toHaveTextContent('Service price after discount (before tax)');
    expect(screen.getByTestId('reschedule-price-summary'))
      .not.toHaveTextContent(/^Total$/u);
  });

  it('hides every amount when frozen invoice evidence is unresolved', () => {
    render(
      <RescheduleAppointmentClient
        {...baseProps}
        currency={null}
        financialReviewRequired
        priceLabel="Financial details are under review."
      />,
    );

    expect(screen.getByTestId('reschedule-financial-review'))
      .toHaveTextContent('Financial details are under review');
    expect(screen.queryByTestId('reschedule-price-summary')).not.toBeInTheDocument();
    expect(screen.queryByText('$100.00 CAD')).not.toBeInTheDocument();
  });

  it('confirms a saved move without claiming an email was delivered', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ slots: [{ time: '11:00', startTime: '2026-08-20T15:00:00Z' }], bookedSlots: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: 'rescheduled' } }))));
    render(<RescheduleAppointmentClient {...baseProps} />);
    fireEvent.click(await screen.findByRole('button', { name: '11:00 AM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new time' }));

    expect(await screen.findByRole('heading', { name: 'Your appointment has been moved' })).toBeInTheDocument();
    expect(screen.getByText('We have updated your booking. View your appointment for the latest details.')).toBeInTheDocument();
    expect(screen.queryByText(/emailed you/)).not.toBeInTheDocument();
  });
});
