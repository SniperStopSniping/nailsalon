import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REBOOKING_REMINDER_MESSAGE } from '@/libs/rebookingReminders';

import { RebookingReminderSettings } from './RebookingReminderSettings';

const fetchMock = vi.fn();
const original = {
  enabled: false,
  defaultIntervalWeeks: 3,
  messageTemplate: DEFAULT_REBOOKING_REMINDER_MESSAGE,
  enabledAt: null,
};

function response(settings: object = original) {
  return new Response(JSON.stringify({ data: { settings } }), { status: 200 });
}

describe('Rebooking Reminder Settings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_input: unknown, init?: RequestInit) => response(
      init?.method === 'PATCH'
        ? { ...original, ...JSON.parse(String(init.body)), enabledAt: '2026-09-30T14:00:00Z' }
        : original,
    ));
  });

  it('previews substitutions and saves the owner-edited wording and interval', async () => {
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);

    const toggle = await screen.findByRole('switch', { name: 'Enable rebooking reminders' });

    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/Hi Alex! It’s almost time/)).toBeInTheDocument();
    expect(screen.getByText(/Reply STOP to opt out\./)).toBeInTheDocument();

    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Send after the last completed appointment'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('SMS wording'), { target: { value: 'Hi {{first_name}}, your {{service_name}} at {{salon_name}} is due: {{booking_link}}' } });

    expect(screen.getByText(/Hi Alex, your Gel manicure at Isla Nail Studio is due/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save Rebooking Reminders' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/rebooking-reminders?salonSlug=isla',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          enabled: true,
          defaultIntervalWeeks: 4,
          messageTemplate: 'Hi {{first_name}}, your {{service_name}} at {{salon_name}} is due: {{booking_link}}',
        }),
      }),
    ));

    expect(await screen.findByRole('status')).toHaveTextContent('Rebooking Reminders saved.');
  });
});
