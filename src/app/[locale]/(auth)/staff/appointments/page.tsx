'use client';

import { useUser } from '@clerk/nextjs';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { AppointmentWorkflowDialogs } from '@/components/staff/appointments/AppointmentWorkflowDialogs';
import { StaffAppointmentsList } from '@/components/staff/appointments/StaffAppointmentsList';
import type {
  PaymentMethod,
  StaffAppointmentData,
} from '@/components/staff/appointments/types';
import { StaffBottomNav, StaffHeader } from '@/components/staff';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { themeVars } from '@/theme';

// =============================================================================
// Staff Appointments Page - Enhanced with Full Workflow
// =============================================================================

function StaffAppointmentsContent() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';

  const [appointments, setAppointments] = useState<StaffAppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState<StaffAppointmentData | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentPhotoType, setCurrentPhotoType] = useState<'before' | 'after'>('after');

  // Check for appointmentId in URL params (from dashboard redirect)
  const appointmentIdParam = searchParams.get('appointmentId');

  // Fetch today's appointments
  const fetchAppointments = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments?date=today&status=confirmed,in_progress');
      if (response.ok) {
        const data = await response.json();
        const appts = data.data?.appointments || [];
        setAppointments(appts);

        // Auto-select appointment if specified in URL
        if (appointmentIdParam) {
          const targetAppt = appts.find((a: StaffAppointmentData) => a.id === appointmentIdParam);
          if (targetAppt) {
            setSelectedAppointment(targetAppt);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [appointmentIdParam]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      fetchAppointments();
    }
  }, [isLoaded, fetchAppointments]);

  // Handle photo upload
  const handlePhotoUpload = async (file: File, photoType: 'before' | 'after') => {
    if (!selectedAppointment) {
      return;
    }

    setUploadingPhoto(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('photoType', photoType);

      const response = await fetch(`/api/appointments/${selectedAppointment.id}/photos`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Upload failed');
      }

      // Refresh appointments
      await fetchAppointments();

      // Update selected appointment
      const updatedResponse = await fetch('/api/appointments?date=today&status=confirmed,in_progress');
      if (updatedResponse.ok) {
        const data = await updatedResponse.json();
        const updated = data.data?.appointments?.find(
          (a: StaffAppointmentData) => a.id === selectedAppointment.id,
        );
        if (updated) {
          setSelectedAppointment(updated);
        }
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handlePhotoUpload(file, currentPhotoType);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Trigger file input for specific photo type
  const triggerFileInput = (photoType: 'before' | 'after') => {
    setCurrentPhotoType(photoType);
    fileInputRef.current?.click();
  };

  // Handle start appointment
  const handleStart = async () => {
    if (!selectedAppointment) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments/${selectedAppointment.id}/complete`, {
        method: 'POST',
      });

      if (response.ok) {
        await fetchAppointments();
        // Update selected
        const updatedResponse = await fetch('/api/appointments?date=today&status=confirmed,in_progress');
        if (updatedResponse.ok) {
        const data = await updatedResponse.json();
        const updated = data.data?.appointments?.find(
          (a: StaffAppointmentData) => a.id === selectedAppointment.id,
        );
        if (updated) {
          setSelectedAppointment(updated);
          }
        }
      }
    } catch (error) {
      console.error('Failed to start appointment:', error);
    }
  };

  // Handle complete appointment
  const handleComplete = async () => {
    if (!selectedAppointment) {
      return;
    }

    setCompleting(true);
    setUploadError(null);

    try {
      const response = await fetch(`/api/appointments/${selectedAppointment.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'paid' }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to complete appointment');
      }

      // Refresh and close
      await fetchAppointments();
      setSelectedAppointment(null);
      setShowCompleteDialog(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to complete');
    } finally {
      setCompleting(false);
    }
  };

  // Handle cancel appointment
  const handleCancel = async (reason: string) => {
    if (!selectedAppointment) {
      return;
    }

    setCancelling(true);

    try {
      const response = await fetch(`/api/appointments/${selectedAppointment.id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: reason }),
      });

      if (response.ok) {
        await fetchAppointments();
        setSelectedAppointment(null);
        setShowCancelDialog(false);
      }
    } catch (error) {
      console.error('Failed to cancel:', error);
    } finally {
      setCancelling(false);
    }
  };

  // Format time for display
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Format price
  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`;
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: themeVars.background }}>
        <div className="w-full max-w-md px-4">
          <AsyncStatePanel
            loading
            title="Loading staff appointments"
            description="Checking your session and today’s appointment list."
          />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: themeVars.background }}
      >
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
      <div className="mx-auto max-w-2xl px-4">
        <div
          className="pb-4 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <StaffHeader
            title="Photo Upload"
            subtitle={`Today’s Appointments (${appointments.length})`}
            showBack
            onBack={() => router.push(`/${locale}/staff`)}
          />
        </div>

        {/* Loading */}
        {loading && (
          <AsyncStatePanel
            loading
            title="Loading appointments"
            description="Pulling the current workflow queue for today."
          />
        )}

        {/* Appointments List */}
        {!loading && appointments.length === 0 && (
          <AsyncStatePanel
            icon="☀️"
            title="No active appointments today"
            description="As soon as a booking needs photos or workflow updates, it will appear here."
          />
        )}

        {!loading && appointments.length > 0 && (
          <StaffAppointmentsList
            appointments={appointments}
            mounted={mounted}
            onSelect={setSelectedAppointment}
            formatTime={formatTime}
            formatPrice={formatPrice}
          />
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      <AppointmentWorkflowDialogs
        appointment={selectedAppointment}
        showCompleteDialog={showCompleteDialog}
        showCancelDialog={showCancelDialog}
        uploadingPhoto={uploadingPhoto}
        uploadError={uploadError}
        completing={completing}
        cancelling={cancelling}
        paymentMethod={paymentMethod}
        onCloseWorkflow={() => {
          if (!uploadingPhoto) {
            setSelectedAppointment(null);
            setUploadError(null);
          }
        }}
        onStart={handleStart}
        onTriggerFileInput={triggerFileInput}
        onOpenCompleteDialog={() => setShowCompleteDialog(true)}
        onCloseCompleteDialog={() => {
          if (!completing) {
            setShowCompleteDialog(false);
          }
        }}
        onComplete={handleComplete}
        onOpenCancelDialog={() => setShowCancelDialog(true)}
        onCloseCancelDialog={() => {
          if (!cancelling) {
            setShowCancelDialog(false);
          }
        }}
        onCancel={handleCancel}
        onPaymentMethodChange={setPaymentMethod}
        formatTime={formatTime}
        formatPrice={formatPrice}
      />

      {/* Bottom Navigation */}
      <StaffBottomNav activeItem="photos" />
    </div>
  );
}

// Wrap in Suspense for useSearchParams
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
