'use client';

/**
 * AppGrid Component
 *
 * Page 2 of the swipeable admin dashboard.
 * iOS Home Screen-style 3-column app grid.
 * Features:
 * - Gradient app icons with colored shadows
 * - Tap animation with spring physics
 * - Gloss overlay effect
 * - Notification badges
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
  icon: LucideIcon;
  gradient: string;
  shadowColor: string;
  badge?: number;
};

// App definitions with gradients
const APPS: AppItem[] = [
  {
    id: 'luster',
    name: 'Luster',
    icon: BookOpen,
    gradient: 'from-[#9f1239] to-[#fb7185]',
    shadowColor: '#be123c',
  },
  {
    id: 'schedule',
    name: 'Schedule',
    icon: CalendarDays,
    gradient: 'from-rose-800 to-rose-500',
    shadowColor: '#9f1239',
  },
  {
    id: 'bookings',
    name: 'Bookings',
    icon: Calendar,
    gradient: 'from-rose-700 to-amber-500',
    shadowColor: '#be123c',
  },
  {
    id: 'clients',
    name: 'Clients',
    icon: Users,
    gradient: 'from-amber-500 to-orange-400',
    shadowColor: '#d97706',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    icon: BarChart3,
    gradient: 'from-stone-800 to-stone-600',
    shadowColor: '#292524',
  },
  {
    id: 'services',
    name: 'Services',
    icon: Scissors,
    gradient: 'from-rose-600 to-pink-400',
    shadowColor: '#e11d48',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    icon: Bell,
    gradient: 'from-[#4C1D2E] to-[#8B1538]',
    shadowColor: '#4C1D2E',
  },
  {
    id: 'reviews',
    name: 'Reviews',
    icon: Star,
    gradient: 'from-amber-400 to-rose-400',
    shadowColor: '#f59e0b',
  },
  {
    id: 'rewards',
    name: 'Rewards',
    icon: Gift,
    gradient: 'from-amber-500 to-yellow-300',
    shadowColor: '#d97706',
  },
  {
    id: 'staff',
    name: 'Staff',
    icon: Shield,
    gradient: 'from-stone-700 to-rose-500',
    shadowColor: '#57534e',
  },
  {
    id: 'staff-ops',
    name: 'Staff Ops',
    icon: ClipboardList,
    gradient: 'from-rose-900 to-amber-500',
    shadowColor: '#881337',
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: Settings,
    gradient: 'from-stone-500 to-stone-300',
    shadowColor: '#78716c',
  },
];

/**
 * Single App Tile
 */
type AppTileProps = {
  app: AppItem;
  theme?: Theme;
  onTap?: (appId: string) => void;
};

function AppTile({ app, theme = 'apple', onTap }: AppTileProps) {
  const Icon = app.icon;

  return (
    <div className="group flex cursor-pointer flex-col items-center gap-2">
      {/* Icon Container */}
      <motion.button
        type="button"
        onClick={() => onTap?.(app.id)}
        whileTap={{ scale: 0.9, filter: 'brightness(0.8)' }}
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        data-testid={`admin-app-tile-${app.id}`}
        className={`
          relative flex size-[64px] items-center justify-center rounded-[15px] bg-gradient-to-br ${app.gradient}
        `}
        style={{
          boxShadow:
            theme === 'apple'
              ? `0 10px 25px -5px ${app.shadowColor}60`
              : 'none',
        }}
      >
        {/* Gloss Effect (Apple Theme Only) */}
        {theme === 'apple' && (
          <div className="pointer-events-none absolute inset-0 rounded-[15px] bg-gradient-to-b from-white/30 to-transparent" />
        )}

        {/* Icon */}
        <Icon
          className={`relative z-10 size-7 drop-shadow-md ${
            theme === 'tesla' ? 'text-black' : 'text-white'
          }`}
          strokeWidth={2.5}
        />

        {/* Tesla Theme: Neon Border */}
        {theme === 'tesla' && (
          <div className="absolute inset-0 rounded-[15px] border border-white/20" />
        )}

        {/* Badge */}
        {typeof app.badge === 'number' && app.badge > 0 && (
          <div className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3B30] px-1">
            <span className="text-[11px] font-bold text-white">
              {app.badge > 99 ? '99+' : app.badge}
            </span>
          </div>
        )}
      </motion.button>

      {/* Label */}
      <span
        className={`
          text-center text-[12px] font-medium leading-tight tracking-tight transition-colors
          ${
    theme === 'apple'
      ? 'text-gray-900'
      : theme === 'tesla'
        ? 'text-gray-300 group-hover:text-white'
        : 'text-[#3F2B24]'
    }
        `}
      >
        {app.name}
      </span>
    </div>
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
        min-h-full w-full px-6 pb-20 pt-8
        ${theme === 'tesla' ? 'bg-black' : 'bg-[#F8F3F0]'}
      `}
    >
      {/* Grid: 3 Columns */}
      <div className="mx-auto grid max-w-sm grid-cols-3 gap-x-6 gap-y-10">
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
