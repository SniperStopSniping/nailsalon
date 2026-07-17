import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExistingAppointmentOptions } from './ExistingAppointmentOptions';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 202 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderOptions(overrides: Partial<Parameters<typeof ExistingAppointmentOptions>[0]> = {}) {
  const handlers = {
    onManageBooking: vi.fn(),
    onEditContact: vi.fn(),
    onRetryBooking: vi.fn(),
  };
  render(
    <ExistingAppointmentOptions
      salonSlug="test-salon"
      guestEmail="guest@example.com"
      guestPhone="4165551234"
      salonPhone="4165550000"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('ExistingAppointmentOptions', () => {
  it('renders every action, with the salon call link only when a phone exists', () => {
    renderOptions();

    expect(screen.getByText('You already have a booking')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-send-link')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-manage')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-edit-contact')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-retry')).toBeInTheDocument();
    expect(screen.getByTestId('existing-appointment-call-salon')).toHaveAttribute('href', 'tel:4165550000');
  });

  it('omits the call link without a salon phone', () => {
    renderOptions({ salonPhone: null });

    expect(screen.queryByTestId('existing-appointment-call-salon')).not.toBeInTheDocument();
  });

  it('sends the recovery request with the gating phone and shows the honest sent copy', async () => {
    renderOptions();

    fireEvent.click(screen.getByTestId('existing-appointment-send-link'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/public/appointments/recovery');
    expect(JSON.parse(init.body)).toEqual({
      salonSlug: 'test-salon',
      email: 'guest@example.com',
      phone: '4165551234',
    });

    const sent = await screen.findByTestId('existing-appointment-sent');

    expect(sent).toHaveTextContent('Request received');
    expect(sent).toHaveTextContent('If we find a matching appointment');
  });

  it('omits empty contact fields from the recovery request', async () => {
    renderOptions({ guestEmail: '' });

    fireEvent.click(screen.getByTestId('existing-appointment-send-link'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      salonSlug: 'test-salon',
      phone: '4165551234',
    });
  });

  it('shows an inline error when the recovery request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    renderOptions();

    fireEvent.click(screen.getByTestId('existing-appointment-send-link'));

    expect(await screen.findByTestId('existing-appointment-send-error')).toBeInTheDocument();
    // The action stays available for retry.
    expect(screen.getByTestId('existing-appointment-send-link')).toBeInTheDocument();
  });

  it('fires the manage, edit-contact, and retry callbacks', () => {
    const handlers = renderOptions();

    fireEvent.click(screen.getByTestId('existing-appointment-manage'));
    fireEvent.click(screen.getByTestId('existing-appointment-edit-contact'));
    fireEvent.click(screen.getByTestId('existing-appointment-retry'));

    expect(handlers.onManageBooking).toHaveBeenCalledTimes(1);
    expect(handlers.onEditContact).toHaveBeenCalledTimes(1);
    expect(handlers.onRetryBooking).toHaveBeenCalledTimes(1);
  });
});
