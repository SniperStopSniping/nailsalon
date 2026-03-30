'use client';

import { useUser } from '@clerk/nextjs';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppointmentQuickEditSheet } from '@/components/appointments/AppointmentQuickEditSheet';
import {
  AppointmentsDayView,
  type CalendarAppointment,
} from '@/components/appointments/AppointmentsDayView';
import type { AppointmentManageDetail, ManageWarning } from '@/libs/appointmentManage';
import { StaffBottomNav, StaffHeader } from '@/components/staff';
import type { StaffAppointmentData } from '@/components/staff/appointments/types';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
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

function toCalendarAppointments(appointments: StaffAppointmentData[]): CalendarAppointment[] {
  return appointments.map(appointment => ({
    id: appointment.id,
    clientName: appointment.clientName,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    technicianId: appointment.technicianId,
    technicianName: null,
    serviceLabel: appointment.services.map(service => service.name).join(', ') || 'Service',
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
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppointmentManageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attemptedTimeLabel, setAttemptedTimeLabel] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ManageWarning[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestAppointmentsFetchIdRef = useRef(0);
  const [currentPhotoType, setCurrentPhotoType] = useState<'before' | 'after'>('after');

  const appointmentIdParam = searchParams.get('appointmentId');

  const selectedAppointment = useMemo(
    () => appointments.find(appointment => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId],
  );

  const fetchAppointments = useCallback(async () => {
    const fetchId = latestAppointmentsFetchIdRef.current + 1;
    latestAppointmentsFetchIdRef.current = fetchId;

    try {
      setLoading(true);
      setError(null);
      const dateStr = selectedDate.toISOString().split('T')[0];
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
          setSelectedAppointmentId(target.id);
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
  }, [appointmentIdParam, selectedDate]);

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
      console.error('Failed to load appointment detail:', fetchError);
      setDetail(null);
      setDetailError('Failed to load appointment details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoaded) {
      void fetchAppointments();
    }
  }, [isLoaded, fetchAppointments]);

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

  const syncUpdatedCalendarEvent = useCallback((calendarEvent: CalendarAppointment) => {
    setCalendarAppointments(current => patchAppointment(current, calendarEvent));
    setAppointments(current => current.map((appointment) => (
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

  const applyMutationResult = useCallback((result: {
    detail: AppointmentManageDetail;
    calendarEvent: CalendarAppointment;
    warnings?: ManageWarning[];
  }) => {
    setDetail(result.detail);
    syncUpdatedCalendarEvent(result.calendarEvent);
    setWarnings(result.warnings ?? []);
    setDetailError(null);
    setAttemptedTimeLabel(null);
  }, [syncUpdatedCalendarEvent]);

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
    setCalendarAppointments(current => current.map((appointment) => (
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
      const result = await response.json();
      if (!response.ok) {
        throw result.error ?? new Error('Move failed');
      }
      applyMutationResult(result.data);
    } catch (moveError) {
      setCalendarAppointments(current => patchAppointment(current, previous));
      setSelectedAppointmentId(args.appointmentId);
      setDetailError(
        typeof moveError === 'object' && moveError !== null && 'message' in moveError
          ? String((moveError as { message?: unknown }).message)
          : 'Unable to move appointment',
      );
      setAttemptedTimeLabel(formatAttemptedTime(args.startTime));
    }
  }, [applyMutationResult, calendarAppointments]);

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

  const handlePhotoUpload = async (file: File, photoType: 'before' | 'after') => {
    if (!selectedAppointmentId) {
      return;
    }

    setUploadingPhoto(true);
    setDetailError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('photoType', photoType);

      const response = await fetch(`/api/appointments/${selectedAppointmentId}/photos`, {
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
          ? { ...appointment, status: 'in_progress' }
          : appointment
      )));
      setCalendarAppointments(current => current.map((appointment) => (
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
          ? { ...appointment, status: 'completed' }
          : appointment
      )));
      setCalendarAppointments(current => current.map((appointment) => (
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
      setCalendarAppointments(current => current.filter(appointment => appointment.id !== selectedAppointmentId));
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
      });
      return;
    }

    if (nextStartTime !== originalStartTime) {
      await runManageMutation(selectedAppointmentId, {
        operation: 'move',
        startTime: nextStartTime,
      });
    }
  }, [detail, runManageMutation, selectedAppointmentId]);

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
            onAppointmentSelect={setSelectedAppointmentId}
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
        photos={selectedAppointment?.photos ?? []}
        uploadingPhoto={uploadingPhoto}
        onUploadPhoto={(photoType) => {
          setCurrentPhotoType(photoType);
          fileInputRef.current?.click();
        }}
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
