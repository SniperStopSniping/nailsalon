'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { StaffBottomNav, StaffHeader } from '@/components/staff';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/ui/section-card';
import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';
import { themeVars } from '@/theme';

import { ActionBar } from './components/ActionBar';
import { BottomSheet } from './components/BottomSheet';
import { FloatingActionBar } from './components/FloatingActionBar';
import { PhotoModal } from './components/PhotoModal';
import { type AppointmentData, StaffAppointmentCard } from './components/StaffAppointmentCard';
import { SwipeableCard } from './components/SwipeableCard';

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
// Tab Button Component
// =============================================================================

function TabButton({
  id,
  label,
  isActive,
  onClick,
  badge,
}: {
  id: TabId;
  label: string;
  isActive: boolean;
  onClick: (id: TabId) => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      data-testid={`staff-dashboard-tab-${id}`}
      onClick={() => onClick(id)}
      className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center text-sm font-semibold transition-all duration-200 ${
        isActive
          ? 'shadow-sm'
          : 'bg-white hover:bg-neutral-50'
      }`}
      style={{
        backgroundColor: isActive ? themeVars.primary : '#FFFFFF',
        borderColor: isActive ? themeVars.primaryDark : themeVars.cardBorder,
        color: isActive ? '#171717' : '#404040',
      }}
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: themeVars.accent }}
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
// Main Staff Dashboard Page
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
  const initialAppointmentsLoadedRef = useRef(false);
  const loadedTabRef = useRef<TabId | null>(null);

  // Module capabilities - for future feature gating (earnings, etc.)
  // Currently used for: none (all visible features are core)
  // Future: earnings tab, analytics widgets
  const { modules: _modules } = useStaffCapabilities();

  // =============================================================================
  // Auth Check
  // =============================================================================

  const buildAppointmentParams = useCallback((tab: TabId) => {
    const baseParams = new URLSearchParams();

    if (tab === 'today') {
      baseParams.set('date', 'today');
      baseParams.set('status', 'confirmed,in_progress');
    } else if (tab === 'upcoming') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      baseParams.set('status', 'confirmed,pending');
      baseParams.set('startDate', today.toISOString());
      baseParams.set('endDate', nextWeek.toISOString());
    } else if (tab === 'past') {
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

    return baseParams.toString();
  }, []);

  const fetchAppointments = useCallback(async (tab = activeTab) => {
    if (!isAuthenticated) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/appointments?${buildAppointmentParams(tab)}`);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.data?.appointments || []);
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, buildAppointmentParams, isAuthenticated]);

  useEffect(() => {
    async function bootstrapDashboard() {
      setLoading(true);
      try {
        const [profileResponse, appointmentsResponse] = await Promise.all([
          fetch('/api/staff/me'),
          fetch(`/api/appointments?${buildAppointmentParams('today')}`),
        ]);

        if (profileResponse.ok) {
          const data = await profileResponse.json();
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

        if (appointmentsResponse.ok) {
          const data = await appointmentsResponse.json();
          setAppointments(data.data?.appointments || []);
          initialAppointmentsLoadedRef.current = true;
          loadedTabRef.current = 'today';
        }
      } catch (error) {
        console.error('Failed to bootstrap staff dashboard:', error);
        setIsAuthenticated(false);
      } finally {
        setAuthChecked(true);
        setLoading(false);
      }
    }
    bootstrapDashboard();
  }, [buildAppointmentParams]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (authChecked && !isAuthenticated) {
      router.push(`/${locale}/staff-login`);
    }
  }, [authChecked, isAuthenticated, router, locale]);

  // =============================================================================
  // Fetch Appointments
  // =============================================================================

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (
      authChecked
      && isAuthenticated
      && initialAppointmentsLoadedRef.current
      && loadedTabRef.current !== activeTab
    ) {
      loadedTabRef.current = activeTab;
      fetchAppointments();
    }
  }, [authChecked, isAuthenticated, activeTab, fetchAppointments]);

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
        await fetchAppointments();
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
        style={{ backgroundColor: themeVars.background }}
      >
        <div className="w-full max-w-md px-4">
          <AsyncStatePanel
            loading
            title="Loading staff dashboard"
            description="Checking your staff session and appointments."
          />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: themeVars.background }}
      >
        <div className="w-full max-w-md px-4">
          <AsyncStatePanel
            loading
            title="Redirecting to sign in"
            description="Your staff session has expired."
          />
        </div>
      </div>
    );
  }

  if (!technician) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: themeVars.background }}
      >
        <div className="w-full max-w-md">
          <AsyncStatePanel
            icon="🪪"
            title="Technician profile missing"
            description="Your account is not linked to a technician profile yet. Ask your salon administrator to finish setup."
          />
        </div>
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
      style={{ backgroundColor: themeVars.background }}
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
            title={`${getGreeting()}, ${technician.name.split(' ')[0]}`}
            subtitle={salon?.name}
            rightContent={(
              <>
                <Button
                  onClick={() => router.push(`/${locale}/staff/schedule`)}
                  variant="brandSoft"
                  size="sm"
                >
                  View schedule
                </Button>
                <Button
                  onClick={handleLogout}
                  variant="ghost"
                  size="sm"
                  className="text-neutral-600 hover:bg-white/70"
                >
                  Log out
                </Button>
              </>
            )}
          />
        </div>

        {/* Tab Navigation */}
        <div
          className="mb-6 flex gap-2 rounded-2xl border bg-white p-2 shadow-sm"
          style={{
            borderColor: themeVars.cardBorder,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <TabButton
            id="today"
            label="Today"
            isActive={activeTab === 'today'}
            onClick={setActiveTab}
            badge={todayCount}
          />
          <TabButton
            id="upcoming"
            label="Upcoming"
            isActive={activeTab === 'upcoming'}
            onClick={setActiveTab}
          />
          <TabButton
            id="past"
            label="Completed"
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
                <AsyncStatePanel
                  loading
                  title="Loading appointments"
                  description="Pulling the latest visit list for your shift."
                />
              )
            : appointments.length === 0
              ? (
                  <AsyncStatePanel
                    icon="📆"
                    title="All caught up"
                    description={activeTab === 'today'
                      ? 'There are no more appointments assigned to you today.'
                      : activeTab === 'upcoming'
                        ? 'Nothing upcoming is assigned to you right now.'
                        : 'Completed visits will appear here after you finish them.'}
                  />
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
                style={{ color: themeVars.titleText }}
              >
                {selectedAppointment.clientName || 'Client'}
              </h2>
              <p className="text-sm text-neutral-500">
                {selectedAppointment.clientPhone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
              </p>
            </div>

            {/* Services */}
            <SectionCard
              className="border-0 shadow-none"
              contentClassName="py-4"
              headerClassName="hidden"
            >
              <div className="text-sm font-medium text-neutral-600">Services</div>
              <div
                className="mt-1 font-semibold"
                style={{ color: themeVars.accent }}
              >
                {selectedAppointment.services.map(s => s.name).join(', ')}
              </div>
            </SectionCard>

            {/* Time & Price */}
            <div className="flex gap-4">
              <SectionCard className="flex-1 shadow-none" contentClassName="py-4">
                <div className="text-sm text-neutral-500">Time</div>
                <div className="font-semibold" style={{ color: themeVars.titleText }}>
                  {new Date(selectedAppointment.startTime).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </div>
              </SectionCard>
              <SectionCard className="flex-1 shadow-none" contentClassName="py-4">
                <div className="text-sm text-neutral-500">Total</div>
                <div className="font-semibold" style={{ color: themeVars.titleText }}>
                  $
                  {(selectedAppointment.totalPrice / 100).toFixed(0)}
                </div>
              </SectionCard>
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
              <Button
                onClick={handleOpenPhotos}
                variant="brandSoft"
                className="w-full"
              >
                Add photos
              </Button>
              <Button
                onClick={() => {
                  setShowDrawer(false);
                  handleOpenActions(selectedAppointment);
                }}
                variant="brand"
                className="w-full"
              >
                Manage Appointment
              </Button>
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
