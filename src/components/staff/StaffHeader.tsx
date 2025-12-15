'use client';

/**
 * Staff Header Component
 *
 * Shared header for all staff pages with notification bell.
 * Includes unread notification count badge.
 */

import { useCallback, useEffect, useState } from 'react';

import { themeVars } from '@/theme';

// =============================================================================
// TYPES
// =============================================================================

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

type StaffHeaderProps = {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightContent?: React.ReactNode;
};

// =============================================================================
// NOTIFICATION BELL
// =============================================================================

function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/notifications?limit=20');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.data?.notifications ?? []);
        setUnreadCount(data.data?.unreadCount ?? 0);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }, []);

  // Initial fetch + polling with pause-on-hidden
  useEffect(() => {
    fetchNotifications();

    let interval: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (!interval) {
        interval = setInterval(fetchNotifications, 60000);
      }
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchNotifications(); // Refresh immediately when tab becomes visible
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Start polling only if tab is visible
    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchNotifications]);

  // Mark all as read when panel opens
  const handleOpenPanel = async () => {
    setShowPanel(true);

    if (unreadCount > 0) {
      setLoading(true);
      try {
        const response = await fetch('/api/staff/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markAllRead: true }),
        });

        if (response.ok) {
          setUnreadCount(0);
          // Update local state to mark all as read
          setNotifications(prev =>
            prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
          );
        }
      } catch (error) {
        console.error('Failed to mark notifications as read:', error);
      } finally {
        setLoading(false);
      }
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) {
      return 'Just now';
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {/* Bell Button */}
      <button
        type="button"
        onClick={handleOpenPanel}
        className="relative flex size-10 items-center justify-center rounded-full transition-colors hover:bg-white/60"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: '#EF4444' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {showPanel && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close notifications panel"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-16 sm:pt-24"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowPanel(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowPanel(false);
            }
          }}
        >
          <div className="mx-4 max-h-[70vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: themeVars.cardBorder }}
            >
              <h3 className="text-lg font-bold" style={{ color: themeVars.titleText }}>
                Notifications
              </h3>
              <button
                type="button"
                onClick={() => setShowPanel(false)}
                className="text-2xl text-neutral-400 hover:text-neutral-600"
                aria-label="Close notifications"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <div
                    className="size-6 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
                  />
                </div>
              )}

              {!loading && notifications.length === 0 && (
                <div className="py-12 text-center">
                  <div className="mb-2 text-4xl">📭</div>
                  <p className="text-neutral-500">No notifications yet</p>
                </div>
              )}

              {!loading && notifications.length > 0 && (
                <div className="divide-y" style={{ borderColor: themeVars.cardBorder }}>
                  {notifications.map(notif => (
                    <div
                      key={notif.id}
                      className="px-4 py-3 transition-colors hover:bg-neutral-50"
                      style={{
                        backgroundColor: notif.readAt ? 'transparent' : themeVars.highlightBackground,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="font-medium text-neutral-900">{notif.title}</p>
                          <p className="mt-0.5 text-sm text-neutral-600">{notif.body}</p>
                        </div>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {formatTime(notif.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// STAFF HEADER
// =============================================================================

export function StaffHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightContent,
}: StaffHeaderProps) {
  return (
    <div className="pb-4 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-white/60"
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M12.5 15L7.5 10L12.5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
              {title}
            </h1>
            {subtitle && <p className="text-sm text-neutral-600">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {rightContent}
          <NotificationBell />
        </div>
      </div>
    </div>
  );
}

// Export NotificationBell separately for flexible use
export { NotificationBell };
