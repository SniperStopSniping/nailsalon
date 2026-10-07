import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REBOOKING_REMINDER_MESSAGE } from '@/libs/rebookingReminders';
import { calculateSmsSegments, formatSegmentPreview } from '@/libs/smsSegments';

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

    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));

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

  it('explains eligibility, salon-time scheduling and save scope before activation', async () => {
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);
    await screen.findByRole('switch');

    expect(screen.getByText(/eligible for salon-promotion texts/)).toHaveTextContent('Opted-out, blocked and archived clients are excluded.');
    expect(screen.getByText(/Reminders become due at 10 AM/)).toHaveTextContent('Delivery may be later.');
    expect(screen.getByText(/Changes take effect when you save/)).toBeInTheDocument();
    expect(screen.getByText('Reminders off')).toBeInTheDocument();
    expect(screen.getByText('4 SMS credits')).toBeInTheDocument();
  });

  it('offers shorter wording without saving or enabling and can undo to the exact prior draft', async () => {
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);
    const toggle = await screen.findByRole('switch');
    const originalDraft = 'My wording 💕 {{first_name}}: {{booking_link}}';
    fireEvent.change(screen.getByLabelText('SMS wording'), { target: { value: originalDraft } });
    fireEvent.click(screen.getByRole('button', { name: 'Try shorter wording' }));

    expect(screen.getByText('1 SMS credit')).toBeInTheDocument();
    expect(screen.getByText(/Isla Nail Studio via Luster: Hi Alex, book your next visit:/)).toHaveTextContent('Reply STOP to opt out.');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Undo wording change' }));

    expect(screen.getByLabelText('SMS wording')).toHaveValue(originalDraft);
    expect(screen.queryByRole('button', { name: 'Undo wording change' })).not.toBeInTheDocument();
  });

  it('recalculates the full personalized sample including special characters, sender and opt-out text', async () => {
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);
    await screen.findByRole('switch');
    fireEvent.change(screen.getByLabelText('SMS wording'), { target: { value: 'Hi {{first_name}} 💕 {{booking_link}}' } });
    const message = screen.getByText(/Isla Nail Studio via Luster: Hi Alex 💕/).textContent!;
    const expected = calculateSmsSegments(message);

    expect(expected.encoding).toBe('ucs2');
    expect(screen.getByText(`${expected.segments} SMS credits`)).toBeInTheDocument();
    expect(screen.getByText(`${formatSegmentPreview(expected)} with these sample values`)).toBeInTheDocument();
    expect(screen.getByText(/Final usage varies/)).toBeInTheDocument();
  });

  it('keeps unsaved wording after a failed save and allows retry', async () => {
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);
    await screen.findByRole('switch');
    fireEvent.click(screen.getByRole('button', { name: 'Try shorter wording' }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Could not save. Try again.' } }), { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
    expect(screen.getByLabelText('SMS wording')).toHaveValue('Hi {{first_name}}, book your next visit: {{booking_link}}');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save reminders' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Rebooking Reminders saved.');
    expect(screen.getByText('Reminders off')).toBeInTheDocument();
  });

  it('locks draft controls during save so the response cannot overwrite a newer edit', async () => {
    let finishSave!: (result: Response) => void;
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);
    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      finishSave = resolve;
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminders' }));

    expect(toggle).toBeDisabled();
    expect(screen.getByLabelText('SMS wording')).toBeDisabled();
    expect(screen.getByLabelText('Send after the last completed appointment')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Try shorter wording' })).toBeDisabled();

    finishSave(response({ ...original, enabled: true }));

    expect(await screen.findByRole('status')).toHaveTextContent('Rebooking Reminders saved.');
    expect(toggle).toBeEnabled();
    expect(screen.getByText('Reminders on')).toBeInTheDocument();
  });

  it('recovers a failed load without exposing editable defaults as saved settings', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Settings unavailable.' } }), { status: 503 }));
    render(<RebookingReminderSettings salonSlug="isla" salonName="Isla Nail Studio" onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings unavailable.');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('switch')).not.toBeChecked();
  });
});
