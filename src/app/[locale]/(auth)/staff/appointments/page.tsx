'use client';

import { useUser } from '@clerk/nextjs';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import {
  AppointmentsDayView,
  type CalendarAppointment,
} from '@/components/appointments/AppointmentsDayView';
import { CheckoutSheet } from '@/components/appointments/CheckoutSheet';
import { StaffBottomNav, StaffHeader } from '@/components/staff';
import type { StaffAppointmentData } from '@/components/staff/appointments/types';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { type CancelArgs, useAppointmentActions } from '@/hooks/useAppointmentActions';
import { themeVars } from '@/theme';

type StaffAppointmentsResponse = {
  data?: {
    appointments?: StaffAppointmentData[];
  };
  meta?: {
    slotIntervalMinutes?: number;
  };
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

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function toCalendarAppointments(appointments: StaffAppointmentData[]): CalendarAppointment[] {
  return appointments.map(appointment => ({
    id: appointment.id,
    clientName: appointment.clientName,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    technicianId: appointment.technicianId,
    technicianName: null,
    serviceLabel: appointment.services?.map(service => service.name).join(', ') || 'Service',
    totalPrice: appointment.totalPrice,
    totalDurationMinutes: appointment.totalDurationMinutes
      ?? Math.max(0, (new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime()) / 60000),
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

function StaffAppointmentsContent() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';

  const [appointments, setAppointments] = useState<StaffAppointmentData[]>([]);
  const [calendarAppointments, setCalendarAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState(15);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestAppointmentsFetchIdRef = useRef(0);
  const [currentPhotoType, setCurrentPhotoType] = useState<'before' | 'after'>('after');

  const appointmentIdParam = searchParams.get('appointmentId');

  const syncUpdatedCalendarEvent = useCallback((calendarEvent: CalendarAppointment) => {
    setCalendarAppointments(current => patchAppointment(current, calendarEvent));
    setAppointments(current => current.map(appointment => (
      appointment.id === calendarEvent.id
        ? {
            ...appointment,
            startTime: calendarEvent.startTime,
            endTime: calendarEvent.endTime,
            status: calendarEvent.status,
            totalPrice: calendarEvent.totalPrice,
            totalDurationMinutes: calendarEvent.totalDurationMinutes,
            technicianId: calendarEvent.technicianId,
            services: [{ name: calendarEvent.serviceLabel }],
          }
        : appointment
    )));
  }, []);

  const actions = useAppointmentActions({
    onMutationApplied: (result) => {
      syncUpdatedCalendarEvent(result.calendarEvent);
    },
    onCancelled: (appointmentId) => {
      setAppointments(current => current.filter(appointment => appointment.id !== appointmentId));
      setCalendarAppointments(current => current.filter(appointment => appointment.id !== appointmentId));
    },
    onOptimisticStatus: (appointmentId, status) => {
      setAppointments(current => current.map(appointment => (
        appointment.id === appointmentId ? { ...appointment, status } : appointment
      )));
      setCalendarAppointments(current => current.map(appointment => (
        appointment.id === appointmentId
          ? { ...appointment, status, isLocked: status === 'in_progress' || status === 'completed' }
          : appointment
      )));
    },
  });
  const { openAppointment, runManageMutation, setDetailError, setAttemptedTimeLabel } = actions;

  const selectedAppointment = useMemo(
    () => appointments.find(appointment => appointment.id === actions.selectedAppointmentId) ?? null,
    [appointments, actions.selectedAppointmentId],
  );

  const fetchAppointments = useCallback(async () => {
    const fetchId = latestAppointmentsFetchIdRef.current + 1;
    latestAppointmentsFetchIdRef.current = fetchId;

    try {
      setLoading(true);
      setError(null);
      const dateStr = getLocalDateKey(selectedDate);
      const response = await fetch(`/api/appointments?date=${dateStr}&status=pending,confirmed,in_progress,completed`);
      if (!response.ok) {
        throw new Error('Failed to fetch appointments');
      }

      const data = await response.json() as StaffAppointmentsResponse;
      if (latestAppointmentsFetchIdRef.current !== fetchId) {
        return;
      }

      const nextAppointments = data.data?.appointments ?? [];
      setAppointments(nextAppointments);
      setCalendarAppointments(toCalendarAppointments(nextAppointments));
      setSlotIntervalMinutes(data.meta?.slotIntervalMinutes ?? 15);

      if (appointmentIdParam) {
        const target = nextAppointments.find(appointment => appointment.id === appointmentIdParam);
        if (target) {
          openAppointment(target.id);
        }
      }
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
  }, [appointmentIdParam, openAppointment, selectedDate]);

  useEffect(() => {
    if (isLoaded) {
      void fetchAppointments();
    }
  }, [isLoaded, fetchAppointments]);

  const handleMoveAppointment = useCallback(async (args: {
    appointmentId: string;
    startTime: string;
  }) => {
    const previous = calendarAppointments.find(appointment => appointment.id === args.appointmentId);
    if (!previous) {
      return;
    }

    const start = new Date(args.startTime);
    const end = new Date(start.getTime() + (new Date(previous.endTime).getTime() - new Date(previous.startTime).getTime()));
    setCalendarAppointments(current => current.map(appointment => (
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
      setCalendarAppointments(current => patchAppointment(current, previous));
      openAppointment(args.appointmentId);
      setDetailError(
        typeof moveError === 'object' && moveError !== null && 'message' in moveError
          ? String((moveError as { message?: unknown }).message)
          : 'Unable to move appointment',
      );
      setAttemptedTimeLabel(formatAttemptedTime(args.startTime));
    }
  }, [calendarAppointments, openAppointment, runManageMutation, setAttemptedTimeLabel, setDetailError]);

  const handlePhotoUpload = async (file: File, photoType: 'before' | 'after') => {
    if (!actions.selectedAppointmentId) {
      return;
    }

    setUploadingPhoto(true);
    setDetailError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('photoType', photoType);

      const response = await fetch(`/api/appointments/${actions.selectedAppointmentId}/photos`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const result = await response.json();
        throw result.error ?? new Error('Upload failed');
      }

      await fetchAppointments();
    } catch (uploadError) {
      setDetailError(
        typeof uploadError === 'object' && uploadError !== null && 'message' in uploadError
          ? String((uploadError as { message?: unknown }).message)
          : 'Upload failed',
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const resourceId = appointments[0]?.technicianId ?? 'my-calendar';

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: themeVars.background }}>
        <div className="w-full max-w-md">
          <AsyncStatePanel
            loading
            title="Loading appointments"
            description="Preparing the staff schedule workspace."
          />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: themeVars.background }}>
        <div className="w-full max-w-md">
          <AsyncStatePanel
            icon="🔐"
            title="Staff Access Required"
            description="Please sign in to access this page."
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-24"
      style={{
        background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4">
        <div className="pb-4 pt-6">
          <StaffHeader
            title="Appointments"
            subtitle={`Day view (${appointments.length})`}
            showBack
            onBack={() => router.push(`/${locale}/staff`)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/60 bg-white shadow-sm">
          <AppointmentsDayView
            selectedDate={selectedDate}
            onSelectedDateChange={setSelectedDate}
            appointments={calendarAppointments}
            resources={[{ id: resourceId, label: 'My calendar' }]}
            slotIntervalMinutes={slotIntervalMinutes}
            loading={loading}
            error={error}
            onRetry={fetchAppointments}
            onAppointmentSelect={actions.openAppointment}
            onMoveAppointment={({ appointmentId, startTime }) => void handleMoveAppointment({ appointmentId, startTime })}
            emptyTitle="No appointments scheduled"
            emptyDescription="As soon as you have assigned appointments for this day, they will appear here."
            resourceLabel="View"
            includeUnassignedResource={false}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handlePhotoUpload(file, currentPhotoType);
          }
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }}
      />

      <AppointmentQuickEditSheet
        isOpen={Boolean(actions.selectedAppointmentId)}
        onClose={actions.closeAppointment}
        detail={actions.detail}
        loading={actions.detailLoading}
        saving={actions.detailSaving}
        actionError={actions.detailError}
        attemptedTimeLabel={actions.attemptedTimeLabel}
        warnings={actions.warnings}
        photos={selectedAppointment?.photos ?? []}
        uploadingPhoto={uploadingPhoto}
        onUploadPhoto={(photoType) => {
          setCurrentPhotoType(photoType);
          fileInputRef.current?.click();
        }}
        onSaveEdits={actions.saveEdits}
        onMoveToNextAvailable={actions.moveToNextAvailable}
        onCancelAppointment={args => actions.cancelAppointment(args as CancelArgs)}
        onMarkCompleted={() => actions.openCheckout()}
        onStartAppointment={actions.startAppointment}
        onViewReceipt={actions.openReceipt}
        onRetryLoad={() => void actions.refreshDetail()}
        onReminderSent={() => actions.refreshDetail()}
      />

      <CheckoutSheet
        isOpen={actions.checkoutOpen}
        appointmentId={actions.selectedAppointmentId}
        initialView={actions.checkoutInitialView}
        onClose={actions.closeCheckout}
        onCompleted={() => actions.handleCheckoutCompleted()}
      />

      <StaffBottomNav activeItem="photos" />
    </div>
  );
}

export default function StaffAppointmentsPage() {
  return (
    <Suspense fallback={(
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <AsyncStatePanel
            loading
            title="Loading appointments"
            description="Preparing the staff appointments workspace."
          />
        </div>
      </div>
    )}
    >
      <StaffAppointmentsContent />
    </Suspense>
  );
}
