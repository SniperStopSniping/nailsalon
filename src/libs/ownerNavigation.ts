/** Browser-safe owner destinations. Aliases change navigation, never authority. */
export const OWNER_MANAGEMENT_VIEWS = {
  'hours': ['home', 'working-hours', 'time-off', 'requests'],
  'booking-rules': ['home', 'rules', 'policies'],
  'plan-usage': ['home', 'usage', 'plans'],
  'help': ['home'],
} as const;

export type OwnerManagementApp = keyof typeof OWNER_MANAGEMENT_VIEWS;

export function isOwnerManagementApp(app: string | null): app is OwnerManagementApp {
  return app !== null && Object.hasOwn(OWNER_MANAGEMENT_VIEWS, app);
}

export function ownerManagementView(app: OwnerManagementApp, view: string | null): string {
  return view && (OWNER_MANAGEMENT_VIEWS[app] as readonly string[]).includes(view) ? view : 'home';
}

const SETTINGS_ALIASES: Record<string, { app: string; view?: string }> = {
  'payments': { app: 'payments' },
  'currency': { app: 'payments', view: 'currency' },
  'visibility': { app: 'team', view: 'permissions' },
  'booking': { app: 'booking-rules', view: 'rules' },
  'booking-policy': { app: 'booking-rules', view: 'policies' },
  'review-requests': { app: 'marketing', view: 'reviews' },
  'communications': { app: 'marketing', view: 'messages' },
  'smart-fit': { app: 'marketing', view: 'smart-fit' },
};

/** Preserve salon/record/return context; replace the history entry at the caller. */
export function resolveOwnerNavigationAlias(query: URLSearchParams): URLSearchParams | null {
  const app = query.get('app');
  const view = query.get('view') ?? '';
  const teamViews: Record<string, string> = { 'schedules': 'working-hours', 'time-off': 'time-off', 'blocked-time': 'time-off', 'requests': 'requests' };
  const alias = app === 'settings'
    ? SETTINGS_ALIASES[view]
    : app === 'staff-ops'
      ? { app: 'hours', view: 'requests' }
      : app === 'team' && Object.hasOwn(teamViews, view)
        ? { app: 'hours', view: teamViews[view] }
        : undefined;
  if (!alias) {
    return null;
  }
  const next = new URLSearchParams(query);
  next.set('app', alias.app);
  next.delete('view');
  if (alias.view) {
    next.set('view', alias.view);
  }
  return next;
}

/**
 * A few retired Settings editors now have a canonical full-page home. Unlike
 * query-only aliases, this changes the pathname while preserving every query
 * key (salon, locale-derived route context, return target, record selection).
 */
export function resolveOwnerNavigationPathAlias(
  pathname: string,
  query: URLSearchParams,
): { pathname: string; query: URLSearchParams } | null {
  const app = query.get('app');
  const view = query.get('view');
  const isAdminDashboard = /\/(?:en|fr)\/admin$/.test(pathname);
  const bookingPagePanel = app === 'settings'
    ? ({
        'business-profile': 'business',
        'location': 'business',
        'branding': 'experience',
        'booking-experience': 'experience',
        'booking-flow': 'flow',
      } as Record<string, string>)[view ?? '']
    : undefined;
  if (!isAdminDashboard || !bookingPagePanel) {
    return null;
  }
  const next = new URLSearchParams(query);
  next.delete('app');
  next.delete('view');
  next.set('panel', bookingPagePanel);
  return { pathname: `${pathname}/booking-page`, query: next };
}
