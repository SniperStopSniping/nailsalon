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
import type { ReactNode } from 'react';

import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';
import { themeVars } from '@/theme';

// =============================================================================
// TYPES
// =============================================================================

type NavItem = 'home' | 'photos' | 'schedule' | 'earnings';

type StaffBottomNavProps = {
  activeItem: NavItem;
  /** Optional contextual action composed into this single bottom-edge region. */
  action?: ReactNode;
};

// =============================================================================
// COMPONENT
// =============================================================================

export function StaffBottomNav({ activeItem, action }: StaffBottomNavProps) {
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
      data-testid="staff-bottom-region"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50"
    >
      {action && (
        <div data-testid="staff-bottom-context-action" className="pointer-events-auto px-4 pb-3">
          {action}
        </div>
      )}
      <nav
        aria-label="Staff navigation"
        className="pointer-events-auto border-t bg-white/95 px-4 pt-3 backdrop-blur-sm"
        style={{
          borderColor: themeVars.cardBorder,
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-around">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(item.path)}
                className="flex min-h-11 min-w-16 flex-col items-center justify-center gap-1 py-1 text-center"
                style={{ color: activeItem === item.id ? themeVars.accent : 'rgb(115, 115, 115)' }}
                aria-current={activeItem === item.id ? 'page' : undefined}
              >
                <Icon className="size-5" strokeWidth={activeItem === item.id ? 2.5 : 2} />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
