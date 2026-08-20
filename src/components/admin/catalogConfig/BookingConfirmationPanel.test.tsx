import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceResponse } from '@/types/admin';

import { BookingConfirmationPanel } from './BookingConfirmationPanel';

const legacyService: ServiceResponse = {
  id: 'svc_legacy',
  name: 'Classic Manicure',
  price: 3500,
  durationMinutes: 30,
  category: 'manicure',
  bookingCategory: 'manicure',
  isActive: true,
  confirmationMode: null,
};

const consultationService: ServiceResponse = {
  ...legacyService,
  id: 'svc_consult',
  name: 'Full Set Consultation',
  confirmationMode: 'consultation',
};

function renderPanel(services: ServiceResponse[], onRefresh = vi.fn()) {
  render(<BookingConfirmationPanel salonSlug="isla-nail-studio" services={services} onRefresh={onRefresh} />);
  return { onRefresh };
}

describe('BookingConfirmationPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('legacy simplicity: a NULL confirmationMode starts on Default, and Save stays disabled until touched — opening this panel never converts it', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel([legacyService]);

    const row = screen.getByTestId('confirmation-row-svc_legacy');
    const defaultOption = within(row).getByLabelText('Default (today\'s behavior)');

    expect(defaultOption).toBeChecked();
    expect(within(row).getByTestId('confirmation-save-svc_legacy')).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consultation is always shown disabled and is never sent by this panel', () => {
    renderPanel([consultationService]);

    const row = screen.getByTestId('confirmation-row-svc_consult');
    const consultationOption = within(row).getByLabelText('Consultation (coming later)');

    expect(consultationOption).toBeDisabled();
    // Selectable options never include the string 'consultation' as a value
    // this component could submit — Book instantly / Request approval / Default only.
    expect(within(row).getByLabelText('Book instantly')).not.toBeChecked();
    expect(within(row).getByLabelText('Request approval')).not.toBeChecked();
  });

  it('happy path: switching to "Request approval" and saving PATCHes confirmationMode without touching other fields, and never sends consultation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { service: { ...legacyService, confirmationMode: 'request_approval' } },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel([legacyService]);

    const row = screen.getByTestId('confirmation-row-svc_legacy');
    const saveButton = within(row).getByTestId('confirmation-save-svc_legacy');

    expect(saveButton).toBeDisabled();

    fireEvent.click(within(row).getByLabelText('Request approval'));

    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/salon/services/svc_legacy');

    const body = JSON.parse(String(init.body));

    expect(body.confirmationMode).toBe('request_approval');
    expect(body.name).toBe(legacyService.name);
    expect(body.price).toBe(legacyService.price);
    expect(body).not.toHaveProperty('confirmationMode', 'consultation');

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('double-submit protection: rapid double-click sends exactly one PATCH', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel([legacyService]);

    const row = screen.getByTestId('confirmation-row-svc_legacy');
    fireEvent.click(within(row).getByLabelText('Book instantly'));
    const saveButton = within(row).getByTestId('confirmation-save-svc_legacy');
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ data: { service: legacyService } }), { status: 200 }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('shows the server error inline when the save fails, without losing the selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'UPDATE_FAILED', message: 'The service could not be saved. Try again.' },
    }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel([legacyService]);

    const row = screen.getByTestId('confirmation-row-svc_legacy');
    fireEvent.click(within(row).getByLabelText('Book instantly'));
    fireEvent.click(within(row).getByTestId('confirmation-save-svc_legacy'));

    expect(await within(row).findByRole('alert')).toHaveTextContent('The service could not be saved. Try again.');
    expect(within(row).getByLabelText('Book instantly')).toBeChecked();
  });

  it('every radio option is reachable via its label (keyboard/label association)', () => {
    renderPanel([legacyService]);
    const row = screen.getByTestId('confirmation-row-svc_legacy');
    for (const label of ['Default (today\'s behavior)', 'Book instantly', 'Request approval', 'Consultation (coming later)']) {
      expect(within(row).getByLabelText(label)).toBeInstanceOf(HTMLInputElement);
    }
  });
});
