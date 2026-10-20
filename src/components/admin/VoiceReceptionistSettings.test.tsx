import { render, screen } from '@testing-library/react';
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

  it('shows retirement and historical calls without activation controls or writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response()));
    vi.stubGlobal('fetch', fetchMock);
    render(<VoiceReceptionistSettings salonSlug="isla" />);

    expect(await screen.findByText(/The AI phone receptionist is retired/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save phone settings' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mic-sandbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View appointment' })).toHaveAttribute('href', '/en/admin?app=bookings&salon=isla&appointment=appointment-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders localized history details and a salon-bound appointment link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response())));
    render(<VoiceReceptionistSettings salonSlug="isla nails" locale="es" />);

    expect(await screen.findByText('Llamadas recientes')).toBeInTheDocument();
    expect(screen.getByText(/Cita reservada/)).toBeInTheDocument();
    expect(screen.getByText(/2030/)).toBeInTheDocument();
    expect(screen.getByText('2 min 5 s · Solicitó devolución de llamada', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver cita' })).toHaveAttribute('href', '/es/admin?app=bookings&salon=isla%20nails&appointment=appointment-1');
    expect(screen.getByText(/La recepcionista telefónica con IA está retirada/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
