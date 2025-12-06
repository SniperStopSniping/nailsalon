'use client';

import { useUser } from '@clerk/nextjs';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
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

type TabId = 'today' | 'upcoming' | 'past' | 'schedule';

// =============================================================================
// Tab Button Component
// =============================================================================

function TabButton({
  id,
  label,
  icon,
  isActive,
  onClick,
  badge,
}: {
  id: TabId;
  label: string;
  icon: string;
  isActive: boolean;
  onClick: (id: TabId) => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className="relative flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-3 text-center transition-all duration-200"
      style={{
        background: isActive
          ? `linear-gradient(to bottom, ${themeVars.primary}, ${themeVars.primaryDark})`
          : 'transparent',
        color: isActive ? '#1a1a1a' : '#666',
      }}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: themeVars.accent }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// =============================================================================
// Appointment Card Component
// =============================================================================

function AppointmentCard({
  appointment,
  onViewClient,
  onStart,
  onUploadPhotos,
  onComplete,
  onCancel,
  isStarting,
}: {
  appointment: AppointmentData;
  onViewClient: (phone: string) => void;
  onStart: (id: string) => void;
  onUploadPhotos: (appointment: AppointmentData) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  isStarting: boolean;
}) {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`;
  };

  const hasAfterPhoto = appointment.photos.some((p) => p.photoType === 'after');
  const hasBeforePhoto = appointment.photos.some((p) => p.photoType === 'before');
  const isInProgress = appointment.status === 'in_progress';
  const isConfirmed = appointment.status === 'confirmed';

  return (
    <div
      className="overflow-hidden rounded-2xl bg-white shadow-lg"
      style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <button
              type="button"
              onClick={() => onViewClient(appointment.clientPhone)}
              className="text-left transition-colors hover:opacity-70"
            >
              <div className="font-bold text-neutral-900">
                {appointment.clientName || 'Client'}
              </div>
              <div className="text-xs text-neutral-500">
                {appointment.clientPhone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
              </div>
            </button>
            <div className="mt-1 text-sm text-neutral-600">
              {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
            </div>
            <div className="mt-1 text-sm font-medium" style={{ color: themeVars.accent }}>
              {appointment.services.map((s) => s.name).join(', ')}
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold" style={{ color: themeVars.primary }}>
              {formatPrice(appointment.totalPrice)}
            </div>
            <div
              className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                background: isInProgress
                  ? themeVars.primary
                  : appointment.status === 'completed'
                    ? '#22c55e'
                    : themeVars.selectedBackground,
                color: isInProgress || appointment.status === 'completed'
                  ? 'white'
                  : themeVars.titleText,
              }}
            >
              {isInProgress ? 'In Progress' : appointment.status === 'completed' ? 'Completed' : 'Confirmed'}
            </div>
          </div>
        </div>

        {/* Photos preview */}
        {appointment.photos.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex gap-1">
              {appointment.photos.slice(0, 4).map((photo) => (
                <div
                  key={photo.id}
                  className="relative size-12 overflow-hidden rounded-lg"
                >
                  <Image
                    src={photo.thumbnailUrl || photo.imageUrl}
                    alt={photo.photoType}
                    fill
                    className="object-cover"
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[9px] font-medium text-white"
                    style={{ backgroundColor: photo.photoType === 'before' ? themeVars.accent : '#22c55e' }}
                  >
                    {photo.photoType}
                  </div>
                </div>
              ))}
            </div>
            {appointment.photos.length > 4 && (
              <span className="text-xs text-neutral-500">+{appointment.photos.length - 4} more</span>
            )}
          </div>
        )}

        {/* Photo status indicators */}
        {(isConfirmed || isInProgress) && (
          <div className="mt-3 flex gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 ${hasBeforePhoto ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
              {hasBeforePhoto ? '✓ Before' : '○ Before'}
            </span>
            <span className={`rounded-full px-2 py-0.5 ${hasAfterPhoto ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'}`}>
              {hasAfterPhoto ? '✓ After' : '○ After (required)'}
            </span>
          </div>
        )}

        {/* Actions */}
        {(isConfirmed || isInProgress) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {isConfirmed && (
              <button
                type="button"
                onClick={() => onStart(appointment.id)}
                disabled={isStarting}
                className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ backgroundColor: themeVars.accent }}
              >
                {isStarting ? '...' : '▶ Start'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onUploadPhotos(appointment)}
              className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                backgroundColor: themeVars.selectedBackground,
                color: themeVars.titleText,
              }}
            >
              📸 Photos
            </button>
            {isInProgress && hasAfterPhoto && (
              <button
                type="button"
                onClick={() => onComplete(appointment.id)}
                className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-neutral-900 transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
              >
                ✓ Complete
              </button>
            )}
            <button
              type="button"
              onClick={() => onCancel(appointment.id)}
              className="rounded-full px-3 py-2.5 text-sm font-medium text-red-600 transition-all hover:bg-red-50 active:scale-[0.98]"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Staff Dashboard Page
// =============================================================================

export default function StaffDashboardPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  // Fetch appointments based on tab
  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/api/appointments?';
      
      if (activeTab === 'today') {
        url += 'date=today&status=confirmed,in_progress';
      } else if (activeTab === 'upcoming') {
        // Get next 7 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        url += `status=confirmed,pending&startDate=${today.toISOString()}&endDate=${nextWeek.toISOString()}`;
      } else if (activeTab === 'past') {
        url += 'status=completed&limit=20';
      }

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.data?.appointments || []);
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isLoaded && user) {
      fetchAppointments();
    }
  }, [isLoaded, user, fetchAppointments]);

  // Handle start appointment
  const handleStart = async (appointmentId: string) => {
    setStartingId(appointmentId);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/complete`, {
        method: 'POST',
      });
      if (response.ok) {
        await fetchAppointments();
      }
    } catch (error) {
      console.error('Failed to start appointment:', error);
    } finally {
      setStartingId(null);
    }
  };

  // Handle complete
  const handleComplete = async (appointmentId: string) => {
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: 'paid' }),
      });
      if (response.ok) {
        await fetchAppointments();
      }
    } catch (error) {
      console.error('Failed to complete appointment:', error);
    }
  };

  // Handle cancel
  const handleCancel = async (appointmentId: string) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;
    
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelReason: 'client_request' }),
      });
      if (response.ok) {
        await fetchAppointments();
      }
    } catch (error) {
      console.error('Failed to cancel appointment:', error);
    }
  };

  // Navigate to client profile
  const handleViewClient = (phone: string) => {
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    router.push(`/${locale}/staff/client/${normalizedPhone}`);
  };

  // Navigate to upload photos
  const handleUploadPhotos = (appointment: AppointmentData) => {
    router.push(`/${locale}/staff/appointments?appointmentId=${appointment.id}`);
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
        <p className="text-neutral-600">Please sign in to access the staff dashboard.</p>
      </div>
    );
  }

  const todayCount = appointments.filter((a) => a.status === 'confirmed' || a.status === 'in_progress').length;

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
            <div>
              <h1
                className="text-2xl font-bold"
                style={{ color: themeVars.titleText }}
              >
                Tech Dashboard
              </h1>
              <p className="text-sm text-neutral-600">{salonName}</p>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/staff/schedule`)}
              className="rounded-full px-4 py-2 text-sm font-medium transition-all hover:opacity-80"
              style={{ backgroundColor: themeVars.selectedBackground, color: themeVars.titleText }}
            >
              ⏰ Schedule
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          className="mb-6 flex gap-1 rounded-2xl bg-white p-1 shadow-sm"
          style={{
            borderColor: themeVars.cardBorder,
            borderWidth: 1,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <TabButton
            id="today"
            label="Today"
            icon="📅"
            isActive={activeTab === 'today'}
            onClick={setActiveTab}
            badge={todayCount}
          />
          <TabButton
            id="upcoming"
            label="Upcoming"
            icon="📆"
            isActive={activeTab === 'upcoming'}
            onClick={setActiveTab}
          />
          <TabButton
            id="past"
            label="Past"
            icon="✓"
            isActive={activeTab === 'past'}
            onClick={setActiveTab}
          />
        </div>

        {/* Content */}
        <div
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div
                className="size-8 animate-spin rounded-full border-4 border-t-transparent"
                style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
              />
            </div>
          ) : appointments.length === 0 ? (
            <div
              className="rounded-2xl bg-white p-8 text-center shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="mb-2 text-4xl">
                {activeTab === 'today' ? '☀️' : activeTab === 'upcoming' ? '📅' : '✨'}
              </div>
              <p className="text-lg text-neutral-600">
                {activeTab === 'today'
                  ? 'No appointments today'
                  : activeTab === 'upcoming'
                    ? 'No upcoming appointments'
                    : 'No past appointments'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {appointments.map((appointment, index) => (
                <div
                  key={appointment.id}
                  style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                    transition: `opacity 300ms ease-out ${250 + index * 50}ms, transform 300ms ease-out ${250 + index * 50}ms`,
                  }}
                >
                  <AppointmentCard
                    appointment={appointment}
                    onViewClient={handleViewClient}
                    onStart={handleStart}
                    onUploadPhotos={handleUploadPhotos}
                    onComplete={handleComplete}
                    onCancel={handleCancel}
                    isStarting={startingId === appointment.id}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t bg-white/95 px-4 py-3 backdrop-blur-sm"
        style={{ borderColor: themeVars.cardBorder }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-around">
          <button
            type="button"
            onClick={() => router.push(`/${locale}/staff`)}
            className="flex flex-col items-center gap-0.5 text-center"
            style={{ color: themeVars.accent }}
          >
            <span className="text-xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/staff/appointments`)}
            className="flex flex-col items-center gap-0.5 text-center text-neutral-500"
          >
            <span className="text-xl">📸</span>
            <span className="text-xs font-medium">Photos</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/staff/schedule`)}
            className="flex flex-col items-center gap-0.5 text-center text-neutral-500"
          >
            <span className="text-xl">⏰</span>
            <span className="text-xs font-medium">Schedule</span>
          </button>
        </div>
      </div>
    </div>
  );
}

