'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import {
  AppointmentsDayView,
  type CalendarAppointment,
  type CalendarResource,
} from '@/components/appointments/AppointmentsDayView';
import { type CancelArgs, type RebookPrefill, useAppointmentActions } from '@/hooks/useAppointmentActions';

import { BackButton, ModalHeader } from './AppModal';
import { NewAppointmentModal } from './NewAppointmentModal';

type AppointmentsModalProps = {
  onClose: () => void;
  initialAppointmentId?: string | null;
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

export function AppointmentsModal({ onClose, initialAppointmentId = null }: AppointmentsModalProps) {
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [resources, setResources] = useState<CalendarResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState(15);
  const [showNewAppointmentModal, setShowNewAppointmentModal] = useState(false);
  const [rebookPrefill, setRebookPrefill] = useState<RebookPrefill | null>(null);
  const latestAppointmentsFetchIdRef = useRef(0);

  const actions = useAppointmentActions({
    onMutationApplied: (result) => {
      setAppointments(current => patchAppointment(current, result.calendarEvent));
    },
    onCancelled: (appointmentId) => {
      setAppointments(current => current.filter(appointment => appointment.id !== appointmentId));
    },
    onOptimisticStatus: (appointmentId, status) => {
      setAppointments(current => current.map(appointment => (
        appointment.id === appointmentId
          ? { ...appointment, status, isLocked: status === 'in_progress' || status === 'completed' }
          : appointment
      )));
    },
  });
  const { openAppointment, runManageMutation, setDetailError, setAttemptedTimeLabel } = actions;

  useEffect(() => {
    if (initialAppointmentId) {
      openAppointment(initialAppointmentId);
    }
  }, [initialAppointmentId, openAppointment]);

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
    } catch {
      if (latestAppointmentsFetchIdRef.current !== fetchId) {
        return;
      }

      setError('Failed to load appointments');
    } finally {
      if (latestAppointmentsFetchIdRef.current === fetchId) {
        setLoading(false);
      }
    }
  }, [selectedDate]);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

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
    setAppointments(current => current.map(appointment => (
      appointment.id === args.appointmentId
        ? { ...appointment, startTime: start.toISOString(), endTime: end.toISOString() }
        : appointment
    )));

    try {
      await runManageMutation(args.appointmentId, {
        operation: 'move',
        startTime: new Date(args.startTime).toISOString(),
      });
    } catch (moveError) {
      setAppointments(current => patchAppointment(current, previous));
      openAppointment(args.appointmentId);
      setDetailError(
        typeof moveError === 'object' && moveError !== null && 'message' in moveError
          ? String((moveError as { message?: unknown }).message)
          : 'Unable to move appointment',
      );
      setAttemptedTimeLabel(formatAttemptedTime(args.startTime));
    }
  }, [appointments, openAppointment, runManageMutation, setAttemptedTimeLabel, setDetailError]);

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
        onAppointmentSelect={actions.openAppointment}
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
        isOpen={Boolean(actions.selectedAppointmentId)}
        onClose={actions.closeAppointment}
        detail={actions.detail}
        loading={actions.detailLoading}
        saving={actions.detailSaving}
        actionError={actions.detailError}
        attemptedTimeLabel={actions.attemptedTimeLabel}
        warnings={actions.warnings}
        onSaveEdits={actions.saveEdits}
        onMoveToNextAvailable={actions.moveToNextAvailable}
        onCancelAppointment={args => actions.cancelAppointment(args as CancelArgs)}
        onMarkCompleted={() => actions.completeAppointment()}
        onStartAppointment={actions.startAppointment}
        onConfirmAppointment={actions.confirmAppointment}
        onMarkNoShow={actions.markNoShow}
        onResendConfirmation={actions.resendConfirmation}
        completionNeedsPhotoDecision={actions.completionNeedsPhotoDecision}
        onResolvePhotoDecision={(skip) => {
          if (skip) {
            void actions.completeAppointment({ skipPhotoValidation: true });
          } else {
            actions.dismissPhotoDecision();
          }
        }}
        onRetryLoad={() => void actions.refreshDetail()}
        onRebook={() => {
          const prefill = actions.buildRebookPrefill();
          if (!prefill) {
            return;
          }
          setRebookPrefill(prefill);
          actions.closeAppointment();
          setShowNewAppointmentModal(true);
        }}
      />

      <NewAppointmentModal
        isOpen={showNewAppointmentModal}
        onClose={() => {
          setShowNewAppointmentModal(false);
          setRebookPrefill(null);
        }}
        onSuccess={() => {
          void fetchAppointments();
        }}
        preselectedDate={selectedDate}
        clientPrefill={rebookPrefill}
      />
    </div>
  );
}
