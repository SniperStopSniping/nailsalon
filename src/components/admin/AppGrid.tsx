'use client';

/**
 * AppGrid Component
 *
 * The "More" workspace application launcher.
 * Mobile-first two-column grid of tappable cards:
 * - Gradient app icons with the warm Luster palette
 * - Whole card is the tap target (spring press animation, focus ring)
 * - Short descriptions, hidden on very narrow screens
 * - Real notification badges only (counts come from API data)
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  BookOpen,
  Calendar,
  CalendarDays,
  ClipboardList,
  Gift,
  Plug,
  Scissors,
  Settings,
  Shield,
  Star,
  Users,
} from 'lucide-react';

// Types
type Theme = 'apple' | 'tesla' | 'luxury';

type AppItem = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  gradient: string;
  shadowColor: string;
  badge?: number;
};

// App definitions with gradients.
// schedule/bookings/clients/services are always hidden by the dashboard (they
// live in the bottom navigation) but stay defined for tab-based modal routing.
const APPS: AppItem[] = [
  {
    id: 'luster',
    name: 'Luster',
    description: 'Learn and shop',
    icon: BookOpen,
    gradient: 'from-[#9f1239] to-[#fb7185]',
    shadowColor: '#be123c',
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Calendar, text and email',
    icon: Plug,
    gradient: 'from-rose-700 to-rose-400',
    shadowColor: '#be123c',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Promotions and retention',
    icon: Bell,
    gradient: 'from-[#4C1D2E] to-[#8B1538]',
    shadowColor: '#4C1D2E',
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Business and booking setup',
    icon: Settings,
    gradient: 'from-stone-500 to-stone-300',
    shadowColor: '#78716c',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Performance and trends',
    icon: BarChart3,
    gradient: 'from-stone-800 to-stone-600',
    shadowColor: '#292524',
  },
  {
    id: 'reviews',
    name: 'Reviews',
    description: 'Client feedback',
    icon: Star,
    gradient: 'from-amber-400 to-rose-400',
    shadowColor: '#f59e0b',
  },
  {
    id: 'rewards',
    name: 'Rewards',
    description: 'Points and offers',
    icon: Gift,
    gradient: 'from-amber-500 to-yellow-300',
    shadowColor: '#d97706',
  },
  {
    id: 'staff',
    name: 'Staff',
    description: 'Team and schedules',
    icon: Shield,
    gradient: 'from-stone-700 to-rose-500',
    shadowColor: '#57534e',
  },
  {
    id: 'staff-ops',
    name: 'Staff Ops',
    description: 'Approvals and requests',
    icon: ClipboardList,
    gradient: 'from-rose-900 to-amber-500',
    shadowColor: '#881337',
  },
  {
    id: 'schedule',
    name: 'Schedule',
    description: 'Calendar overview',
    icon: CalendarDays,
    gradient: 'from-rose-800 to-rose-500',
    shadowColor: '#9f1239',
  },
  {
    id: 'bookings',
    name: 'Bookings',
    description: 'All appointments',
    icon: Calendar,
    gradient: 'from-rose-700 to-amber-500',
    shadowColor: '#be123c',
  },
  {
    id: 'clients',
    name: 'Clients',
    description: 'Client list',
    icon: Users,
    gradient: 'from-amber-500 to-orange-400',
    shadowColor: '#d97706',
  },
  {
    id: 'services',
    name: 'Services',
    description: 'Menu and pricing',
    icon: Scissors,
    gradient: 'from-rose-600 to-pink-400',
    shadowColor: '#e11d48',
  },
];

/**
 * Single App Card — the entire card is one tappable button.
 */
type AppTileProps = {
  app: AppItem;
  theme?: Theme;
  onTap?: (appId: string) => void;
};

function AppTile({ app, theme = 'apple', onTap }: AppTileProps) {
  const Icon = app.icon;

  return (
    <motion.button
      type="button"
      onClick={() => onTap?.(app.id)}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      data-testid={`admin-app-tile-${app.id}`}
      className={`
        relative flex w-full flex-col items-start gap-2.5 rounded-2xl border p-3.5 text-left outline-none
        transition-colors focus-visible:ring-2 focus-visible:ring-rose-400
        ${theme === 'tesla' ? 'border-white/10 bg-stone-900 active:bg-stone-800' : 'border-rose-100/80 bg-white shadow-sm active:bg-rose-50/60'}
      `}
    >
      {/* Gradient icon */}
      <span
        className={`relative flex size-12 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br ${app.gradient}`}
        style={{
          boxShadow:
            theme === 'apple' ? `0 8px 18px -6px ${app.shadowColor}60` : 'none',
        }}
      >
        {theme === 'apple' && (
          <span className="pointer-events-none absolute inset-0 rounded-[13px] bg-gradient-to-b from-white/30 to-transparent" />
        )}
        <Icon
          className={`relative z-10 size-6 drop-shadow-md ${
            theme === 'tesla' ? 'text-black' : 'text-white'
          }`}
          strokeWidth={2.5}
        />
        {/* Real notification badge only (0 renders nothing) */}
        {typeof app.badge === 'number' && app.badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3B30] px-1">
            <span className="text-[11px] font-bold text-white">
              {app.badge > 99 ? '99+' : app.badge}
            </span>
          </span>
        )}
      </span>

      {/* Name + description (stacked below the icon so nothing truncates) */}
      <span className="w-full min-w-0">
        <span
          className={`block text-[15px] font-semibold leading-tight ${
            theme === 'tesla' ? 'text-gray-100' : 'text-stone-950'
          }`}
        >
          {app.name}
        </span>
        <span
          className={`mt-0.5 hidden text-[12px] leading-snug min-[360px]:block ${
            theme === 'tesla' ? 'text-gray-400' : 'text-stone-500'
          }`}
        >
          {app.description}
        </span>
      </span>
    </motion.button>
  );
}

/**
 * App Grid Container
 */
type AppGridProps = {
  theme?: Theme;
  badges?: Record<string, number>;
  onAppTap?: (appId: string) => void;
  hiddenIds?: string[];
};

const EMPTY_BADGES: Record<string, number> = {};
const EMPTY_HIDDEN_IDS: string[] = [];

export function AppGrid({ theme = 'apple', badges = EMPTY_BADGES, onAppTap, hiddenIds = EMPTY_HIDDEN_IDS }: AppGridProps) {
  // Merge badges into apps
  const appsWithBadges = APPS.filter(app => !hiddenIds.includes(app.id)).map(app => ({
    ...app,
    badge: badges[app.id] || 0,
  }));

  return (
    <div
      className={`
        min-h-full w-full px-4 pb-24 pt-6
        ${theme === 'tesla' ? 'bg-black' : 'bg-[#F8F3F0]'}
      `}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)' }}
    >
      {/* Grid: 2 columns, mobile-first */}
      <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
        {appsWithBadges.map(app => (
          <AppTile key={app.id} app={app} theme={theme} onTap={onAppTap} />
        ))}
      </div>
    </div>
  );
}

// Export app IDs for type safety
export type AppId = (typeof APPS)[number]['id'];
export { APPS };
