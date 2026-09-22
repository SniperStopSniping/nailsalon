import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoiceReceptionistSettings } from './VoiceReceptionistSettings';

vi.mock('./VoiceMicSandbox', () => ({ VoiceMicSandbox: () => <div data-testid="mic-sandbox" /> }));

const settings = {
  enabled: false,
  bookingEnabled: false,
  greeting: null,
  voice: 'marin' as const,
  language: 'auto' as const,
  answerMode: 'always' as const,
  callbackEnabled: true,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      settings: { ...settings, salonId: 'never-send', createdAt: '2030-01-01T00:00:00.000Z', ...overrides },
      readiness: { configured: false, numberReady: false, globallyEnabled: false, providerReady: false },
      calls: [{
        id: 'call-1',
        callerNumber: '+14165550100',
        status: 'completed',
        outcome: 'booked',
        summary: 'Gel-X booked.',
        appointmentId: 'appointment-1',
        callbackRequested: true,
        durationSeconds: 125,
        createdAt: '2030-01-02T15:04:00.000Z',
      }],
    },
  };
}

describe('VoiceReceptionistSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows disabled readiness and saves only the public settings contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(response()))
      .mockResolvedValueOnce(Response.json(response()));
    vi.stubGlobal('fetch', fetchMock);
    render(<VoiceReceptionistSettings salonSlug="isla" />);

    expect(await screen.findByText('AI phone receptionist')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Answer incoming calls' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save phone settings' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const init = fetchMock.mock.calls[1]![1] as RequestInit;

    expect(JSON.parse(String(init.body))).toEqual(settings);
  });

  it('renders localized history details and a salon-bound appointment link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response())));
    render(<VoiceReceptionistSettings salonSlug="isla nails" locale="es" />);

    expect(await screen.findByText('Llamadas recientes')).toBeInTheDocument();
    expect(screen.getByText(/Cita reservada/)).toBeInTheDocument();
    expect(screen.getByText(/2030/)).toBeInTheDocument();
    expect(screen.getByText('2 min 5 s · Solicitó devolución de llamada', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver cita' })).toHaveAttribute('href', '/es/admin?app=bookings&salon=isla%20nails&appointment=appointment-1');
    expect(screen.getByRole('checkbox', { name: 'Responder llamadas entrantes' })).toBeDisabled();
  });
});
