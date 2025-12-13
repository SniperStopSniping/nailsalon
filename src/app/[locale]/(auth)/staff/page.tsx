'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { NotificationBell, StaffBottomNav } from '@/components/staff';
import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';

import { ActionBar } from './components/ActionBar';
import { BottomSheet } from './components/BottomSheet';
import { FloatingActionBar } from './components/FloatingActionBar';
import { PhotoModal } from './components/PhotoModal';
import { type AppointmentData, StaffAppointmentCard } from './components/StaffAppointmentCard';
import { SwipeableCard } from './components/SwipeableCard';

// =============================================================================
// Cappuccino Design Tokens
// =============================================================================

const cappuccino = {
  title: '#6F4E37',
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
  primary: '#4B2E1E',
  secondary: '#EADBC8',
  secondaryText: '#4B2E1E',
  background: '#FFFBF7',
};

// =============================================================================
// Types
// =============================================================================

type TechnicianInfo = {
  id: string;
  name: string;
};

type SalonInfo = {
  id: string;
  name: string;
  slug: string;
};

type TabId = 'today' | 'upcoming' | 'past';

// =============================================================================
// Cookie Helper
// =============================================================================

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}

// =============================================================================
// Tab Button Component (Cappuccino Style)
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
        backgroundColor: isActive ? cappuccino.primary : 'transparent',
        color: isActive ? '#FFFFFF' : cappuccino.secondaryText,
      }}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: '#D97706' }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// =============================================================================
// Get Greeting Based on Time
// =============================================================================

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

// =============================================================================
// Main Staff Dashboard Page (Cappuccino v2)
// =============================================================================

export default function StaffDashboardPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  // Auth state
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [technician, setTechnician] = useState<TechnicianInfo | null>(null);
  const [salon, setSalon] = useState<SalonInfo | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [appointments, setAppointments] = useState<AppointmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Modal state
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null);
  const [showActionBar, setShowActionBar] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  // Active appointment for FAB (last interacted)
  const [activeAppointment, setActiveAppointment] = useState<AppointmentData | null>(null);

  // Loading state for gesture actions
  const [gestureLoadingId, setGestureLoadingId] = useState<string | null>(null);

  // Module capabilities - for future feature gating (earnings, etc.)
  // Currently used for: none (all visible features are core)
  // Future: earnings tab, analytics widgets
  const { modules: _modules } = useStaffCapabilities();

  // =============================================================================
  // Auth Check
  // =============================================================================

  useEffect(() => {
    async function checkAuth() {
      const staffSalon = getCookie('staff_salon');

      if (!staffSalon) {
        setAuthChecked(true);
        setIsAuthenticated(false);
        return;
      }

      try {
        const response = await fetch('/api/staff/me');
        if (response.ok) {
          const data = await response.json();
          if (data.data?.technician) {
            setTechnician(data.data.technician);
            setSalon(data.data.salon);
            setIsAuthenticated(true);
          } else {
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Failed to fetch technician info:', error);
        setIsAuthenticated(false);
      } finally {
        setAuthChecked(true);
      }
    }
    checkAuth();
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.push(`/${locale}/staff-login`);
    }
  }, [authChecked, isAuthenticated, router, locale]);

  // =============================================================================
  // Fetch Appointments
  // =============================================================================

  const fetchAppointments = useCallback(async () => {
    if (!technician || !salon) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const baseParams = new URLSearchParams();
      baseParams.set('salonSlug', salon.slug);
      baseParams.set('technicianId', technician.id);

      if (activeTab === 'today') {
        baseParams.set('date', 'today');
        baseParams.set('status', 'confirmed,in_progress');
      } else if (activeTab === 'upcoming') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        baseParams.set('status', 'confirmed,pending');
        baseParams.set('startDate', today.toISOString());
        baseParams.set('endDate', nextWeek.toISOString());
      } else if (activeTab === 'past') {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        baseParams.set('status', 'completed');
        baseParams.set('startDate', thirtyDaysAgo.toISOString());
        baseParams.set('endDate', today.toISOString());
        baseParams.set('limit', '20');
      }

      const response = await fetch(`/api/appointments?${baseParams}`);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.data?.appointments || []);
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, salon, technician]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated && technician && salon) {
      fetchAppointments();
    }
  }, [isAuthenticated, technician, salon, fetchAppointments]);

  // =============================================================================
  // Handlers
  // =============================================================================

  const handleViewClient = (phone: string) => {
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    router.push(`/${locale}/staff/client/${normalizedPhone}`);
  };

  const handleOpenActions = (appointment: AppointmentData) => {
    setSelectedAppointment(appointment);
    setActiveAppointment(appointment);
    setShowActionBar(true);
  };

  const handleOpenPhotos = () => {
    setShowActionBar(false);
    setShowDrawer(false);
    setShowPhotoModal(true);
  };

  const handleCloseActionBar = () => {
    setShowActionBar(false);
    setSelectedAppointment(null);
    // Refresh data after closing (in case of transitions)
    fetchAppointments();
  };

  const handleClosePhotoModal = () => {
    setShowPhotoModal(false);
    setSelectedAppointment(null);
    // Refresh data after closing (photos may have been uploaded)
    fetchAppointments();
  };

  // Drawer handlers
  const handleOpenDrawer = (appointment: AppointmentData) => {
    setSelectedAppointment(appointment);
    setActiveAppointment(appointment);
    setShowDrawer(true);
  };

  const handleCloseDrawer = () => {
    setShowDrawer(false);
    setSelectedAppointment(null);
    fetchAppointments();
  };

  // Gesture handlers with haptic feedback
  const triggerHaptic = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  };

  const handleSwipeStart = async (appointment: AppointmentData) => {
    const canvasState = appointment.canvasState || mapLegacyStatus(appointment.status);
    if (canvasState !== 'waiting') {
      return;
    }
    if (gestureLoadingId) {
      return;
    }

    setGestureLoadingId(appointment.id);
    setActiveAppointment(appointment);

    try {
      const response = await fetch(`/api/appointments/${appointment.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'working' }),
      });

      if (response.ok) {
        triggerHaptic();
        router.refresh();
        fetchAppointments();
      }
    } finally {
      setGestureLoadingId(null);
    }
  };

  const handleSwipePhotos = (appointment: AppointmentData) => {
    setSelectedAppointment(appointment);
    setActiveAppointment(appointment);
    setShowPhotoModal(true);
  };

  // Helper to map legacy status
  function mapLegacyStatus(status: string): string {
    const mapping: Record<string, string> = {
      pending: 'waiting',
      confirmed: 'waiting',
      in_progress: 'working',
      completed: 'complete',
      cancelled: 'cancelled',
      no_show: 'no_show',
    };
    return mapping[status] || 'waiting';
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/staff/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    }
    router.push(`/${locale}/staff-login`);
  };

  // =============================================================================
  // Loading States
  // =============================================================================

  if (!authChecked) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: cappuccino.background }}
      >
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${cappuccino.primary} transparent ${cappuccino.primary} ${cappuccino.primary}` }}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: cappuccino.background }}
      >
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${cappuccino.primary} transparent ${cappuccino.primary} ${cappuccino.primary}` }}
        />
      </div>
    );
  }

  if (!technician) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: cappuccino.background }}
      >
        <h1
          className="mb-4 text-2xl font-semibold"
          style={{ color: cappuccino.title }}
        >
          No Technician Profile Found
        </h1>
        <p className="max-w-md text-center text-neutral-600">
          Your account is not linked to a technician profile. Please contact your salon administrator to set up your profile.
        </p>
      </div>
    );
  }

  // =============================================================================
  // Main Render
  // =============================================================================

  const todayCount = appointments.filter(
    a => a.status === 'confirmed' || a.status === 'in_progress',
  ).length;

  return (
    <div
      className="min-h-screen pb-24"
      style={{ backgroundColor: cappuccino.background }}
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
                className="text-2xl font-semibold"
                style={{ color: cappuccino.title }}
              >
                {getGreeting()}
                ,
                {technician.name.split(' ')[0]}
                {' '}
                ☕️
              </h1>
              <p className="text-sm text-neutral-600">{salon?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <button
                type="button"
                onClick={() => router.push(`/${locale}/staff/schedule`)}
                className="rounded-xl px-4 py-2 text-sm font-medium transition-all hover:opacity-80"
                style={{
                  backgroundColor: cappuccino.secondary,
                  color: cappuccino.secondaryText,
                }}
              >
                ⏰ Schedule
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl px-3 py-2 text-sm font-medium text-neutral-600 transition-all hover:bg-neutral-100"
                style={{ borderWidth: 1, borderColor: cappuccino.cardBorder }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          className="mb-6 flex gap-1 rounded-2xl p-1 shadow-sm"
          style={{
            backgroundColor: cappuccino.cardBg,
            borderColor: cappuccino.cardBorder,
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
          {loading
            ? (
                <div className="flex items-center justify-center py-12">
                  <div
                    className="size-8 animate-spin rounded-full border-4 border-t-transparent"
                    style={{ borderColor: `${cappuccino.primary} transparent ${cappuccino.primary} ${cappuccino.primary}` }}
                  />
                </div>
              )
            : appointments.length === 0
              ? (
                  <div
                    className="rounded-2xl p-8 text-center shadow-sm"
                    style={{
                      backgroundColor: cappuccino.cardBg,
                      borderColor: cappuccino.cardBorder,
                      borderWidth: 1,
                    }}
                  >
                    <div className="mb-2 text-4xl">☕️</div>
                    <p
                      className="text-lg font-medium"
                      style={{ color: cappuccino.title }}
                    >
                      All caught up
                    </p>
                    <p className="mt-1 text-sm text-neutral-500">
                      {activeTab === 'today'
                        ? 'No appointments scheduled for today'
                        : activeTab === 'upcoming'
                          ? 'No upcoming appointments'
                          : 'No past appointments to show'}
                    </p>
                  </div>
                )
              : (
                  <div className="space-y-4 pb-32">
                    {appointments.map((appointment, index) => {
                      const canvasState = appointment.canvasState || mapLegacyStatus(appointment.status);
                      const isTerminal = ['complete', 'cancelled', 'no_show'].includes(canvasState);
                      const isLoading = gestureLoadingId === appointment.id;

                      return (
                        <div
                          key={appointment.id}
                          style={{
                            opacity: mounted ? 1 : 0,
                            transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                            transition: `opacity 300ms ease-out ${250 + index * 50}ms, transform 300ms ease-out ${250 + index * 50}ms`,
                          }}
                        >
                          <SwipeableCard
                            onSwipeRight={() => handleSwipeStart(appointment)}
                            onSwipeLeft={() => handleSwipePhotos(appointment)}
                            onLongPress={() => handleOpenDrawer(appointment)}
                            onTap={() => handleOpenActions(appointment)}
                            swipeRightDisabled={canvasState !== 'waiting' || isLoading}
                            swipeLeftDisabled={isTerminal || isLoading}
                            swipeRightLabel="Start"
                            swipeLeftLabel="Photos"
                            isLoading={isLoading}
                          >
                            <StaffAppointmentCard
                              appointment={appointment}
                              onViewClient={handleViewClient}
                              onOpenActions={handleOpenActions}
                            />
                          </SwipeableCard>
                        </div>
                      );
                    })}
                  </div>
                )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <StaffBottomNav activeItem="home" />

      {/* Floating Action Bar */}
      {!showActionBar && !showPhotoModal && !showDrawer && (
        <FloatingActionBar
          appointment={activeAppointment}
          onOpenPhotos={() => {
            if (activeAppointment) {
              setSelectedAppointment(activeAppointment);
              setShowPhotoModal(true);
            }
          }}
          onSuccess={fetchAppointments}
        />
      )}

      {/* Action Bar Modal */}
      {showActionBar && selectedAppointment && (
        <ActionBar
          appointment={selectedAppointment}
          onOpenPhotos={handleOpenPhotos}
          onClose={handleCloseActionBar}
          requireBeforePhoto={false}
          requireAfterPhoto={false}
        />
      )}

      {/* Bottom Sheet Drawer */}
      <BottomSheet
        isOpen={showDrawer}
        onClose={handleCloseDrawer}
        initialSnap="half"
      >
        {selectedAppointment && (
          <div className="space-y-4">
            {/* Client Info Header */}
            <div className="text-center">
              <h2
                className="text-xl font-semibold"
                style={{ color: cappuccino.title }}
              >
                {selectedAppointment.clientName || 'Client'}
              </h2>
              <p className="text-sm text-neutral-500">
                {selectedAppointment.clientPhone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
              </p>
            </div>

            {/* Services */}
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: cappuccino.secondary }}
            >
              <div className="text-sm font-medium text-neutral-600">Services</div>
              <div
                className="mt-1 font-semibold"
                style={{ color: cappuccino.primary }}
              >
                {selectedAppointment.services.map(s => s.name).join(', ')}
              </div>
            </div>

            {/* Time & Price */}
            <div className="flex gap-4">
              <div
                className="flex-1 rounded-xl p-4"
                style={{ backgroundColor: cappuccino.cardBg, borderWidth: 1, borderColor: cappuccino.cardBorder }}
              >
                <div className="text-sm text-neutral-500">Time</div>
                <div className="font-semibold" style={{ color: cappuccino.title }}>
                  {new Date(selectedAppointment.startTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </div>
              </div>
              <div
                className="flex-1 rounded-xl p-4"
                style={{ backgroundColor: cappuccino.cardBg, borderWidth: 1, borderColor: cappuccino.cardBorder }}
              >
                <div className="text-sm text-neutral-500">Total</div>
                <div className="font-semibold" style={{ color: cappuccino.title }}>
                  $
                  {(selectedAppointment.totalPrice / 100).toFixed(0)}
                </div>
              </div>
            </div>

            {/* Photo Status */}
            <div className="flex gap-2">
              <div
                className={`flex-1 rounded-xl p-3 text-center text-sm font-medium ${
                  selectedAppointment.photos.some(p => p.photoType === 'before')
                    ? 'bg-green-100 text-green-700'
                    : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {selectedAppointment.photos.some(p => p.photoType === 'before') ? '✓ Before' : '○ Before'}
              </div>
              <div
                className={`flex-1 rounded-xl p-3 text-center text-sm font-medium ${
                  selectedAppointment.photos.some(p => p.photoType === 'after')
                    ? 'bg-green-100 text-green-700'
                    : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {selectedAppointment.photos.some(p => p.photoType === 'after') ? '✓ After' : '○ After'}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleOpenPhotos}
                className="w-full rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98]"
                style={{ backgroundColor: cappuccino.secondary, color: cappuccino.secondaryText }}
              >
                📸 Add Photos
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDrawer(false);
                  handleOpenActions(selectedAppointment);
                }}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all active:scale-[0.98]"
                style={{ backgroundColor: cappuccino.primary }}
              >
                Manage Appointment
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Photo Modal */}
      {showPhotoModal && selectedAppointment && (
        <PhotoModal
          appointment={selectedAppointment}
          onClose={handleClosePhotoModal}
        />
      )}
    </div>
  );
}
