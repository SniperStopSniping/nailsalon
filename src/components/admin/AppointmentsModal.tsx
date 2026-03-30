'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import {
  AppointmentsDayView,
  type CalendarAppointment,
  type CalendarResource,
} from '@/components/appointments/AppointmentsDayView';
import type { AppointmentManageDetail, ManageWarning } from '@/libs/appointmentManage';

import { BackButton, ModalHeader } from './AppModal';
import { NewAppointmentModal } from './NewAppointmentModal';

type AppointmentsModalProps = {
  onClose: () => void;
};

type AdminAppointmentsResponse = {
  data?: {
    appointments?: AdminAppointmentRecord[];
    technicians?: Array<{ id: string; name: string }>;
  };
  meta?: {
    slotIntervalMinutes?: number;
  };
};

type AdminAppointmentRecord = {
  id: string;
  clientName: string | null;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
  totalDurationMinutes: number;
  locationId?: string | null;
  services?: Array<{ name: string }>;
  technician?: { id: string; name: string } | null;
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

function toCalendarAppointments(
  appointments: AdminAppointmentRecord[] = [],
): CalendarAppointment[] {
  return appointments.map(appointment => ({
    id: appointment.id,
    clientName: appointment.clientName,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    technicianId: appointment.technician?.id ?? null,
    technicianName: appointment.technician?.name ?? null,
    serviceLabel: appointment.services?.map(service => service.name).join(', ') || 'Service',
    totalPrice: appointment.totalPrice,
    totalDurationMinutes: appointment.totalDurationMinutes,
    locationName: null,
    isLocked: appointment.status === 'in_progress',
  }));
}

function patchAppointment(
  appointments: CalendarAppointment[],
  updated: CalendarAppointment,
) {
  return appointments.map(appointment => appointment.id === updated.id ? updated : appointment);
}

export function AppointmentsModal({ onClose }: AppointmentsModalProps) {
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [resources, setResources] = useState<CalendarResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState(15);
  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppointmentManageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attemptedTimeLabel, setAttemptedTimeLabel] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ManageWarning[]>([]);
  const latestAppointmentsFetchIdRef = useRef(0);

  const fetchAppointments = useCallback(async () => {
    const fetchId = latestAppointmentsFetchIdRef.current + 1;
    latestAppointmentsFetchIdRef.current = fetchId;

    try {
      setLoading(true);
      setError(null);

      const dateStr = selectedDate.toISOString().split('T')[0];
      const response = await fetch(
        `/api/admin/appointments?date=${dateStr}&status=pending,confirmed,in_progress,completed`,
      );

      if (!response.ok) {
        throw new Error('Failed to load appointments');
      }

      const result = await response.json() as AdminAppointmentsResponse;
      if (latestAppointmentsFetchIdRef.current !== fetchId) {
        return;
      }

      setAppointments(toCalendarAppointments(result.data?.appointments));
      setResources(result.data?.technicians?.map(technician => ({
        id: technician.id,
        label: technician.name,
      })) ?? []);
      setSlotIntervalMinutes(result.meta?.slotIntervalMinutes ?? 15);
    } catch (fetchError) {
      if (latestAppointmentsFetchIdRef.current !== fetchId) {
        return;
      }

      console.error('Failed to fetch appointments:', fetchError);
      setError('Failed to load appointments');
    } finally {
      if (latestAppointmentsFetchIdRef.current === fetchId) {
        setLoading(false);
      }
    }
  }, [selectedDate]);

  const fetchDetail = useCallback(async (appointmentId: string) => {
    try {
      setDetailLoading(true);
      setDetailError(null);
      setAttemptedTimeLabel(null);
      setWarnings([]);

      const response = await fetch(`/api/appointments/${appointmentId}/manage`);
      if (!response.ok) {
        throw new Error('Failed to load appointment details');
      }

      const result = await response.json();
      setDetail(result.data ?? null);
    } catch (fetchError) {
      console.error('Failed to fetch manage detail:', fetchError);
      setDetailError('Failed to load appointment details');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

  useEffect(() => {
    if (!selectedAppointmentId) {
      setDetail(null);
      setDetailError(null);
      setAttemptedTimeLabel(null);
      setWarnings([]);
      return;
    }

    void fetchDetail(selectedAppointmentId);
  }, [fetchDetail, selectedAppointmentId]);

  const applyMutationResult = useCallback((result: {
    detail: AppointmentManageDetail;
    calendarEvent: CalendarAppointment;
    warnings?: ManageWarning[];
  }) => {
    setDetail(result.detail);
    setAppointments(current => patchAppointment(current, result.calendarEvent));
    setWarnings(result.warnings ?? []);
    setDetailError(null);
    setAttemptedTimeLabel(null);
  }, []);

  const handleMoveAppointment = useCallback(async (args: {
    appointmentId: string;
    startTime: string;
  }) => {
    const previous = appointments.find(appointment => appointment.id === args.appointmentId);
    if (!previous) {
      return;
    }

    const start = new Date(args.startTime);
    const end = new Date(start.getTime() + (new Date(previous.endTime).getTime() - new Date(previous.startTime).getTime()));
    setAppointments(current => current.map((appointment) => (
      appointment.id === args.appointmentId
        ? { ...appointment, startTime: start.toISOString(), endTime: end.toISOString() }
        : appointment
    )));

    try {
      const response = await fetch(`/api/appointments/${args.appointmentId}/manage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'move',
          startTime: new Date(args.startTime).toISOString(),
        }),
      });

      if (!response.ok) {
        const payload = await response.json();
        throw payload.error ?? new Error('Move failed');
      }

      const result = await response.json();
      applyMutationResult(result.data);
    } catch (moveError) {
      setAppointments(current => patchAppointment(current, previous));
      setSelectedAppointmentId(args.appointmentId);
      setDetailError(
        typeof moveError === 'object' && moveError !== null && 'message' in moveError
          ? String((moveError as { message?: unknown }).message)
          : 'Unable to move appointment',
      );
      setAttemptedTimeLabel(formatAttemptedTime(args.startTime));
    }
  }, [appointments, applyMutationResult]);

  const runManageMutation = useCallback(async (
    appointmentId: string,
    payload: Record<string, unknown>,
  ) => {
    setDetailSaving(true);
    setDetailError(null);

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/manage`, {
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
      setDetailError(
        typeof mutationError === 'object' && mutationError !== null && 'message' in mutationError
          ? String((mutationError as { message?: unknown }).message)
          : 'Unable to update appointment',
      );
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
  }, [applyMutationResult]);

  const handleSaveEdits = useCallback(async (args: {
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

  const handleStartAppointment = useCallback(async () => {
    if (!selectedAppointmentId) {
      return;
    }

    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/appointments/${selectedAppointmentId}/complete`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Unable to start appointment');
      }

      setAppointments(current => current.map((appointment) => (
        appointment.id === selectedAppointmentId
          ? { ...appointment, status: 'in_progress', isLocked: true }
          : appointment
      )));
      await fetchDetail(selectedAppointmentId);
    } catch (startError) {
      setDetailError(
        typeof startError === 'object' && startError !== null && 'message' in startError
          ? String((startError as { message?: unknown }).message)
          : 'Unable to start appointment',
      );
    } finally {
      setDetailSaving(false);
    }
  }, [fetchDetail, selectedAppointmentId]);

  const handleCompleteAppointment = useCallback(async () => {
    if (!selectedAppointmentId) {
      return;
    }

    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/appointments/${selectedAppointmentId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'paid' }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Unable to complete appointment');
      }

      setAppointments(current => current.map((appointment) => (
        appointment.id === selectedAppointmentId
          ? { ...appointment, status: 'completed', isLocked: true }
          : appointment
      )));
      await fetchDetail(selectedAppointmentId);
    } catch (completeError) {
      setDetailError(
        typeof completeError === 'object' && completeError !== null && 'message' in completeError
          ? String((completeError as { message?: unknown }).message)
          : 'Unable to complete appointment',
      );
    } finally {
      setDetailSaving(false);
    }
  }, [fetchDetail, selectedAppointmentId]);

  const handleCancelAppointment = useCallback(async (reason: string) => {
    if (!selectedAppointmentId) {
      return;
    }

    setDetailSaving(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/appointments/${selectedAppointmentId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: reason }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Unable to cancel appointment');
      }

      setAppointments(current => current.filter(appointment => appointment.id !== selectedAppointmentId));
      setSelectedAppointmentId(null);
    } catch (cancelError) {
      setDetailError(
        typeof cancelError === 'object' && cancelError !== null && 'message' in cancelError
          ? String((cancelError as { message?: unknown }).message)
          : 'Unable to cancel appointment',
      );
    } finally {
      setDetailSaving(false);
    }
  }, [selectedAppointmentId]);

  return (
    <div className="flex min-h-full w-full flex-col bg-white font-sans text-black">
      <ModalHeader
        title={selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}
        subtitle={selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        leftAction={<BackButton onClick={onClose} label="Back" />}
      />

      <AppointmentsDayView
        selectedDate={selectedDate}
        onSelectedDateChange={setSelectedDate}
        appointments={appointments}
        resources={resources}
        slotIntervalMinutes={slotIntervalMinutes}
        loading={loading}
        error={error}
        onRetry={fetchAppointments}
        onAppointmentSelect={setSelectedAppointmentId}
        onMoveAppointment={({ appointmentId, startTime }) => void handleMoveAppointment({ appointmentId, startTime })}
        emptyTitle="No appointments scheduled"
        emptyDescription="You are clear for the selected day."
        resourceLabel="Artist"
      />

      <button
        type="button"
        onClick={() => setShowNewAppointmentModal(true)}
        aria-label="Add new appointment"
        className="fixed bottom-8 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-[0_4px_16px_rgba(0,122,255,0.4)] transition-transform active:scale-90"
      >
        <Plus className="size-8" />
      </button>

      <AppointmentQuickEditSheet
        isOpen={Boolean(selectedAppointmentId)}
        onClose={() => {
          setSelectedAppointmentId(null);
          setDetail(null);
          setDetailError(null);
          setAttemptedTimeLabel(null);
          setWarnings([]);
        }}
        detail={detail}
        loading={detailLoading}
        saving={detailSaving}
        actionError={detailError}
        attemptedTimeLabel={attemptedTimeLabel}
        warnings={warnings}
        onSaveEdits={handleSaveEdits}
        onMoveToNextAvailable={async () => {
          if (!selectedAppointmentId) {
            return;
          }
          await runManageMutation(selectedAppointmentId, { operation: 'moveToNextAvailable' });
        }}
        onCancelAppointment={handleCancelAppointment}
        onMarkCompleted={handleCompleteAppointment}
        onStartAppointment={handleStartAppointment}
      />

      <NewAppointmentModal
        isOpen={showNewAppointmentModal}
        onClose={() => setShowNewAppointmentModal(false)}
        onSuccess={() => {
          void fetchAppointments();
        }}
        preselectedDate={selectedDate}
      />
    </div>
  );
}
