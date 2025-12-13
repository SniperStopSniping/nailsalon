'use client';

/**
 * Staff Bottom Navigation Component
 *
 * Shared bottom navigation for all staff pages.
 * Includes Home, Photos, Schedule, and optionally Earnings (if module enabled).
 */

import { useParams, useRouter } from 'next/navigation';

import { useStaffCapabilities } from '@/hooks/useStaffCapabilities';
import { themeVars } from '@/theme';

// =============================================================================
// TYPES
// =============================================================================

type NavItem = 'home' | 'photos' | 'schedule' | 'earnings';

interface StaffBottomNavProps {
  activeItem: NavItem;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function StaffBottomNav({ activeItem }: StaffBottomNavProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const { modules } = useStaffCapabilities();
  const showEarnings = modules?.staffEarnings ?? false;

  const navItems: Array<{ id: NavItem; label: string; icon: string; path: string; visible: boolean }> = [
    { id: 'home', label: 'Home', icon: '🏠', path: `/${locale}/staff`, visible: true },
    { id: 'photos', label: 'Photos', icon: '📸', path: `/${locale}/staff/appointments`, visible: true },
    { id: 'schedule', label: 'Schedule', icon: '⏰', path: `/${locale}/staff/schedule`, visible: true },
    { id: 'earnings', label: 'Earnings', icon: '💰', path: `/${locale}/staff/earnings`, visible: showEarnings },
  ];

  const visibleItems = navItems.filter((item) => item.visible);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 border-t bg-white/95 px-4 py-3 backdrop-blur-sm"
      style={{ borderColor: themeVars.cardBorder }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-around">
        {visibleItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => router.push(item.path)}
            className="flex flex-col items-center gap-0.5 text-center"
            style={{ color: activeItem === item.id ? themeVars.accent : 'rgb(115, 115, 115)' }}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-xs font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
