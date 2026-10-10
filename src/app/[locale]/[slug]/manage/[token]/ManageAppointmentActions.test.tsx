import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManageAppointmentActions } from './ManageAppointmentActions';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const props = {
  token: 'synthetic-token',
  rescheduleUrl: '/en/synthetic/manage/synthetic-token/reschedule',
  appointmentStatus: 'confirmed',
  isActive: true,
};

describe('customer cancellation recovery', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['pending', 'confirmed'])('keeps both actions available for a %s appointment', (appointmentStatus) => {
    render(<ManageAppointmentActions {...props} appointmentStatus={appointmentStatus} salonPhone="+14165550100" />);

    expect(screen.getByRole('button', { name: 'Cancel appointment' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Choose a new time' })).toHaveAttribute('href', props.rescheduleUrl);
    expect(screen.getByRole('link', { name: 'Call salon' })).toHaveAttribute('href', 'tel:+14165550100');
    expect(screen.queryByText(/Online changes are closed/)).not.toBeInTheDocument();
  });

  it.each(['completed', 'cancelled', 'no_show', 'in_progress', 'awaiting_payment'])('does not reopen a %s appointment', (appointmentStatus) => {
    render(<ManageAppointmentActions {...props} appointmentStatus={appointmentStatus} isActive={false} />);

    expect(screen.queryByRole('button', { name: 'Cancel appointment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Choose a new time' })).not.toBeInTheDocument();
  });

  it('does not reveal a hidden salon phone', () => {
    render(<ManageAppointmentActions {...props} />);

    expect(screen.queryByRole('link', { name: 'Call salon' })).not.toBeInTheDocument();
  });

  it('does not send a cancellation when the customer dismisses confirmation', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ManageAppointmentActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel appointment' })).toBeEnabled();
  });

  it.each(['network', 'server'] as const)('recovers from a %s failure without claiming cancellation, then permits a successful retry', async (failure) => {
    const fetchMock = vi.fn();
    if (failure === 'network') {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    } else {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    }
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ManageAppointmentActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t confirm the cancellation.');
    expect(screen.queryByText('This appointment is cancelled.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh appointment' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(await screen.findByText('This appointment is cancelled.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('aborts a stalled request and restores recovery controls', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      requestSignal = options.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    render(<ManageAppointmentActions {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();

    await act(async () => vi.advanceTimersByTimeAsync(15_000));

    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh to check your appointment');
    expect(screen.getByRole('button', { name: 'Cancel appointment' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
