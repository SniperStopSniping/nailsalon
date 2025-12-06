'use client';

/**
 * Admin Dashboard Home
 *
 * iOS-style swipeable dashboard with:
 * - Page 1: Analytics widgets (revenue, utilization, staff)
 * - Page 2: App grid with gradient icons
 * - Fullscreen modals for apps (Appointments, Settings, etc.)
 * - iOS spring physics and animations
 */

import { useUser } from '@clerk/nextjs';
import { Bell } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { SwipeablePages, PageIndicator } from '@/components/admin/SwipeablePages';
import { AnalyticsWidgets } from '@/components/admin/AnalyticsWidgets';
import { AppGrid, type AppId } from '@/components/admin/AppGrid';
import { AppModal } from '@/components/admin/AppModal';
import { AppointmentsModal } from '@/components/admin/AppointmentsModal';
import { SettingsModal } from '@/components/admin/SettingsModal';
import { ClientsModal } from '@/components/admin/ClientsModal';
import { StaffModal } from '@/components/admin/StaffModal';
import { ServicesModal } from '@/components/admin/ServicesModal';
import { MarketingModal } from '@/components/admin/MarketingModal';
import { ReviewsModal } from '@/components/admin/ReviewsModal';
import { RewardsModal } from '@/components/admin/RewardsModal';
import { SkeletonWidgets } from '@/components/admin/SkeletonWidgets';
import { NotificationsModal } from '@/components/admin/NotificationsModal';
import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

interface DashboardData {
  revenue: {
    today: number;
    completed: number;
    trend: number;
  };
  appointments: {
    total: number;
    completed: number;
    noShows: number;
    upcoming: number;
  };
  openSpots: {
    count: number;
    nextTime: string | null;
    slots: ('booked' | 'open')[];
  };
  staff: Array<{
    name: string;
    status: 'busy' | 'free' | 'break';
    detail?: string;
  }>;
  badges: {
    referrals: number;
    reviews: number;
    marketing: number;
    alerts: number;
  };
}

// =============================================================================
// iOS Header Component
// =============================================================================

function IOSHeader({
  title,
  subtitle,
  avatar,
  notificationCount = 0,
  onNotificationTap,
}: {
  title: string;
  subtitle: string;
  avatar: string;
  notificationCount?: number;
  onNotificationTap?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div>
        <h1 className="text-[28px] font-bold text-[#1C1C1E] tracking-tight">
          {title}
        </h1>
        <p className="text-[15px] text-[#8E8E93] mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onNotificationTap}
          className="relative w-9 h-9 rounded-full bg-black/5 flex items-center justify-center active:bg-black/10 transition-colors"
        >
          <Bell size={20} className="text-[#8E8E93]" />
          {notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[#FF3B30] rounded-full flex items-center justify-center px-1">
              <span className="text-white text-[11px] font-bold">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            </span>
          )}
        </button>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#007AFF] to-[#5856D6] flex items-center justify-center text-white text-[15px] font-semibold">
          {avatar}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function AdminDashboardPage() {
  const { user, isLoaded } = useUser();
  const { salonName } = useSalon();

  // Dashboard data state
  const [data, setData] = useState<DashboardData>({
    revenue: { today: 0, completed: 0, trend: 0 },
    appointments: { total: 0, completed: 0, noShows: 0, upcoming: 0 },
    openSpots: { count: 0, nextTime: null, slots: [] },
    staff: [],
    badges: { referrals: 0, reviews: 0, marketing: 0, alerts: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Swipe page state
  const [currentPage, setCurrentPage] = useState(0);

  // Modal state
  const [activeModal, setActiveModal] = useState<AppId | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  // Notification count (in production, this would come from API)
  const notificationCount = data.badges.alerts + data.badges.reviews;

  // Fetch dashboard data
  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('/api/appointments?date=today');
      if (response.ok) {
        const result = await response.json();
        const appointments = result.data?.appointments || [];

        const completed = appointments.filter((a: { status: string }) => a.status === 'completed');
        const noShows = appointments.filter((a: { status: string }) => a.status === 'no_show');
        const upcoming = appointments.filter(
          (a: { status: string }) =>
            a.status === 'confirmed' || a.status === 'pending' || a.status === 'in_progress'
        );

        const totalRevenue = completed.reduce(
          (sum: number, a: { totalPrice: number }) => sum + (a.totalPrice || 0),
          0
        );

        // Generate mock availability slots
        const slots: ('booked' | 'open')[] = [];
        for (let i = 0; i < 16; i++) {
          slots.push(Math.random() > 0.4 ? 'booked' : 'open');
        }

        const openCount = slots.filter((s) => s === 'open').length;
        const openSlotIndex = slots.findIndex((s) => s === 'open');
        let nextTime = null;
        if (openSlotIndex !== -1) {
          const baseHour = 9;
          const slotHour = baseHour + Math.floor(openSlotIndex / 2);
          const slotMinute = (openSlotIndex % 2) * 30;
          const slotDate = new Date();
          slotDate.setHours(slotHour, slotMinute, 0, 0);
          if (slotDate > new Date()) {
            nextTime = slotDate.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });
          }
        }

        setData({
          revenue: {
            today: totalRevenue,
            completed: completed.length,
            trend: 18,
          },
          appointments: {
            total: appointments.length,
            completed: completed.length,
            noShows: noShows.length,
            upcoming: upcoming.length,
          },
          openSpots: {
            count: openCount,
            nextTime,
            slots,
          },
          staff: [
            { name: 'Sarah', status: 'busy', detail: 'Done 2:45' },
            { name: 'Emma', status: 'free' },
            { name: 'Kim', status: 'break', detail: 'Back 3:00' },
          ],
          badges: {
            referrals: 3,
            reviews: 2,
            marketing: 5,
            alerts: 1,
          },
        });
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isLoaded && user) {
      fetchData();
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [isLoaded, user, fetchData]);

  // Handle app tile tap - all tiles now open modals
  const handleAppTap = (appId: AppId) => {
    setActiveModal(appId);
  };

  // Handle quick action tap
  const handleQuickAction = useCallback((actionId: string) => {
    switch (actionId) {
      case 'new-appointment':
      case 'walk-in':
        setActiveModal('bookings');
        break;
      case 'send-sms':
        setActiveModal('marketing');
        break;
      case 'today-schedule':
        setActiveModal('bookings');
        break;
      default:
        break;
    }
  }, []);

  // Close modal
  const handleCloseModal = () => {
    setActiveModal(null);
  };

  // Loading state - show skeleton instead of spinner
  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen bg-[#F2F2F7]">
        <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
          {/* Skeleton Header */}
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <div className="h-8 w-32 bg-gray-200 rounded-lg animate-pulse" />
              <div className="h-4 w-24 bg-gray-100 rounded mt-1 animate-pulse" />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gray-200 animate-pulse" />
              <div className="w-9 h-9 rounded-full bg-gray-200 animate-pulse" />
            </div>
          </div>
          {/* Skeleton Content */}
          <SkeletonWidgets />
        </div>
      </div>
    );
  }

  // Auth required
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F2F2F7] px-5">
        <h1 className="text-[24px] font-semibold text-[#1C1C1E] mb-2">
          Admin Access Required
        </h1>
        <p className="text-[15px] text-[#8E8E93]">
          Please sign in to access the admin dashboard.
        </p>
      </div>
    );
  }

  const userName = user.firstName || user.username || 'Admin';
  const userInitial = userName.charAt(0).toUpperCase();

  // Map badges to app grid format
  const appBadges: Record<string, number> = {
    marketing: data.badges.marketing,
    reviews: data.badges.reviews,
  };

  // Staff data for analytics
  const staffData = [
    { id: 1, name: 'Sarah J.', role: 'Senior Stylist', revenue: '$2,400', avatarColor: 'bg-blue-100 text-blue-600' },
    { id: 2, name: 'Michael B.', role: 'Colorist', revenue: '$1,850', avatarColor: 'bg-purple-100 text-purple-600' },
    { id: 3, name: 'Emily R.', role: 'Nail Tech', revenue: '$1,200', avatarColor: 'bg-pink-100 text-pink-600' },
  ];

  // Utilization data
  const utilization = [
    { name: 'Sar', percent: 92, color: '#fa709a' },
    { name: 'Mik', percent: 65, color: '#43e97b' },
    { name: 'Em', percent: 45, color: '#66a6ff' },
  ];

  // Service mix data
  const services = [
    { label: 'BIAB Gel', percent: 45, color: '#F97316' },
    { label: 'Pedicure', percent: 30, color: '#3B82F6' },
    { label: 'Removal', percent: 15, color: '#9CA3AF' },
  ];

  return (
    <div
      className="min-h-screen bg-[#F2F2F7] font-sans"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 300ms ease-out, transform 300ms ease-out',
      }}
    >
      {/* Safe Area Top Padding */}
      <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
        {/* Header */}
        <IOSHeader 
          title="Dashboard" 
          subtitle={salonName} 
          avatar={userInitial}
          notificationCount={notificationCount}
          onNotificationTap={() => setShowNotifications(true)}
        />

        {/* Swipeable Pages Container */}
        <div className="h-[calc(100vh-140px)]">
          <SwipeablePages 
            onPageChange={setCurrentPage} 
            initialPage={currentPage}
            onRefresh={handleRefresh}
            lastUpdated={lastUpdated}
          >
            {/* Page 1: Analytics Widgets */}
            <AnalyticsWidgets
              revenue={data.revenue.today || 1248000}
              revenueTrend={data.revenue.trend}
              staffData={staffData}
              utilization={utilization}
              services={services}
              onQuickAction={handleQuickAction}
            />

            {/* Page 2: App Grid */}
            <AppGrid
              theme="apple"
              badges={appBadges}
              onAppTap={handleAppTap}
            />
          </SwipeablePages>
        </div>

        {/* Page Indicator */}
        <div className="fixed bottom-0 left-0 right-0 pb-safe">
          <PageIndicator
            pageCount={2}
            currentPage={currentPage}
            onPageSelect={setCurrentPage}
          />
        </div>
      </div>

      {/* Modals */}
      <AppModal
        isOpen={activeModal === 'bookings'}
        onClose={handleCloseModal}
      >
        <AppointmentsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'settings'}
        onClose={handleCloseModal}
      >
        <SettingsModal
          onClose={handleCloseModal}
          userName={userName}
          userInitials={userInitial}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'analytics'}
        onClose={handleCloseModal}
      >
        <AnalyticsWidgets
          revenue={data.revenue.today || 1248000}
          revenueTrend={data.revenue.trend}
          staffData={staffData}
          utilization={utilization}
          services={services}
        />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'clients'}
        onClose={handleCloseModal}
      >
        <ClientsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'staff'}
        onClose={handleCloseModal}
      >
        <StaffModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'services'}
        onClose={handleCloseModal}
      >
        <ServicesModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'marketing'}
        onClose={handleCloseModal}
      >
        <MarketingModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'reviews'}
        onClose={handleCloseModal}
      >
        <ReviewsModal onClose={handleCloseModal} />
      </AppModal>

      <AppModal
        isOpen={activeModal === 'rewards'}
        onClose={handleCloseModal}
      >
        <RewardsModal onClose={handleCloseModal} />
      </AppModal>

      {/* Notifications Modal */}
      <AppModal
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
      >
        <NotificationsModal onClose={() => setShowNotifications(false)} />
      </AppModal>
    </div>
  );
}
