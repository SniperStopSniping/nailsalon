'use client';

/**
 * AppGrid Component
 *
 * The "More" workspace application launcher.
 * Mobile-first two-column grid of tappable cards:
 * - Icon chips painted from the owner plum/rose/amber palette. Every stop is
 *   dark enough that the white glyph clears 4.5:1 (AppGrid.contrast.test.ts
 *   asserts it): the old chips ran to stone-300 / yellow-300, where a white
 *   icon sat at ~1.3:1 and simply disappeared.
 * - Whole card is the tap target (spring press animation, focus ring)
 * - Short descriptions that name the destination, not the department
 * - Real notification badges only (counts come from API data)
 *
 * Below the grid the More tab also carries the two things an owner could not
 * find anywhere else:
 * - the capabilities this salon's plan does not include, kept visible and
 *   named (they used to vanish without explanation — AG-more-settings-01,
 *   AG-w2-more-tools-03), and
 * - the Account row, which is where session-ending belongs (AG-cohesion-04):
 *   two deliberate taps with a named confirmation, not a red pill in the
 *   header of every screen next to the bell.
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
  Images,
  LayoutTemplate,
  LogOut,
  Plug,
  Scissors,
  Settings,
  Shield,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { LockedFeatureRow } from '@/components/ui/locked-feature-row';

// Types
type Theme = 'apple' | 'tesla' | 'luxury';

type AppItem = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Icon chip gradient, top-left stop. Hex so the contrast test can read it. */
  iconFrom: string;
  /** Icon chip gradient, bottom-right stop (the lighter end). */
  iconTo: string;
  badge?: number;
};

// App definitions.
// schedule/bookings/clients/services are always hidden by the dashboard (they
// live in the bottom navigation) but stay defined for tab-based modal routing.
const APPS: AppItem[] = [
  {
    id: 'luster',
    name: 'Luster',
    description: 'Products, offers and education',
    icon: BookOpen,
    iconFrom: '#4C1D2E',
    iconTo: '#8B1538',
  },
  {
    // Luster UI/UX plan rev 3, PR 5 / section 10: "Booking Page becomes a
    // prominent destination inside More / the App Grid" — the one genuinely
    // new destination this PR adds, because booking-page appearance
    // currently lives inside the 5532-line SettingsModal. Navigates directly
    // (see handleAppTap in [locale]/admin/page.tsx), same as 'luster', rather
    // than opening as a ?app= modal.
    id: 'booking-page',
    name: 'Booking Page',
    description: 'Layout, style, text and publishing',
    icon: LayoutTemplate,
    iconFrom: '#70213F',
    iconTo: '#A83A5F',
  },
  {
    id: 'workspace-tour',
    name: 'Workspace tour',
    description: 'Replay the five-step guide',
    icon: Sparkles,
    iconFrom: '#8F3155',
    iconTo: '#B8506F',
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Google Calendar, texting and email',
    icon: Plug,
    iconFrom: '#44403C',
    iconTo: '#78716C',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Promotions, reminders and retention',
    icon: Bell,
    iconFrom: '#9F1239',
    iconTo: '#BB3E5F',
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Business, booking and payment setup',
    icon: Settings,
    iconFrom: '#292524',
    iconTo: '#57534E',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Revenue, bookings and trends',
    icon: BarChart3,
    iconFrom: '#7C4A24',
    iconTo: '#A2570B',
  },
  {
    id: 'reviews',
    name: 'Review rewards',
    description: 'Google review rewards',
    icon: Star,
    iconFrom: '#AD1457',
    iconTo: '#D81B60',
  },
  {
    id: 'rewards',
    name: 'Rewards',
    description: 'Client points and offers',
    icon: Gift,
    iconFrom: '#881337',
    iconTo: '#B1414F',
  },
  {
    id: 'staff',
    name: 'Staff',
    description: 'Team, schedules and permissions',
    icon: Shield,
    iconFrom: '#4A4340',
    iconTo: '#6B6461',
  },
  {
    id: 'staff-ops',
    name: 'Time-off requests',
    description: 'Approve or decline team time off',
    icon: ClipboardList,
    iconFrom: '#292524',
    iconTo: '#5B514F',
  },
  {
    id: 'schedule',
    name: 'Schedule',
    description: 'Calendar overview',
    icon: CalendarDays,
    iconFrom: '#70213F',
    iconTo: '#A83A5F',
  },
  {
    id: 'bookings',
    name: 'Bookings',
    description: 'All appointments',
    icon: Calendar,
    iconFrom: '#881337',
    iconTo: '#B1414F',
  },
  {
    id: 'clients',
    name: 'Clients',
    description: 'Client list',
    icon: Users,
    iconFrom: '#7C4A24',
    iconTo: '#A2570B',
  },
  {
    id: 'services',
    name: 'Services',
    description: 'Menu and pricing',
    icon: Scissors,
    iconFrom: '#9F1239',
    iconTo: '#BB3E5F',
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Photos of your nail work',
    icon: Images,
    iconFrom: '#7A2E10',
    iconTo: '#C2410C',
  },
];

/**
 * Grid order (the audit's one presentation rule): Booking Page first because
 * it is the destination owners come to More for; the two "not a business tool"
 * tiles last, the tour before the Luster brand page; everything else keeps its
 * declaration order.
 */
const TILE_ORDER: Record<string, number> = {
  'booking-page': -2,
  'workspace-tour': 1,
  'luster': 2,
};

/**
 * Apps that leave the grid because of a module entitlement rather than because
 * they live in the bottom navigation. Only these are worth naming as locked;
 * the nav-only four are not missing, they are elsewhere.
 */
const ENTITLEMENT_LOCKABLE_APP_IDS = [
  'analytics',
  'rewards',
  'reviews',
  'staff',
  'staff-ops',
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
        transition-colors focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]
        ${theme === 'tesla' ? 'border-white/10 bg-stone-900 active:bg-stone-800' : 'border-rose-100/80 bg-white shadow-sm active:bg-rose-50/60'}
      `}
    >
      {/*
        Gradient icon. Flat, with no white gloss overlay: the old
        `from-white/30` sheen lifted the top of every chip by ~1.3 contrast
        points, which is part of what pushed the pale chips below legibility.
      */}
      <span
        className="relative flex size-12 shrink-0 items-center justify-center rounded-[13px]"
        style={{
          backgroundColor: app.iconFrom,
          backgroundImage: `linear-gradient(135deg, ${app.iconFrom} 0%, ${app.iconTo} 100%)`,
          boxShadow:
            theme === 'apple' ? `0 8px 18px -6px ${app.iconFrom}55` : 'none',
        }}
      >
        <Icon className="relative z-10 size-6 text-white" strokeWidth={2.5} />
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

export type AppGridAccount = {
  /** The signed-in person, as the workspace already names them. */
  name?: string | null;
  /** The salon this session is managing — named in the confirmation. */
  salonName?: string | null;
  /** Ends the session. Only ever called after the owner confirms. */
  onLogOut: () => void;
};

/**
 * Account row — the home for session-ending.
 *
 * Two deliberate taps and a named confirmation, in the owner ink colour. The
 * header's one-tap red pill (AG-cohesion-04 / AG-w2-settings-integrations-12)
 * put the most disruptive control a thumb-width from the most-tapped one.
 */
function AccountSection({ account, theme }: { account: AppGridAccount; theme: Theme }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const logOutRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (wasConfirmingRef.current) {
      logOutRef.current?.focus();
    }
    wasConfirmingRef.current = confirming;
  }, [confirming]);

  const cardClass = theme === 'tesla'
    ? 'border-white/10 bg-stone-900 text-gray-100'
    : 'border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] text-[var(--owner-ink,#30262a)]';

  const salonName = account.salonName?.trim();

  return (
    <section
      aria-labelledby="more-account-heading"
      className="mx-auto mt-6 w-full max-w-md"
      data-testid="more-account"
    >
      <h2
        className="px-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--owner-muted,#706267)]"
        id="more-account-heading"
      >
        Account
      </h2>
      <div className={`mt-2 rounded-2xl border p-4 shadow-sm ${cardClass}`}>
        <p className="text-[15px] font-semibold">
          {account.name?.trim() || 'Your Luster account'}
        </p>
        <p className="mt-0.5 text-[13px] text-[var(--owner-muted,#706267)]">
          {salonName ? `Signed in for ${salonName}` : 'Signed in'}
        </p>

        {confirming
          ? (
              <div
                aria-labelledby="more-account-logout-question"
                className="mt-4 rounded-xl border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-blush,#f6e7ec)] p-3"
                data-testid="more-account-logout-confirm-panel"
                role="group"
              >
                <p
                  className="text-[14px] leading-5 text-[var(--owner-ink,#30262a)]"
                  id="more-account-logout-question"
                >
                  {salonName ? `Log out of ${salonName}?` : 'Log out of your workspace?'}
                  {' '}
                  You will have to sign in again to see today’s appointments or
                  change anything. Nothing is lost.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="min-h-11 flex-1 rounded-full bg-[var(--owner-accent,#8f3155)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--owner-accent-strong,#70213f)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] focus-visible:ring-offset-2"
                    data-testid="more-account-logout-confirm"
                    onClick={account.onLogOut}
                    ref={confirmRef}
                    type="button"
                  >
                    Log out
                  </button>
                  <button
                    className="min-h-11 flex-1 rounded-full border border-[var(--owner-line-strong,#d8c1c8)] px-4 text-sm font-semibold text-[var(--owner-ink,#30262a)] transition-colors hover:bg-[var(--owner-ground,#f8f2ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]"
                    data-testid="more-account-logout-cancel"
                    onClick={() => setConfirming(false)}
                    type="button"
                  >
                    Stay signed in
                  </button>
                </div>
              </div>
            )
          : (
              <button
                className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--owner-line-strong,#d8c1c8)] px-4 text-sm font-semibold text-[var(--owner-ink,#30262a)] transition-colors hover:bg-[var(--owner-ground,#f8f2ed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)]"
                data-testid="more-account-logout"
                onClick={() => setConfirming(true)}
                ref={logOutRef}
                type="button"
              >
                <LogOut aria-hidden="true" size={16} />
                Log out
              </button>
            )}
      </div>
    </section>
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
  /**
   * When provided, the More tab carries the Account row under the tiles:
   * identity plus Log out behind a named confirmation. Omitted where there is
   * no session to end.
   */
  account?: AppGridAccount;
};

const EMPTY_BADGES: Record<string, number> = {};
const EMPTY_HIDDEN_IDS: string[] = [];

export function AppGrid({ theme = 'apple', badges = EMPTY_BADGES, onAppTap, hiddenIds = EMPTY_HIDDEN_IDS, account }: AppGridProps) {
  // Merge badges into apps
  const appsWithBadges = APPS.filter(app => !hiddenIds.includes(app.id)).sort(
    (a, b) => (TILE_ORDER[a.id] ?? 0) - (TILE_ORDER[b.id] ?? 0),
  ).map(app => ({
    ...app,
    badge: badges[app.id] || 0,
  }));

  // Capabilities this salon's plan does not include. Named rather than absent:
  // a tile that is simply gone reads as a product that lost a feature.
  const lockedApps = APPS.filter(
    app => hiddenIds.includes(app.id) && ENTITLEMENT_LOCKABLE_APP_IDS.includes(app.id),
  );

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

      {lockedApps.length > 0 && (
        <section
          aria-labelledby="more-locked-heading"
          className="mx-auto mt-6 w-full max-w-md"
          data-testid="more-locked-apps"
        >
          <h2
            className="px-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--owner-muted,#706267)]"
            id="more-locked-heading"
          >
            Not on this salon’s plan
          </h2>
          <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--owner-line,#dfd1d4)] bg-[var(--owner-surface,#fffdfb)] shadow-sm">
            {lockedApps.map((app, index) => (
              <LockedFeatureRow
                icon={<app.icon className="size-3.5" />}
                isLast={index === lockedApps.length - 1}
                key={app.id}
                name={app.name}
              />
            ))}
          </div>
        </section>
      )}

      {account ? <AccountSection account={account} theme={theme} /> : null}
    </div>
  );
}

// Export app IDs for type safety
export type AppId = (typeof APPS)[number]['id'];
export { APPS };
