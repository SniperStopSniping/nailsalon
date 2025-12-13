'use client';

/**
 * IOSAppIcon Component
 *
 * Creates iOS-style app icons with gradient backgrounds.
 * Each icon category has its own signature gradient like real iOS apps.
 */

import {
  AlertTriangle,
  Calendar,
  ChartBar,
  Clock,
  Gift,
  type LucideIcon,
  MessageSquare,
  Settings,
  Sparkles,
  Star,
  Tag,
  Trophy,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';

// iOS-inspired gradient presets
export const iconGradients = {
  blue: { from: '#007AFF', to: '#5856D6' },
  green: { from: '#34C759', to: '#30D158' },
  orange: { from: '#FF9500', to: '#FF3B30' },
  red: { from: '#FF3B30', to: '#FF2D55' },
  purple: { from: '#AF52DE', to: '#5856D6' },
  pink: { from: '#FF2D55', to: '#FF6482' },
  teal: { from: '#5AC8FA', to: '#007AFF' },
  indigo: { from: '#5856D6', to: '#007AFF' },
  yellow: { from: '#FFCC00', to: '#FF9500' },
  gray: { from: '#8E8E93', to: '#636366' },
} as const;

export type IconGradient = keyof typeof iconGradients;

// Pre-defined app icons with their gradients
export const appIcons = {
  appointments: { icon: Calendar, gradient: 'blue' as IconGradient },
  team: { icon: Users, gradient: 'purple' as IconGradient },
  clients: { icon: Sparkles, gradient: 'pink' as IconGradient },
  analytics: { icon: ChartBar, gradient: 'green' as IconGradient },
  referrals: { icon: Gift, gradient: 'pink' as IconGradient },
  reviews: { icon: Star, gradient: 'orange' as IconGradient },
  marketing: { icon: MessageSquare, gradient: 'teal' as IconGradient },
  rewards: { icon: Trophy, gradient: 'yellow' as IconGradient },
  alerts: { icon: AlertTriangle, gradient: 'red' as IconGradient },
  services: { icon: Tag, gradient: 'indigo' as IconGradient },
  hours: { icon: Clock, gradient: 'blue' as IconGradient },
  settings: { icon: Settings, gradient: 'gray' as IconGradient },
} as const;

export type AppIconType = keyof typeof appIcons;

export type IOSAppIconProps = {
  /** Pre-defined app type or custom configuration */
  type?: AppIconType;
  /** Custom icon component (overrides type) */
  icon?: LucideIcon;
  /** Custom gradient (overrides type) */
  gradient?: IconGradient;
  /** Size of the icon container */
  size?: number;
  /** Custom className */
  className?: string;
};

export function IOSAppIcon({
  type,
  icon: customIcon,
  gradient: customGradient,
  size = 60,
  className = '',
}: IOSAppIconProps) {
  // Resolve icon and gradient from type or custom props
  const appConfig = type ? appIcons[type] : null;
  const Icon = customIcon || appConfig?.icon || Calendar;
  const gradientKey = customGradient || appConfig?.gradient || 'blue';
  const gradientColors = iconGradients[gradientKey];

  // iOS uses ~13.5% corner radius relative to size
  const borderRadius = Math.round(size * 0.22);
  const iconSize = Math.round(size * 0.45);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius,
        background: `linear-gradient(135deg, ${gradientColors.from} 0%, ${gradientColors.to} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 4px 12px ${gradientColors.from}40`,
      }}
    >
      <Icon
        size={iconSize}
        strokeWidth={2}
        color="#ffffff"
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))' }}
      />
    </div>
  );
}

/**
 * Renders a custom icon with gradient background
 */
export function IOSCustomIcon({
  children,
  gradient = 'blue',
  size = 60,
  className = '',
}: {
  children: ReactNode;
  gradient?: IconGradient;
  size?: number;
  className?: string;
}) {
  const gradientColors = iconGradients[gradient];
  const borderRadius = Math.round(size * 0.22);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius,
        background: `linear-gradient(135deg, ${gradientColors.from} 0%, ${gradientColors.to} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 4px 12px ${gradientColors.from}40`,
        color: '#ffffff',
      }}
    >
      {children}
    </div>
  );
}
