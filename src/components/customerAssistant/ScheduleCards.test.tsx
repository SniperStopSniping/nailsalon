import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CustomerAssistantResult, CustomerProposal } from '@/libs/customerAssistant/contracts';

import { AcceptSelection, ScheduleCards } from './ScheduleCards';

const proposal: CustomerProposal = {
  selection: { baseServiceId: 'gel-x', selectedAddOns: [] },
  fingerprint: 'f'.repeat(64),
  service: { id: 'gel-x', name: 'Gel-X', priceCents: 8500 },
  addOns: [],
  currency: 'CAD',
  subtotalCents: 8500,
  durationMinutes: 90,
  expiresAt: '2026-09-18T12:05:00Z',
};
const slots: Extract<CustomerAssistantResult, { kind: 'slots' }> = {
  kind: 'slots',
  proposal,
  timeZone: 'America/Toronto',
  preference: { date: '2026-09-19', earliest: '12:00', latest: '18:00' },
  slots: [{ startTime: '2026-09-19T17:00:00.000Z', time: '13:00' }],
  checkedAt: '2026-09-18T12:00:00Z',
};

describe('customer scheduling controls', () => {
  it('requires an explicit proposal click and passes its exact fingerprint', async () => {
    const onAction = vi.fn();
    render(<AcceptSelection fingerprint={proposal.fingerprint} locale="en" disabled={false} onAction={onAction} />);

    expect(onAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Choose these services' }));

    expect(onAction).toHaveBeenCalledWith({ action: 'accept_selection', fingerprint: proposal.fingerprint });
  });

  it('uses server slot instants, salon time zone, and explains a stale slot', async () => {
    const onAction = vi.fn();
    render(<ScheduleCards result={{ ...slots, slotDisappeared: true }} locale="en" disabled={false} onAction={onAction} />);

    expect(screen.getByRole('status')).toHaveTextContent('no longer available');
    expect(screen.getByText(/does not reserve it/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /1:00.*p\.?m\.?/i }));

    expect(onAction).toHaveBeenCalledWith({ action: 'select_slot', startTime: slots.slots[0]!.startTime });
  });

  it('disables actions during requests and never labels a selected slot confirmed', () => {
    render(<ScheduleCards result={{ kind: 'slot_selected', proposal, timeZone: slots.timeZone, preference: slots.preference, slot: slots.slots[0]! }} locale="en" disabled onAction={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('no appointment has been created');
    expect(screen.getByRole('button', { name: 'Show available times' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /confirm booking/i })).not.toBeInTheDocument();
  });

  it('shows an empty availability state in French', () => {
    render(<ScheduleCards result={{ ...slots, slots: [] }} locale="fr" disabled={false} onAction={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Aucune heure ne correspond');
    expect(screen.getByRole('button', { name: 'Voir les disponibilités' })).toBeVisible();
  });
});
