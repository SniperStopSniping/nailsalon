'use client';

/**
 * NotificationsModal Component
 *
 * iOS-style notification center modal.
 * Features:
 * - Activity feed from recent appointments
 * - Swipe to dismiss gesture
 * - Time-based grouping (Today, Yesterday, Earlier)
 * - Empty state
 */

import type { PanInfo } from 'framer-motion';
import { AnimatePresence, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Bell,
  Calendar,
  CheckCircle2,
  Gift,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';

type NotificationsModalProps = {
  onClose: () => void;
};

// Notification types
type NotificationType = 'booking' | 'review' | 'alert' | 'reward' | 'completed' | 'cancelled' | 'no_show';

type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
};

// Get icon and color for notification type
function getNotificationStyle(type: NotificationType): { icon: LucideIcon; color: string; bgColor: string } {
  switch (type) {
    case 'booking':
      return { icon: Calendar, color: 'text-blue-600', bgColor: 'bg-blue-100' };
    case 'review':
      return { icon: Star, color: 'text-yellow-600', bgColor: 'bg-yellow-100' };
    case 'alert':
    case 'no_show':
      return { icon: AlertCircle, color: 'text-red-600', bgColor: 'bg-red-100' };
    case 'reward':
      return { icon: Gift, color: 'text-green-600', bgColor: 'bg-green-100' };
    case 'completed':
      return { icon: CheckCircle2, color: 'text-green-600', bgColor: 'bg-green-100' };
    case 'cancelled':
      return { icon: XCircle, color: 'text-orange-600', bgColor: 'bg-orange-100' };
    default:
      return { icon: Bell, color: 'text-gray-600', bgColor: 'bg-gray-100' };
  }
}

// Format relative time
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'Just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Group notifications by time
function groupNotifications(notifications: Notification[]): Map<string, Notification[]> {
  const groups = new Map<string, Notification[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  for (const notification of notifications) {
    const notifDate = new Date(notification.timestamp);
    const notifDay = new Date(notifDate.getFullYear(), notifDate.getMonth(), notifDate.getDate());

    let group: string;
    if (notifDay.getTime() === today.getTime()) {
      group = 'Today';
    } else if (notifDay.getTime() === yesterday.getTime()) {
      group = 'Yesterday';
    } else {
      group = 'Earlier';
    }

    const existing = groups.get(group) || [];
    existing.push(notification);
    groups.set(group, existing);
  }

  return groups;
}

/**
 * Notification Card Component
 */
function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  const { icon: Icon, color, bgColor } = getNotificationStyle(notification.type);
  const [offset, setOffset] = useState(0);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 100 || Math.abs(info.velocity.x) > 500) {
      onDismiss(notification.id);
    } else {
      setOffset(0);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, x: offset }}
      exit={{ opacity: 0, x: offset > 0 ? 300 : -300, height: 0, marginBottom: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      drag="x"
      dragConstraints={{ left: -100, right: 100 }}
      dragElastic={0.2}
      onDrag={(_, info) => setOffset(info.offset.x)}
      onDragEnd={handleDragEnd}
      className={`
        mb-3 rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]
        ${!notification.read ? 'border-l-4 border-[#007AFF]' : ''}
        cursor-grab active:cursor-grabbing
      `}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`size-10 rounded-full ${bgColor} flex shrink-0 items-center justify-center`}>
          <Icon className={`size-5 ${color}`} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`text-[15px] font-semibold text-[#1C1C1E] ${!notification.read ? '' : 'opacity-70'}`}>
              {notification.title}
            </h3>
            <span className="shrink-0 text-[12px] text-[#8E8E93]">
              {formatRelativeTime(notification.timestamp)}
            </span>
          </div>
          <p className={`mt-0.5 line-clamp-2 text-[14px] text-[#8E8E93] ${!notification.read ? 'text-[#3C3C43]' : ''}`}>
            {notification.message}
          </p>
        </div>
      </div>

      {/* Swipe hint */}
      {Math.abs(offset) > 50 && (
        <div
          className={`absolute inset-y-0 ${offset > 0 ? 'left-0' : 'right-0'} flex w-20 items-center justify-center`}
          style={{
            background: offset > 0
              ? 'linear-gradient(to right, #FF3B30, transparent)'
              : 'linear-gradient(to left, #FF3B30, transparent)',
          }}
        >
          <X className="size-6 text-white" />
        </div>
      )}
    </motion.div>
  );
}

/**
 * Section Header Component
 */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
      {title}
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20">
      <div className="mb-4 flex size-20 items-center justify-center rounded-full bg-[#F2F2F7]">
        <Bell className="size-10 text-[#8E8E93]" />
      </div>
      <h3 className="mb-1 text-[20px] font-semibold text-[#1C1C1E]">
        All Caught Up
      </h3>
      <p className="text-center text-[15px] text-[#8E8E93]">
        No recent activity to show
      </p>
    </div>
  );
}

/**
 * Loading Skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3 px-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-[16px] bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-full bg-gray-200" />
            <div className="flex-1">
              <div className="mb-2 h-4 w-32 rounded bg-gray-200" />
              <div className="h-3 w-full rounded bg-gray-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Convert appointment to notification
function appointmentToNotification(appointment: {
  id: string;
  status: string;
  clientName: string | null;
  startTime: string;
  createdAt: string;
  services?: { name: string }[];
}): Notification {
  const serviceName = appointment.services?.[0]?.name || 'Appointment';
  const clientName = appointment.clientName || 'Guest';
  const appointmentTime = new Date(appointment.startTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const appointmentDate = new Date(appointment.startTime).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  switch (appointment.status) {
    case 'completed':
      return {
        id: appointment.id,
        type: 'completed',
        title: 'Appointment Completed',
        message: `${clientName}'s ${serviceName} was completed`,
        timestamp: new Date(appointment.startTime),
        read: true,
      };
    case 'cancelled':
      return {
        id: appointment.id,
        type: 'cancelled',
        title: 'Appointment Cancelled',
        message: `${clientName} cancelled ${serviceName} for ${appointmentDate}`,
        timestamp: new Date(appointment.createdAt),
        read: true,
      };
    case 'no_show':
      return {
        id: appointment.id,
        type: 'no_show',
        title: 'No Show',
        message: `${clientName} didn't show up for ${serviceName}`,
        timestamp: new Date(appointment.startTime),
        read: false,
      };
    case 'confirmed':
    case 'pending':
    default:
      return {
        id: appointment.id,
        type: 'booking',
        title: 'New Booking',
        message: `${clientName} booked ${serviceName} for ${appointmentDate} at ${appointmentTime}`,
        timestamp: new Date(appointment.createdAt),
        read: new Date(appointment.createdAt) < new Date(Date.now() - 1000 * 60 * 60), // Read if older than 1 hour
      };
  }
}

export function NotificationsModal({ onClose }: NotificationsModalProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Fetch recent appointments as activity
  const fetchActivity = useCallback(async () => {
    // Skip if already loaded (prevent re-fetch on re-open)
    if (hasLoaded) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch recent appointments (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateStr = sevenDaysAgo.toISOString().split('T')[0];

      const response = await fetch(
        `/api/admin/appointments?startDate=${dateStr}`,
      );

      if (!response.ok) {
        throw new Error('Failed to load activity');
      }

      const result = await response.json();
      const appointments = result.data?.appointments || [];

      // Convert appointments to notifications
      const activityNotifications: Notification[] = appointments
        .slice(0, 20) // Limit to 20 most recent
        .map(appointmentToNotification)
        .sort((a: Notification, b: Notification) => b.timestamp.getTime() - a.timestamp.getTime());

      setNotifications(activityNotifications);
      setHasLoaded(true);
    } catch (err) {
      console.error('Failed to fetch activity:', err);
      setError('Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [hasLoaded]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const handleDismiss = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleClearAll = () => {
    setNotifications([]);
  };

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const groupedNotifications = groupNotifications(notifications);

  return (
    <div className="flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Activity"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'Recent Activity'}
          leftAction={<BackButton onClick={onClose} label="Back" />}
          rightAction={
            notifications.length > 0
              ? (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-[15px] font-medium text-[#007AFF] transition-opacity active:opacity-50"
                  >
                    Mark Read
                  </button>
                )
              : null
          }
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {loading
          ? (<LoadingSkeleton />)
          : error
            ? (
                <div className="flex flex-col items-center justify-center px-8 py-20">
                  <p className="mb-2 text-sm text-red-600">{error}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setHasLoaded(false);
                      fetchActivity();
                    }}
                    className="text-sm font-medium text-[#007AFF]"
                  >
                    Try again
                  </button>
                </div>
              )
            : notifications.length === 0
              ? (<EmptyState />)
              : (
                  <>
                    {/* Clear All Button */}
                    {notifications.length > 0 && (
                      <div className="mb-4 flex justify-end">
                        <button
                          type="button"
                          onClick={handleClearAll}
                          className="text-[13px] font-medium text-[#FF3B30] transition-opacity active:opacity-50"
                        >
                          Clear All
                        </button>
                      </div>
                    )}

                    {/* Grouped Notifications */}
                    <AnimatePresence>
                      {Array.from(groupedNotifications.entries()).map(([group, groupNotifs]) => (
                        <div key={group} className="mb-6">
                          <SectionHeader title={group} />
                          {groupNotifs.map(notification => (
                            <NotificationCard
                              key={notification.id}
                              notification={notification}
                              onDismiss={handleDismiss}
                            />
                          ))}
                        </div>
                      ))}
                    </AnimatePresence>
                  </>
                )}
      </div>
    </div>
  );
}

// Export badge count helper - now returns 0 as we fetch real data
export function getUnreadNotificationCount(): number {
  // In production, this would be managed by a notification service
  return 0;
}
