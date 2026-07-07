'use client';

/**
 * Staff Bottom Navigation Component
 *
 * Shared bottom navigation for all staff pages.
 * Includes Home, Photos, Schedule, and optionally Earnings (if module enabled).
 */

import type { LucideIcon } from 'lucide-react';
import { CalendarClock, Camera, DollarSign, Home } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';
import { themeVars } from '@/theme';

// =============================================================================
// TYPES
// =============================================================================

type NavItem = 'home' | 'photos' | 'schedule' | 'earnings';

type StaffBottomNavProps = {
  activeItem: NavItem;
};

// =============================================================================
// COMPONENT
// =============================================================================

export function StaffBottomNav({ activeItem }: StaffBottomNavProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const { modules } = useStaffCapabilities();
  const showEarnings = modules?.staffEarnings ?? false;

  const navItems: Array<{ id: NavItem; label: string; icon: LucideIcon; path: string; visible: boolean }> = [
    { id: 'home', label: 'Home', icon: Home, path: `/${locale}/staff`, visible: true },
    { id: 'photos', label: 'Photos', icon: Camera, path: `/${locale}/staff/appointments`, visible: true },
    { id: 'schedule', label: 'Schedule', icon: CalendarClock, path: `/${locale}/staff/schedule`, visible: true },
    { id: 'earnings', label: 'Earnings', icon: DollarSign, path: `/${locale}/staff/earnings`, visible: showEarnings },
  ];

  const visibleItems = navItems.filter(item => item.visible);

  return (
    <div
      className="fixed inset-x-0 bottom-0 border-t bg-white/95 px-4 py-3 backdrop-blur-sm"
      style={{ borderColor: themeVars.cardBorder }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-around">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => router.push(item.path)}
              className="flex min-w-16 flex-col items-center gap-1 py-1 text-center"
              style={{ color: activeItem === item.id ? themeVars.accent : 'rgb(115, 115, 115)' }}
              aria-current={activeItem === item.id ? 'page' : undefined}
            >
              <Icon className="size-5" strokeWidth={activeItem === item.id ? 2.5 : 2} />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
