import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FindBookingForm } from './FindBookingForm';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 202 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fillAndSubmit(args: { email?: string; phone?: string }) {
  if (args.email !== undefined) {
    fireEvent.change(screen.getByLabelText('Booking email'), { target: { value: args.email } });
  }
  if (args.phone !== undefined) {
    fireEvent.change(screen.getByLabelText('Mobile phone'), { target: { value: args.phone } });
  }
  fireEvent.click(screen.getByRole('button', { name: /email my booking link/i }));
}

describe('FindBookingForm', () => {
  it('renders both contact fields', () => {
    render(<FindBookingForm salonSlug="test-salon" />);

    expect(screen.getByLabelText('Booking email')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile phone')).toBeInTheDocument();
  });

  it('blocks submission with neither field filled and does not call the API', async () => {
    render(<FindBookingForm salonSlug="test-salon" />);

    fillAndSubmit({});

    expect(await screen.findByTestId('find-booking-validation')).toHaveTextContent('Enter the email or phone number you booked with.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits email-only requests', async () => {
    render(<FindBookingForm salonSlug="test-salon" />);

    fillAndSubmit({ email: ' user@example.com ' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);

    expect(body).toEqual({ salonSlug: 'test-salon', email: 'user@example.com' });
  });

  it('submits phone-only requests', async () => {
    render(<FindBookingForm salonSlug="test-salon" />);

    fillAndSubmit({ phone: '(416) 555-1234' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);

    expect(body).toEqual({ salonSlug: 'test-salon', phone: '(416) 555-1234' });
  });

  it('shows the honest generic result on 202 without claiming an email was sent', async () => {
    render(<FindBookingForm salonSlug="test-salon" salonPhone="4165550000" />);

    fillAndSubmit({ email: 'user@example.com' });

    const sent = await screen.findByTestId('find-booking-sent');

    expect(sent).toHaveTextContent('Request received');
    expect(sent).toHaveTextContent('If we find a matching appointment');
    expect(screen.getByRole('link', { name: /call the salon/i })).toHaveAttribute('href', 'tel:4165550000');
  });

  it('shows an error state that preserves the entered values', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    render(<FindBookingForm salonSlug="test-salon" />);

    fillAndSubmit({ email: 'user@example.com', phone: '4165551234' });

    expect(await screen.findByTestId('find-booking-error')).toBeInTheDocument();
    expect(screen.getByLabelText('Booking email')).toHaveValue('user@example.com');
    expect(screen.getByLabelText('Mobile phone')).toHaveValue('4165551234');
  });

  it('shows the error state on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<FindBookingForm salonSlug="test-salon" />);

    fillAndSubmit({ phone: '4165551234' });

    expect(await screen.findByTestId('find-booking-error')).toBeInTheDocument();
  });
});
