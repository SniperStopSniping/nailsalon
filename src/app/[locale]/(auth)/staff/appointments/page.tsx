'use client';

import { useUser } from '@clerk/nextjs';
import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { NotificationBell, StaffBottomNav } from '@/components/staff';
import { themeVars } from '@/theme';

// =============================================================================
// Types
// =============================================================================

interface AppointmentData {
  id: string;
  clientName: string | null;
  clientPhone: string;
  startTime: string;
  endTime: string;
  status: string;
  technicianId: string | null;
  services: Array<{ name: string }>;
  totalPrice: number;
  photos: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    photoType: string;
  }>;
}

type PaymentMethod = 'cash' | 'card' | 'e-transfer';

// =============================================================================
// Payment Method Selector
// =============================================================================

function PaymentMethodSelector({
  selected,
  onSelect,
}: {
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}) {
  const methods: { id: PaymentMethod; label: string; icon: string }[] = [
    { id: 'cash', label: 'Cash', icon: '💵' },
    { id: 'card', label: 'Card', icon: '💳' },
    { id: 'e-transfer', label: 'E-Transfer', icon: '📱' },
  ];

  return (
    <div className="flex gap-2">
      {methods.map((method) => (
        <button
          key={method.id}
          type="button"
          onClick={() => onSelect(method.id)}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl p-3 transition-all"
          style={{
            backgroundColor: selected === method.id ? themeVars.selectedBackground : '#f5f5f5',
            borderWidth: 2,
            borderStyle: 'solid',
            borderColor: selected === method.id ? themeVars.primary : 'transparent',
          }}
        >
          <span className="text-xl">{method.icon}</span>
          <span className="text-xs font-medium">{method.label}</span>
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Cancel Reason Selector
// =============================================================================

function CancelReasonSelector({
  onSelect,
  onCancel,
  isSubmitting,
}: {
  onSelect: (reason: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const reasons = [
    { id: 'client_request', label: 'Client Request', icon: '👤' },
    { id: 'no_show', label: 'No Show', icon: '❌' },
    { id: 'rescheduled', label: 'Rescheduled', icon: '📅' },
  ];

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-neutral-700">Select cancellation reason:</div>
      <div className="space-y-2">
        {reasons.map((reason) => (
          <button
            key={reason.id}
            type="button"
            onClick={() => onSelect(reason.id)}
            disabled={isSubmitting}
            className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all hover:bg-neutral-100 disabled:opacity-50"
            style={{ backgroundColor: themeVars.surfaceAlt }}
          >
            <span className="text-xl">{reason.icon}</span>
            <span className="font-medium">{reason.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-xl py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100"
      >
        Back
      </button>
    </div>
  );
}

// =============================================================================
// Staff Appointments Page - Enhanced with Full Workflow
// =============================================================================

function StaffAppointmentsContent() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || 'en';

  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null);
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
          const targetAppt = appts.find((a: AppointmentData) => a.id === appointmentIdParam);
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
    if (!selectedAppointment) return;

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
          (a: AppointmentData) => a.id === selectedAppointment.id,
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
    if (!selectedAppointment) return;

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
            (a: AppointmentData) => a.id === selectedAppointment.id,
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
    if (!selectedAppointment) return;

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
    if (!selectedAppointment) return;

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
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: themeVars.background }}
      >
        <h1 className="mb-4 text-2xl font-bold" style={{ color: themeVars.titleText }}>
          Staff Access Required
        </h1>
        <p className="text-neutral-600">Please sign in to access this page.</p>
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
        {/* Header */}
        <div
          className="pb-4 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(`/${locale}/staff`)}
                className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-white/60"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
                  Photo Upload
                </h1>
                <p className="text-sm text-neutral-600">
                  Today&apos;s Appointments ({appointments.length})
                </p>
              </div>
            </div>
            <NotificationBell />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div
              className="size-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
            />
          </div>
        )}

        {/* Appointments List */}
        {!loading && appointments.length === 0 && (
          <div
            className="rounded-2xl bg-white p-8 text-center shadow-lg"
            style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
          >
            <div className="mb-2 text-4xl">☀️</div>
            <p className="text-lg text-neutral-500">No active appointments today</p>
          </div>
        )}

        {!loading && appointments.length > 0 && (
          <div className="space-y-4">
            {appointments.map((appointment, index) => (
              <div
                key={appointment.id}
                className="overflow-hidden rounded-2xl bg-white shadow-lg"
                style={{
                  borderColor: themeVars.cardBorder,
                  borderWidth: 1,
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                  transition: `opacity 300ms ease-out ${100 + index * 50}ms, transform 300ms ease-out ${100 + index * 50}ms`,
                }}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-neutral-900">
                        {appointment.clientName || 'Client'}
                      </div>
                      <div className="text-sm text-neutral-600">
                        {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                      </div>
                      <div className="mt-1 text-sm" style={{ color: themeVars.accent }}>
                        {appointment.services.map((s) => s.name).join(', ')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold" style={{ color: themeVars.primary }}>
                        {formatPrice(appointment.totalPrice)}
                      </div>
                      <div
                        className="mt-1 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          background: appointment.status === 'in_progress'
                            ? themeVars.primary
                            : themeVars.selectedBackground,
                          color: appointment.status === 'in_progress'
                            ? 'white'
                            : themeVars.titleText,
                        }}
                      >
                        {appointment.status === 'in_progress' ? 'In Progress' : 'Confirmed'}
                      </div>
                    </div>
                  </div>

                  {/* Photos preview */}
                  {appointment.photos.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {appointment.photos.map((photo) => (
                        <div
                          key={photo.id}
                          className="relative size-16 overflow-hidden rounded-lg"
                        >
                          <Image
                            src={photo.thumbnailUrl || photo.imageUrl}
                            alt={photo.photoType}
                            fill
                            className="object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action button */}
                  <button
                    type="button"
                    onClick={() => setSelectedAppointment(appointment)}
                    className="mt-4 w-full rounded-full px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{ background: themeVars.accent }}
                  >
                    📸 Manage Photos & Workflow
                  </button>
                </div>
              </div>
            ))}
          </div>
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

      {/* Photo Upload Modal */}
      {selectedAppointment && !showCancelDialog && !showCompleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget && !uploadingPhoto) {
              setSelectedAppointment(null);
              setUploadError(null);
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="p-6">
              {/* Header */}
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
                  Appointment Workflow
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAppointment(null);
                    setUploadError(null);
                  }}
                  className="text-2xl text-neutral-400 hover:text-neutral-600"
                  disabled={uploadingPhoto}
                >
                  ×
                </button>
              </div>

              {/* Client info */}
              <div className="mb-4 rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                <div className="font-medium text-neutral-700">
                  {selectedAppointment.clientName || 'Client'}
                </div>
                <div className="text-sm text-neutral-500">
                  {selectedAppointment.services.map((s) => s.name).join(', ')}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm text-neutral-500">
                    {formatTime(selectedAppointment.startTime)} - {formatTime(selectedAppointment.endTime)}
                  </span>
                  <span className="font-bold" style={{ color: themeVars.primary }}>
                    {formatPrice(selectedAppointment.totalPrice)}
                  </span>
                </div>
              </div>

              {/* Status and start button */}
              {selectedAppointment.status === 'confirmed' && (
                <button
                  type="button"
                  onClick={handleStart}
                  className="mb-4 w-full rounded-xl py-3 text-center font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: themeVars.accent }}
                >
                  ▶ Start Appointment
                </button>
              )}

              {uploadError && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  {uploadError}
                </div>
              )}

              {/* Current Photos */}
              {selectedAppointment.photos.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium text-neutral-600">
                    Photos ({selectedAppointment.photos.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedAppointment.photos.map((photo) => (
                      <div
                        key={photo.id}
                        className="relative size-20 overflow-hidden rounded-lg"
                      >
                        <Image
                          src={photo.thumbnailUrl || photo.imageUrl}
                          alt={photo.photoType}
                          fill
                          className="object-cover"
                        />
                        <div
                          className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-xs font-medium text-white"
                          style={{ backgroundColor: photo.photoType === 'before' ? themeVars.accent : '#22c55e' }}
                        >
                          {photo.photoType}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload Buttons */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => triggerFileInput('before')}
                  disabled={uploadingPhoto}
                  className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-neutral-50 disabled:opacity-50"
                  style={{ borderColor: themeVars.borderMuted }}
                >
                  <div className="text-2xl">📷</div>
                  <div className="mt-1 font-medium text-neutral-700">Upload Before Photo</div>
                  <div className="text-xs text-neutral-400">Optional - before service</div>
                </button>

                <button
                  type="button"
                  onClick={() => triggerFileInput('after')}
                  disabled={uploadingPhoto}
                  className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-neutral-50 disabled:opacity-50"
                  style={{ borderColor: themeVars.primary }}
                >
                  <div className="text-2xl">✨</div>
                  <div className="mt-1 font-medium" style={{ color: themeVars.accent }}>
                    Upload After Photo
                  </div>
                  <div className="text-xs text-neutral-400">Required to complete</div>
                </button>
              </div>

              {uploadingPhoto && (
                <div className="mt-4 flex items-center justify-center gap-2 text-neutral-600">
                  <div
                    className="size-4 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
                  />
                  Uploading...
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-6 space-y-2">
                {selectedAppointment.status === 'in_progress' &&
                  selectedAppointment.photos.some((p) => p.photoType === 'after') && (
                    <button
                      type="button"
                      onClick={() => setShowCompleteDialog(true)}
                      disabled={completing || uploadingPhoto}
                      className="w-full rounded-full py-3 text-center font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                      style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                    >
                      ✓ Complete & Mark Paid
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => setShowCancelDialog(true)}
                  className="w-full rounded-full py-2 text-center text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  Cancel Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Complete Dialog */}
      {showCompleteDialog && selectedAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !completing) {
              setShowCompleteDialog(false);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold" style={{ color: themeVars.titleText }}>
              Complete Appointment
            </h3>

            <div className="mb-4">
              <div className="mb-2 text-sm font-medium text-neutral-700">Payment Method</div>
              <PaymentMethodSelector selected={paymentMethod} onSelect={setPaymentMethod} />
            </div>

            <div className="mb-4 rounded-xl p-3" style={{ backgroundColor: themeVars.highlightBackground }}>
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">Total</span>
                <span className="text-xl font-bold" style={{ color: themeVars.accent }}>
                  {formatPrice(selectedAppointment.totalPrice)}
                </span>
              </div>
            </div>

            {uploadError && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {uploadError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCompleteDialog(false)}
                disabled={completing}
                className="flex-1 rounded-full py-3 text-center font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                className="flex-1 rounded-full py-3 text-center font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
              >
                {completing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Dialog */}
      {showCancelDialog && selectedAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !cancelling) {
              setShowCancelDialog(false);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold text-red-600">
              Cancel Appointment
            </h3>
            <CancelReasonSelector
              onSelect={handleCancel}
              onCancel={() => setShowCancelDialog(false)}
              isSubmitting={cancelling}
            />
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <StaffBottomNav activeItem="photos" />
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function StaffAppointmentsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent border-amber-500 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    }>
      <StaffAppointmentsContent />
    </Suspense>
  );
}
