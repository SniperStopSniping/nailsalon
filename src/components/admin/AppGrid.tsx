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
import {
  Calendar,
  Users,
  BarChart3,
  Star,
  Bell,
  Settings,
  Scissors,
  Gift,
  Shield,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Types
type Theme = 'apple' | 'tesla' | 'luxury';

interface AppItem {
  id: string;
  name: string;
  icon: LucideIcon;
  gradient: string;
  shadowColor: string;
  badge?: number;
}

// App definitions with gradients
const APPS: AppItem[] = [
  {
    id: 'bookings',
    name: 'Bookings',
    icon: Calendar,
    gradient: 'from-[#4facfe] to-[#00f2fe]',
    shadowColor: '#4facfe',
  },
  {
    id: 'clients',
    name: 'Clients',
    icon: Users,
    gradient: 'from-[#43e97b] to-[#38f9d7]',
    shadowColor: '#43e97b',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    icon: BarChart3,
    gradient: 'from-[#fa709a] to-[#fee140]',
    shadowColor: '#fa709a',
  },
  {
    id: 'services',
    name: 'Services',
    icon: Scissors,
    gradient: 'from-[#f093fb] to-[#f5576c]',
    shadowColor: '#f093fb',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    icon: Bell,
    gradient: 'from-[#89f7fe] to-[#66a6ff]',
    shadowColor: '#66a6ff',
  },
  {
    id: 'reviews',
    name: 'Reviews',
    icon: Star,
    gradient: 'from-[#f6d365] to-[#fda085]',
    shadowColor: '#f6d365',
  },
  {
    id: 'rewards',
    name: 'Rewards',
    icon: Gift,
    gradient: 'from-[#84fab0] to-[#8fd3f4]',
    shadowColor: '#84fab0',
  },
  {
    id: 'staff',
    name: 'Staff',
    icon: Shield,
    gradient: 'from-[#a18cd1] to-[#fbc2eb]',
    shadowColor: '#a18cd1',
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: Settings,
    gradient: 'from-[#d4fc79] to-[#96e6a1]',
    shadowColor: '#d4fc79',
  },
];

/**
 * Single App Tile
 */
interface AppTileProps {
  app: AppItem;
  theme?: Theme;
  onTap?: (appId: string) => void;
}

function AppTile({ app, theme = 'apple', onTap }: AppTileProps) {
  const Icon = app.icon;

  return (
    <div className="flex flex-col items-center gap-2 group cursor-pointer">
      {/* Icon Container */}
      <motion.button
        type="button"
        onClick={() => onTap?.(app.id)}
        whileTap={{ scale: 0.9, filter: 'brightness(0.8)' }}
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className={`
          relative w-[64px] h-[64px] rounded-[15px] flex items-center justify-center
          bg-gradient-to-br ${app.gradient}
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
          <div className="absolute inset-0 rounded-[15px] bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
        )}

        {/* Icon */}
        <Icon
          className={`w-7 h-7 drop-shadow-md relative z-10 ${
            theme === 'tesla' ? 'text-black' : 'text-white'
          }`}
          strokeWidth={2.5}
        />

        {/* Tesla Theme: Neon Border */}
        {theme === 'tesla' && (
          <div className="absolute inset-0 rounded-[15px] border border-white/20" />
        )}

        {/* Badge */}
        {app.badge && app.badge > 0 && (
          <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-[#FF3B30] rounded-full flex items-center justify-center px-1">
            <span className="text-white text-[11px] font-bold">
              {app.badge > 99 ? '99+' : app.badge}
            </span>
          </div>
        )}
      </motion.button>

      {/* Label */}
      <span
        className={`
          text-[12px] font-medium tracking-tight text-center leading-tight transition-colors
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
interface AppGridProps {
  theme?: Theme;
  badges?: Record<string, number>;
  onAppTap?: (appId: string) => void;
}

export function AppGrid({ theme = 'apple', badges = {}, onAppTap }: AppGridProps) {
  // Merge badges into apps
  const appsWithBadges = APPS.map((app) => ({
    ...app,
    badge: badges[app.id] || 0,
  }));

  return (
    <div
      className={`
        w-full min-h-full px-6 pt-8 pb-20
        ${theme === 'tesla' ? 'bg-black' : 'bg-[#F2F2F7]'}
      `}
    >
      {/* Grid: 3 Columns */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-10 max-w-sm mx-auto">
        {appsWithBadges.map((app) => (
          <AppTile key={app.id} app={app} theme={theme} onTap={onAppTap} />
        ))}
      </div>
    </div>
  );
}

// Export app IDs for type safety
export type AppId = (typeof APPS)[number]['id'];
export { APPS };

