'use client';

/**
 * NotificationsModal Component
 *
 * iOS-style notification center modal.
 * Features:
 * - Grouped notifications by type
 * - Swipe to dismiss gesture
 * - Time-based grouping (Today, Yesterday, Earlier)
 * - Empty state
 */

import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { 
  Calendar, 
  Star, 
  AlertCircle,
  Gift,
  X,
  Bell,
} from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { ModalHeader, BackButton } from './AppModal';

interface NotificationsModalProps {
  onClose: () => void;
}

// Notification types
type NotificationType = 'booking' | 'review' | 'alert' | 'reward';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
}

// Mock notifications data
const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: '1',
    type: 'booking',
    title: 'New Booking',
    message: 'Sarah M. booked a Gel Manicure for tomorrow at 2:00 PM',
    timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 min ago
    read: false,
  },
  {
    id: '2',
    type: 'review',
    title: 'New Review',
    message: 'Jessica L. left a 5-star review: "Best nail salon!"',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    read: false,
  },
  {
    id: '3',
    type: 'booking',
    title: 'Appointment Cancelled',
    message: 'Amanda K. cancelled her appointment for today',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
    read: true,
  },
  {
    id: '4',
    type: 'reward',
    title: 'Reward Earned',
    message: 'Michelle R. earned a referral reward',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    read: true,
  },
  {
    id: '5',
    type: 'alert',
    title: 'Low Availability',
    message: 'Only 2 open slots remaining for tomorrow',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
    read: true,
  },
];

// Get icon and color for notification type
function getNotificationStyle(type: NotificationType): { icon: LucideIcon; color: string; bgColor: string } {
  switch (type) {
    case 'booking':
      return { icon: Calendar, color: 'text-blue-600', bgColor: 'bg-blue-100' };
    case 'review':
      return { icon: Star, color: 'text-yellow-600', bgColor: 'bg-yellow-100' };
    case 'alert':
      return { icon: AlertCircle, color: 'text-red-600', bgColor: 'bg-red-100' };
    case 'reward':
      return { icon: Gift, color: 'text-green-600', bgColor: 'bg-green-100' };
  }
}

// Format relative time
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
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
  onDismiss 
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
        bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-3
        ${!notification.read ? 'border-l-4 border-[#007AFF]' : ''}
        cursor-grab active:cursor-grabbing
      `}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`text-[15px] font-semibold text-[#1C1C1E] ${!notification.read ? '' : 'opacity-70'}`}>
              {notification.title}
            </h3>
            <span className="text-[12px] text-[#8E8E93] flex-shrink-0">
              {formatRelativeTime(notification.timestamp)}
            </span>
          </div>
          <p className={`text-[14px] text-[#8E8E93] mt-0.5 line-clamp-2 ${!notification.read ? 'text-[#3C3C43]' : ''}`}>
            {notification.message}
          </p>
        </div>
      </div>
      
      {/* Swipe hint */}
      {Math.abs(offset) > 50 && (
        <div 
          className={`absolute inset-y-0 ${offset > 0 ? 'left-0' : 'right-0'} w-20 flex items-center justify-center`}
          style={{ 
            background: offset > 0 
              ? 'linear-gradient(to right, #FF3B30, transparent)' 
              : 'linear-gradient(to left, #FF3B30, transparent)',
          }}
        >
          <X className="w-6 h-6 text-white" />
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
    <div className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-3 px-1">
      {title}
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="w-20 h-20 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <Bell className="w-10 h-10 text-[#8E8E93]" />
      </div>
      <h3 className="text-[20px] font-semibold text-[#1C1C1E] mb-1">
        All Caught Up
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        No new notifications right now
      </p>
    </div>
  );
}

export function NotificationsModal({ onClose }: NotificationsModalProps) {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);

  const handleDismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const handleClearAll = () => {
    setNotifications([]);
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const groupedNotifications = groupNotifications(notifications);

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
          leftAction={<BackButton onClick={onClose} label="Back" />}
          rightAction={
            notifications.length > 0 ? (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-[#007AFF] text-[15px] font-medium active:opacity-50 transition-opacity"
              >
                Mark Read
              </button>
            ) : null
          }
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10 px-4">
        {notifications.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Clear All Button */}
            {notifications.length > 0 && (
              <div className="flex justify-end mb-4">
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-[13px] text-[#FF3B30] font-medium active:opacity-50 transition-opacity"
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
                  {groupNotifs.map((notification) => (
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

// Export badge count helper
export function getUnreadNotificationCount(): number {
  // In production, this would fetch from API or state
  return MOCK_NOTIFICATIONS.filter((n) => !n.read).length;
}

