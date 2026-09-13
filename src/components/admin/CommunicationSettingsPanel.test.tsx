import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationSettingsPanel } from './CommunicationSettingsPanel';

const fetchMock = vi.fn();

const responseBody = {
  sms: {
    senderLabel: 'Luster texting number',
    availableCredits: 82,
  },
  communications: {
    email: { enabled: true },
    sms: { enabled: true },
    killSwitch: false,
    quietHours: { enabled: true, start: '21:00', end: '09:00' },
    reminders: {
      rules: [{ id: 'rule-1', offsetMinutes: 1440, channels: 'both', enabled: true }],
    },
    events: {},
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('CommunicationSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(responseBody));
  });

  it('shows one clear mode with the consequences and real credit balance', async () => {
    render(<CommunicationSettingsPanel salonSlug="isla" />);

    expect(await screen.findByRole('radio', { name: 'Automatic' })).toBeChecked();
    expect(screen.getByText(/Appointment reminders send on schedule/)).toBeVisible();
    expect(screen.getByText(/82 credits/)).toBeVisible();
  });

  it('switches to manual without disabling an email reminder', async () => {
    render(<CommunicationSettingsPanel salonSlug="isla" />);
    await screen.findByRole('radio', { name: 'Automatic' });

    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));

    expect(screen.getByRole('radio', { name: 'Manual' })).toBeChecked();
    expect(screen.getByLabelText('Reminder 1 channel')).toHaveValue('email');
    expect(screen.getByLabelText('Reminder 1 enabled')).toBeChecked();
  });

  it('saves the mode, reminder rules and quiet hours together', async () => {
    render(<CommunicationSettingsPanel salonSlug="isla" />);
    await screen.findByRole('radio', { name: 'Automatic' });
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save message settings' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));

    expect(payload.communications.sms.enabled).toBe(false);
    expect(payload.communications.reminders.rules).toEqual(responseBody.communications.reminders.rules);
    expect(payload.communications.quietHours).toEqual(responseBody.communications.quietHours);
  });
});
