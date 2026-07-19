'use client';

import { useCallback, useEffect, useState } from 'react';

import type { CalendarAppointment } from '@/components/appointments/AppointmentsDayView';
import type { AppointmentManageDetail, ManageWarning } from '@/libs/appointmentManage';
import { notifyAppointmentDataChanged } from '@/libs/dashboardEvents';

export type AppointmentMutationResult = {
  detail: AppointmentManageDetail;
  calendarEvent: CalendarAppointment;
  warnings?: ManageWarning[];
};

export type CancelArgs = {
  reason: 'client_request' | 'no_show' | 'rescheduled';
  /** Optional internal note, appended to the appointment notes (never sent to the client). */
  internalNote?: string;
};

export type RebookPrefill = {
  name: string | null;
  phone: string;
  email: string | null;
  serviceId: string | null;
  technicianId: string | null;
};

type UseAppointmentActionsOptions = {
  /** Called after a manage mutation succeeds so the container can patch its list. */
  onMutationApplied?: (result: AppointmentMutationResult) => void;
  /** Called after a cancel/no-show succeeds (or is found already done) so the container can update its list. */
  onCancelled?: (appointmentId: string, status: 'cancelled' | 'no_show') => void;
  /** Called when a simple status change succeeds (start/complete/confirm) for optimistic list patches. */
  onOptimisticStatus?: (appointmentId: string, status: string) => void;
  /**
   * Salon the surface is pinned to. Sent as an explicit (server-verified)
   * hint so multi-salon admins can manage appointments from surfaces scoped
   * to a salon other than their active-salon cookie.
   */
  salonSlug?: string | null;
};

function formatAttemptedTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function errorMessage(error: unknown, fallback: string) {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message)
    : fallback;
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : null;
}

/**
 * One shared action model for managing an appointment, used by every surface
 * (Bookings day view, staff page, Calendar day panel, Client profile) so the
 * same appointment shows the same behavior everywhere. Server-side authz and
 * validation stay authoritative — this hook only orchestrates requests and
 * local UI state.
 */
export function useAppointmentActions(options: UseAppointmentActionsOptions = {}) {
  const { onMutationApplied, onCancelled, onOptimisticStatus, salonSlug } = options;

  const apiPath = useCallback((path: string) => (
    salonSlug ? `${path}?salonSlug=${encodeURIComponent(salonSlug)}` : path
  ), [salonSlug]);

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppointmentManageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attemptedTimeLabel, setAttemptedTimeLabel] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ManageWarning[]>([]);
  // "Mark completed" opens the dedicated checkout flow instead of finalizing.
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutInitialView, setCheckoutInitialView] = useState<'edit' | 'receipt'>('edit');

  const fetchDetail = useCallback(async (appointmentId: string) => {
    try {
      setDetailLoading(true);
      setDetailError(null);
      setAttemptedTimeLabel(null);
      setWarnings([]);

      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/manage`));
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw result?.error ?? new Error('Failed to load appointment details');
      }

      setDetail(result?.data ?? null);
    } catch (fetchError) {
      setDetail(null);
      setDetailError(errorMessage(fetchError, 'Failed to load appointment details. Check your connection and try again.'));
    } finally {
      setDetailLoading(false);
    }
  }, [apiPath]);

  useEffect(() => {
    if (!selectedAppointmentId) {
      setDetail(null);
      setDetailError(null);
      setAttemptedTimeLabel(null);
      setWarnings([]);
      setCheckoutOpen(false);
      return;
    }

    void fetchDetail(selectedAppointmentId);
  }, [fetchDetail, selectedAppointmentId]);

  const openAppointment = useCallback((appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
  }, []);

  const closeAppointment = useCallback(() => {
    setSelectedAppointmentId(null);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedAppointmentId) {
      await fetchDetail(selectedAppointmentId);
    }
  }, [fetchDetail, selectedAppointmentId]);

  const applyMutationResult = useCallback((result: AppointmentMutationResult) => {
    setDetail(result.detail);
    setWarnings(result.warnings ?? []);
    setDetailError(null);
    setAttemptedTimeLabel(null);
    onMutationApplied?.(result);
    notifyAppointmentDataChanged();
  }, [onMutationApplied]);

  const runManageMutation = useCallback(async (
    appointmentId: string,
    payload: Record<string, unknown>,
  ) => {
    setDetailSaving(true);
    setDetailError(null);

    try {
      const response = await fetch(apiPath(`/api/appointments/${appointmentId}/manage`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Update failed');
      }

      applyMutationResult(result.data);
    } catch (mutationError) {
      setDetailError(errorMessage(mutationError, 'Unable to update appointment'));
      const attemptedStartTime = typeof mutationError === 'object'
        && mutationError !== null
        && 'details' in mutationError
        && typeof (mutationError as { details?: { attemptedStartTime?: string } }).details?.attemptedStartTime === 'string'
        ? (mutationError as { details?: { attemptedStartTime?: string } }).details!.attemptedStartTime
        : null;
      setAttemptedTimeLabel(attemptedStartTime ? formatAttemptedTime(attemptedStartTime) : null);
      throw mutationError;
    } finally {
      setDetailSaving(false);
    }
  }, [apiPath, applyMutationResult]);

  const saveEdits = useCallback(async (args: {
    baseServiceId: string;
    technicianId: string | null;
    startTime: string;
  }) => {
    if (!detail || !selectedAppointmentId) {
      return;
    }

    const originalStartTime = new Date(detail.appointment.startTime).toISOString();
    const nextStartTime = new Date(args.startTime).toISOString();

    if (args.baseServiceId !== (detail.appointment.baseServiceId ?? '')) {
      await runManageMutation(selectedAppointmentId, {
        operation: 'changeService',
        baseServiceId: args.baseServiceId,
        startTime: nextStartTime,
        technicianId: args.technicianId,
      });
      return;
    }

    if (args.technicianId !== detail.appointment.technicianId && nextStartTime === originalStartTime) {
      await runManageMutation(selectedAppointmentId, {
        operation: 'reassignTechnician',
        technicianId: args.technicianId,
      });
      return;
    }

    if (nextStartTime !== originalStartTime || args.technicianId !== detail.appointment.technicianId) {
      await runManageMutation(selectedAppointmentId, {
        operation: 'move',
        startTime: nextStartTime,
        technicianId: args.technicianId,
      });
    }
  }, [detail, runManageMutation, selectedAppointmentId]);

  const moveToNextAvailable = useCallback(async () => {
    if (!selectedAppointmentId) {
      return;
    }
    await runManageMutation(selectedAppointmentId, { operation: 'moveToNextAvailable' });
  }, [runManageMutation, selectedAppointmentId]);

  const startAppointment = useCallback(async () => {
    if (!selectedAppointmentId) {
      return;
    }

    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(apiPath(`/api/appointments/${selectedAppointmentId}/complete`), {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Unable to start appointment');
      }

      onOptimisticStatus?.(selectedAppointmentId, 'in_progress');
      notifyAppointmentDataChanged();
      await fetchDetail(selectedAppointmentId);
    } catch (startError) {
      setDetailError(errorMessage(startError, 'Unable to start appointment'));
    } finally {
      setDetailSaving(false);
    }
  }, [apiPath, fetchDetail, onOptimisticStatus, selectedAppointmentId]);

  /**
   * "Mark completed" no longer finalizes anything — it opens the dedicated
   * CheckoutSheet, which owns items/photos/tax/payment and submits the
   * completion itself. This hook only tracks the open state and applies the
   * optimistic updates when the sheet reports success.
   */
  const openCheckout = useCallback(() => {
    if (!selectedAppointmentId) {
      return;
    }
    setCheckoutInitialView('edit');
    setCheckoutOpen(true);
  }, [selectedAppointmentId]);

  const openReceipt = useCallback(() => {
    if (!selectedAppointmentId) {
      return;
    }
    setCheckoutInitialView('receipt');
    setCheckoutOpen(true);
  }, [selectedAppointmentId]);

  const closeCheckout = useCallback(() => {
    setCheckoutOpen(false);
  }, []);

  /** Called by CheckoutSheet after the server confirms the completion. */
  const handleCheckoutCompleted = useCallback(() => {
    if (!selectedAppointmentId) {
      return;
    }
    onOptimisticStatus?.(selectedAppointmentId, 'completed');
    notifyAppointmentDataChanged();
    void fetchDetail(selectedAppointmentId);
  }, [fetchDetail, onOptimisticStatus, selectedAppointmentId]);

  const confirmAppointment = useCallback(async () => {
    if (!selectedAppointmentId) {
      return;
    }
    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(apiPath(`/api/appointments/${selectedAppointmentId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Unable to update appointment');
      }
      onOptimisticStatus?.(selectedAppointmentId, 'confirmed');
      notifyAppointmentDataChanged();
      await fetchDetail(selectedAppointmentId);
    } catch (statusError) {
      setDetailError(errorMessage(statusError, 'Unable to update appointment'));
    } finally {
      setDetailSaving(false);
    }
  }, [apiPath, fetchDetail, onOptimisticStatus, selectedAppointmentId]);

  const cancelAppointment = useCallback(async (args: CancelArgs) => {
    if (!selectedAppointmentId) {
      return;
    }

    const targetStatus = args.reason === 'no_show' ? 'no_show' : 'cancelled';
    const existingNotes = detail?.appointment.notes ?? '';
    // The cancel endpoint replaces notes wholesale, so the internal note is
    // appended client-side to avoid dropping what's already there.
    const notes = args.internalNote?.trim()
      ? `${existingNotes ? `${existingNotes}\n` : ''}[Cancellation note] ${args.internalNote.trim()}`
      : undefined;

    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(apiPath(`/api/appointments/${selectedAppointmentId}/cancel`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cancelReason: args.reason,
          ...(notes ? { notes } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        // Repeated cancellation is idempotent from the technician's view: if
        // the appointment is already terminal, treat it as done.
        if (errorCode(result?.error) === 'INVALID_STATE') {
          onCancelled?.(selectedAppointmentId, targetStatus);
          notifyAppointmentDataChanged();
          setSelectedAppointmentId(null);
          return;
        }
        throw result.error ?? new Error('Unable to cancel appointment');
      }

      onCancelled?.(selectedAppointmentId, targetStatus);
      notifyAppointmentDataChanged();
      setSelectedAppointmentId(null);
    } catch (cancelError) {
      setDetailError(errorMessage(cancelError, 'Unable to cancel appointment'));
    } finally {
      setDetailSaving(false);
    }
  }, [apiPath, detail, onCancelled, selectedAppointmentId]);

  const markNoShow = useCallback(async () => {
    await cancelAppointment({ reason: 'no_show' });
  }, [cancelAppointment]);

  const resendConfirmation = useCallback(async () => {
    if (!selectedAppointmentId) {
      return;
    }
    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(apiPath(`/api/appointments/${selectedAppointmentId}/resend-confirmation`), { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        throw payload.error ?? new Error('Confirmation email could not be sent');
      }
      await fetchDetail(selectedAppointmentId);
    } catch (emailError) {
      setDetailError(errorMessage(emailError, 'Confirmation email could not be sent'));
    } finally {
      setDetailSaving(false);
    }
  }, [apiPath, fetchDetail, selectedAppointmentId]);

  const buildRebookPrefill = useCallback((): RebookPrefill | null => {
    if (!detail) {
      return null;
    }
    return {
      name: detail.appointment.clientName,
      phone: detail.appointment.clientPhone,
      email: detail.appointment.clientEmail ?? null,
      serviceId: detail.appointment.baseServiceId,
      technicianId: detail.appointment.technicianId,
    };
  }, [detail]);

  return {
    selectedAppointmentId,
    openAppointment,
    closeAppointment,
    detail,
    detailLoading,
    detailSaving,
    detailError,
    attemptedTimeLabel,
    warnings,
    checkoutOpen,
    checkoutInitialView,
    openCheckout,
    openReceipt,
    closeCheckout,
    handleCheckoutCompleted,
    refreshDetail,
    runManageMutation,
    saveEdits,
    moveToNextAvailable,
    startAppointment,
    confirmAppointment,
    cancelAppointment,
    markNoShow,
    resendConfirmation,
    buildRebookPrefill,
    setAttemptedTimeLabel,
    setDetailError,
  };
}
