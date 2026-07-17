import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppointmentActions } from './useAppointmentActions';

const fetchMock = vi.fn();

const DETAIL = {
  appointment: {
    id: 'appt_1',
    clientName: 'Ava Client',
    clientPhone: '4165551234',
    clientEmail: 'ava@example.com',
    baseServiceId: 'srv_1',
    technicianId: 'tech_1',
    startTime: '2099-07-01T18:00:00.000Z',
    notes: 'Existing note',
    status: 'confirmed',
  },
  permissions: { canCancel: true },
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function queueDetailFetch(detail: unknown = DETAIL) {
  fetchMock.mockResolvedValueOnce(jsonResponse({ data: detail }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderOpenHook(options: Parameters<typeof useAppointmentActions>[0] = {}) {
  const utils = renderHook(() => useAppointmentActions(options));
  queueDetailFetch();
  act(() => utils.result.current.openAppointment('appt_1'));
  await waitFor(() => expect(utils.result.current.detail).not.toBeNull());
  return utils;
}

describe('useAppointmentActions', () => {
  it('loads manage detail when an appointment is opened and clears it on close', async () => {
    const { result } = await renderOpenHook();

    expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_1/manage');
    expect(result.current.detail?.appointment.id).toBe('appt_1');

    act(() => result.current.closeAppointment());
    await waitFor(() => expect(result.current.detail).toBeNull());
  });

  it('pins every appointment action endpoint to the selected salon', async () => {
    const { result } = await renderOpenHook({ salonSlug: 'salon-a' });

    expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_1/manage?salonSlug=salon-a');

    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: { detail: DETAIL, calendarEvent: { id: 'appt_1' } },
    }));
    await act(async () => result.current.moveToNextAvailable());

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.startAppointment());

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.completeAppointment());

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.confirmAppointment());

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.resendConfirmation());

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    await act(async () => result.current.cancelAppointment({ reason: 'client_request' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/appt_1/manage?salonSlug=salon-a',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/appt_1/complete?salonSlug=salon-a',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/appt_1/complete?salonSlug=salon-a',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/appt_1?salonSlug=salon-a',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/appt_1/resend-confirmation?salonSlug=salon-a',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/appointments/appt_1/cancel?salonSlug=salon-a',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('surfaces a friendly error with retry state when the detail fetch fails', async () => {
    const { result } = renderHook(() => useAppointmentActions());
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    act(() => result.current.openAppointment('appt_1'));

    await waitFor(() => expect(result.current.detailError).toBeTruthy());

    expect(result.current.detail).toBeNull();

    // refreshDetail retries the same appointment.
    queueDetailFetch();
    await act(async () => result.current.refreshDetail());

    expect(result.current.detail?.appointment.id).toBe('appt_1');
    expect(result.current.detailError).toBeNull();
  });

  it('routes saveEdits to changeService when the service changed', async () => {
    const { result } = await renderOpenHook();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { detail: DETAIL, calendarEvent: { id: 'appt_1' } } }));

    await act(async () => result.current.saveEdits({
      baseServiceId: 'srv_2',
      technicianId: 'tech_1',
      startTime: '2099-07-01T18:00:00.000Z',
    }));

    const [, init] = fetchMock.mock.calls.at(-1)!;

    expect(JSON.parse(init.body).operation).toBe('changeService');
  });

  it('routes saveEdits to reassignTechnician when only the technician changed', async () => {
    const { result } = await renderOpenHook();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { detail: DETAIL, calendarEvent: { id: 'appt_1' } } }));

    await act(async () => result.current.saveEdits({
      baseServiceId: 'srv_1',
      technicianId: 'tech_2',
      startTime: '2099-07-01T18:00:00.000Z',
    }));

    const [, init] = fetchMock.mock.calls.at(-1)!;

    expect(JSON.parse(init.body)).toEqual({ operation: 'reassignTechnician', technicianId: 'tech_2' });
  });

  it('routes saveEdits to move when the time changed', async () => {
    const { result } = await renderOpenHook();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { detail: DETAIL, calendarEvent: { id: 'appt_1' } } }));

    await act(async () => result.current.saveEdits({
      baseServiceId: 'srv_1',
      technicianId: 'tech_1',
      startTime: '2099-07-01T19:00:00.000Z',
    }));

    const [, init] = fetchMock.mock.calls.at(-1)!;

    expect(JSON.parse(init.body).operation).toBe('move');
  });

  it('keeps the loaded detail and exposes the attempted time on a reschedule conflict', async () => {
    const onMutationApplied = vi.fn();
    const { result } = await renderOpenHook({ onMutationApplied });
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: 'APPOINTMENT_CONFLICT',
        message: 'That time is taken',
        details: { attemptedStartTime: '2099-07-01T19:00:00.000Z' },
      },
    }, 409));

    await act(async () => {
      await result.current.saveEdits({
        baseServiceId: 'srv_1',
        technicianId: 'tech_1',
        startTime: '2099-07-01T19:00:00.000Z',
      }).catch(() => {});
    });

    expect(result.current.detailError).toBe('That time is taken');
    expect(result.current.attemptedTimeLabel).toBeTruthy();
    expect(result.current.detail?.appointment.id).toBe('appt_1');
    expect(onMutationApplied).not.toHaveBeenCalled();
  });

  it('turns a missing after-photo into a decision instead of an error, then retries with skipPhotoValidation', async () => {
    const { result } = await renderOpenHook();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'PHOTOS_REQUIRED', message: 'After photo required' } }, 400));

    await act(async () => result.current.completeAppointment());

    expect(result.current.completionNeedsPhotoDecision).toBe(true);
    expect(result.current.detailError).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.completeAppointment({ skipPhotoValidation: true }));

    const completeCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH' && String(init?.body).includes('skipPhotoValidation'));

    expect(completeCall).toBeTruthy();
    expect(JSON.parse(completeCall![1].body)).toMatchObject({ paymentStatus: 'paid', skipPhotoValidation: true });
    expect(result.current.completionNeedsPhotoDecision).toBe(false);
  });

  it('appends the internal cancellation note to existing notes', async () => {
    const onCancelled = vi.fn();
    const { result } = await renderOpenHook({ onCancelled });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await act(async () => result.current.cancelAppointment({ reason: 'client_request', internalNote: 'Client called to cancel' }));

    const [url, init] = fetchMock.mock.calls.at(-1)!;

    expect(url).toBe('/api/appointments/appt_1/cancel');
    expect(JSON.parse(init.body)).toEqual({
      cancelReason: 'client_request',
      notes: 'Existing note\n[Cancellation note] Client called to cancel',
    });
    expect(onCancelled).toHaveBeenCalledWith('appt_1', 'cancelled');
    expect(result.current.selectedAppointmentId).toBeNull();
  });

  it('treats cancelling an already-cancelled appointment as done, without an error', async () => {
    const onCancelled = vi.fn();
    const { result } = await renderOpenHook({ onCancelled });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'INVALID_STATE', message: 'Already cancelled' } }, 400));

    await act(async () => result.current.cancelAppointment({ reason: 'client_request' }));

    expect(result.current.detailError).toBeNull();
    expect(onCancelled).toHaveBeenCalledWith('appt_1', 'cancelled');
    expect(result.current.selectedAppointmentId).toBeNull();
  });

  it('reports no-show through the cancel endpoint with the no_show reason', async () => {
    const onCancelled = vi.fn();
    const { result } = await renderOpenHook({ onCancelled });
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    await act(async () => result.current.markNoShow());

    const [, init] = fetchMock.mock.calls.at(-1)!;

    expect(JSON.parse(init.body).cancelReason).toBe('no_show');
    expect(onCancelled).toHaveBeenCalledWith('appt_1', 'no_show');
  });

  it('surfaces resend-confirmation failures in detailError', async () => {
    const { result } = await renderOpenHook();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'Email provider unavailable' } }, 502));

    await act(async () => result.current.resendConfirmation());

    expect(result.current.detailError).toBe('Email provider unavailable');
  });

  it('notifies optimistic status changes for start, complete, and confirm', async () => {
    const onOptimisticStatus = vi.fn();
    const { result } = await renderOpenHook({ onOptimisticStatus });

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.startAppointment());

    expect(onOptimisticStatus).toHaveBeenCalledWith('appt_1', 'in_progress');

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    queueDetailFetch();
    await act(async () => result.current.confirmAppointment());

    expect(onOptimisticStatus).toHaveBeenCalledWith('appt_1', 'confirmed');
  });

  it('builds a rebook prefill from the loaded detail', async () => {
    const { result } = await renderOpenHook();

    expect(result.current.buildRebookPrefill()).toEqual({
      name: 'Ava Client',
      phone: '4165551234',
      email: 'ava@example.com',
      serviceId: 'srv_1',
      technicianId: 'tech_1',
    });
  });
});
