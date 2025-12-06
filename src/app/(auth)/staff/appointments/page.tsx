'use client';

import { useUser } from '@clerk/nextjs';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

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

// =============================================================================
// Staff Appointments Dashboard
// =============================================================================

export default function StaffAppointmentsPage() {
  const { user, isLoaded } = useUser();
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch today's appointments
  const fetchAppointments = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments?date=today&status=confirmed,in_progress');
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.data?.appointments || []);
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoading(false);
    }
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

      // Refresh appointments to show new photo
      await fetchAppointments();

      // Update selected appointment with new photos
      const updatedAppointments = await fetch('/api/appointments?date=today&status=confirmed,in_progress');
      if (updatedAppointments.ok) {
        const data = await updatedAppointments.json();
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
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, photoType: 'before' | 'after') => {
    const file = e.target.files?.[0];
    if (file) {
      handlePhotoUpload(file, photoType);
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

      // Refresh appointments
      await fetchAppointments();
      setSelectedAppointment(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to complete');
    } finally {
      setCompleting(false);
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
    return `$${(cents / 100).toFixed(2)}`;
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <h1 className="mb-4 text-2xl font-bold">Staff Access Required</h1>
        <p className="text-neutral-600">Please sign in to access the staff dashboard.</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen p-4"
      style={{
        background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6">
          <h1
            className="text-2xl font-bold"
            style={{ color: themeVars.titleText }}
          >
            Staff Dashboard
          </h1>
          <p className="text-neutral-600">
            Today&apos;s Appointments ({appointments.length})
          </p>
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
            <p className="text-lg text-neutral-500">No appointments for today</p>
          </div>
        )}

        {!loading && appointments.length > 0 && (
          <div className="space-y-4">
            {appointments.map((appointment) => (
              <div
                key={appointment.id}
                className="overflow-hidden rounded-2xl bg-white shadow-lg"
                style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
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
                        {appointment.services.map(s => s.name).join(', ')}
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

                  {/* Actions */}
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedAppointment(appointment)}
                      className="flex-1 rounded-full px-4 py-2 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{ background: themeVars.accent }}
                    >
                      📸 Upload Photos
                    </button>
                    {appointment.photos.some(p => p.photoType === 'after') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAppointment(appointment);
                          handleComplete();
                        }}
                        className="rounded-full px-4 py-2 text-sm font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98]"
                        style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                      >
                        ✓ Complete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Photo Upload Modal */}
      {selectedAppointment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !uploadingPhoto) {
              setSelectedAppointment(null);
              setUploadError(null);
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
                  Upload Photos
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

              <div className="mb-4">
                <div className="font-medium text-neutral-700">
                  {selectedAppointment.clientName || 'Client'}
                </div>
                <div className="text-sm text-neutral-500">
                  {selectedAppointment.services.map(s => s.name).join(', ')}
                </div>
              </div>

              {uploadError && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  {uploadError}
                </div>
              )}

              {/* Current Photos */}
              {selectedAppointment.photos.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium text-neutral-600">
                    Uploaded Photos ({selectedAppointment.photos.length})
                  </div>
                  <div className="flex gap-2">
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
                          className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center text-xs text-white"
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
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="Upload photo"
                    onChange={(e) => handleFileSelect(e, 'before')}
                    disabled={uploadingPhoto}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.onchange = (e) =>
                          handleFileSelect(e as unknown as React.ChangeEvent<HTMLInputElement>, 'before');
                        fileInputRef.current.click();
                      }
                    }}
                    disabled={uploadingPhoto}
                    className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-neutral-50 disabled:opacity-50"
                    style={{ borderColor: themeVars.borderMuted }}
                  >
                    <div className="text-2xl">📷</div>
                    <div className="mt-1 font-medium text-neutral-700">Upload Before Photo</div>
                    <div className="text-xs text-neutral-400">Optional - before service</div>
                  </button>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.onchange = (e) =>
                          handleFileSelect(e as unknown as React.ChangeEvent<HTMLInputElement>, 'after');
                        fileInputRef.current.click();
                      }
                    }}
                    disabled={uploadingPhoto}
                    className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-neutral-50 disabled:opacity-50"
                    style={{ borderColor: themeVars.primary }}
                  >
                    <div className="text-2xl">✨</div>
                    <div className="mt-1 font-medium" style={{ color: themeVars.accent }}>
                      Upload After Photo
                    </div>
                    <div className="text-xs text-neutral-400">Required to complete appointment</div>
                  </button>
                </div>
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

              {/* Complete Button */}
              {selectedAppointment.photos.some(p => p.photoType === 'after') && (
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={completing || uploadingPhoto}
                  className="mt-4 w-full rounded-full py-3 text-center font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                  style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                >
                  {completing ? 'Completing...' : '✓ Mark as Completed'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
