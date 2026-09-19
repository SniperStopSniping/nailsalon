/**
 * Owner Assistant navigation registry.
 *
 * Pure, browser-safe. The model may only cite a `key` from this list; code
 * turns keys into hrefs. Every entry was verified to resolve on main at the
 * time of writing (registry.test.ts pins the app/view/panel ids against the
 * admin shell's own allowlists):
 *   - `admin` targets → `/{locale}/admin?salon={slug}&app=…[&view=…]`
 *     (`URL_APP_IDS` in src/app/[locale]/admin/page.tsx; Settings tracks
 *     `view=` live, Team reads `view=` once at open and only for
 *     `permissions`, `staff`/`staff-ops` are legacy aliases that open the
 *     Members / Time Off screens).
 *   - `bookingPage` targets → `/{locale}/admin/booking-page?salon={slug}&panel=…`
 *     (panel allowlist in src/app/[locale]/admin/booking-page/page.tsx).
 *   - `path` targets → a literal admin path.
 *
 * `addressable` is honest about depth: 'parent' means the sub-view is local
 * state today and the link lands on the parent screen.
 */

export type RegistryAddressable = 'exact' | 'exact_on_open' | 'parent';

export type RegistryTarget =
  | { type: 'admin'; app?: string; view?: string }
  | { type: 'bookingPage'; panel: 'layouts' | 'appearance' | 'information' | 'text' | 'gallery' | 'policies' | 'publish' }
  | { type: 'path'; path: string; query?: Record<string, string> };

export type RegistryEntry = {
  key: string;
  label: string;
  description: string;
  synonyms: readonly string[];
  target: RegistryTarget;
  addressable: RegistryAddressable;
};

const entry = (
  key: string,
  label: string,
  description: string,
  synonyms: readonly string[],
  target: RegistryTarget,
  addressable: RegistryAddressable = 'exact',
): RegistryEntry => ({ key, label, description, synonyms, target, addressable });

export const OWNER_ASSISTANT_REGISTRY: readonly RegistryEntry[] = [
  entry('today', 'Today', 'Today\'s schedule and what needs attention.', ['today', 'home', 'dashboard', 'needs attention'], { type: 'admin' }),
  entry('calendar', 'Calendar', 'Appointments by day, week and month.', ['calendar', 'schedule', 'appointments', 'agenda'], { type: 'admin', app: 'schedule' }),
  entry('bookings', 'Bookings', 'Booking requests and upcoming appointments.', ['bookings', 'booking requests', 'pending bookings', 'confirm booking'], { type: 'admin', app: 'bookings' }),
  entry('clients', 'Clients', 'Client list and profiles.', ['clients', 'customers', 'client list', 'client profile'], { type: 'admin', app: 'clients' }),
  entry('services', 'Services', 'Your menu: services, add-ons, prices, durations and order.', ['services', 'menu', 'prices', 'add-ons', 'addons', 'reorder', 'service library', 'duration', 'intro price', 'featured'], { type: 'admin', app: 'services' }),
  entry('team', 'Team', 'Team members, schedules, time off and services & skills.', ['team', 'staff', 'technician', 'working days', 'schedules', 'services & skills', 'skills', 'earnings', 'blocked time'], { type: 'admin', app: 'team' }, 'parent'),
  entry('team_members', 'Team members', 'Add or edit team members and their profile photos.', ['team members', 'members', 'add staff', 'profile photo', 'technician photo', 'avatar', 'bio'], { type: 'admin', app: 'staff' }, 'exact_on_open'),
  entry('team_time_off', 'Time off', 'Time off and days away for team members.', ['time off', 'vacation', 'holiday', 'day off', 'away'], { type: 'admin', app: 'staff-ops' }, 'exact_on_open'),
  entry('team_permissions', 'Team permissions', 'What team members can see and do.', ['permissions', 'roles', 'access', 'collaborator'], { type: 'admin', app: 'team', view: 'permissions' }, 'exact_on_open'),
  entry('portfolio', 'Photos & Gallery', 'Shared photo library used across your pages.', ['portfolio', 'photos', 'gallery library', 'pictures', 'images'], { type: 'admin', app: 'portfolio' }),
  entry('marketing', 'Marketing', 'Follow-ups, campaigns, results and reviews.', ['marketing', 'campaigns', 'follow-ups', 'follow ups', 'rebook reminders', 'retention'], { type: 'admin', app: 'marketing' }),
  entry('integrations', 'Integrations', 'Google Calendar, texting and email connections.', ['integrations', 'google calendar', 'google', 'twilio', 'texting', 'sms connection', 'email connection', 'connect'], { type: 'admin', app: 'integrations' }, 'parent'),
  entry('payments', 'Payments', 'Deposits, payment methods and taxes.', ['payments', 'deposits', 'deposit', 'stripe', 'payment methods', 'taxes', 'tax'], { type: 'admin', app: 'payments' }, 'parent'),
  entry('analytics', 'Analytics', 'Performance and utilization dashboard.', ['analytics', 'reports', 'stats', 'utilization', 'revenue'], { type: 'admin', app: 'analytics' }),
  entry('rewards_reviews', 'Rewards & Reviews', 'Loyalty rewards and review requests.', ['rewards', 'reviews', 'loyalty', 'referrals'], { type: 'admin', app: 'rewards-reviews' }),

  entry('business_hours', 'Business hours', 'Regular salon hours and timezone (Hours & Availability).', ['business hours', 'opening hours', 'hours', 'open', 'closed', 'timezone', 'time zone', 'change my hours'], { type: 'admin', app: 'hours' }),
  entry('settings_location', 'Location', 'Address and how it is shown to customers.', ['location', 'address', 'map', 'city', 'where I am', 'address privacy'], { type: 'admin', app: 'settings', view: 'location' }),
  entry('settings_branding', 'Booking messages & social links', 'Booking confirmation messages and social links.', ['social links', 'instagram', 'booking messages', 'confirmation message'], { type: 'admin', app: 'settings', view: 'branding' }),
  entry('booking_rules', 'Booking rules', 'Minimum notice, slot interval, buffers, currency and confirmation settings.', ['booking rules', 'minimum notice', 'notice', 'slot interval', 'buffer', 'currency', 'confirmation', 'cutoff', 'lead time', 'how far in advance'], { type: 'admin', app: 'booking-rules', view: 'rules' }),
  entry('settings_booking_policy', 'Booking policy', 'Cancellation and no-show policy shown to customers.', ['booking policy', 'cancellation policy', 'no-show', 'no show', 'policy', 'terms'], { type: 'admin', app: 'booking-rules', view: 'policies' }),
  entry('settings_booking_flow', 'Booking flow', 'The order of steps customers take when booking.', ['booking flow', 'steps', 'choose artist step', 'flow order'], { type: 'admin', app: 'settings', view: 'booking-flow' }),
  entry('settings_smart_fit', 'Smart Fit', 'Smart Fit offers that fill gaps in your calendar.', ['smart fit', 'gap', 'fill gaps', 'offers'], { type: 'admin', app: 'marketing', view: 'smart-fit' }, 'exact_on_open'),
  entry('settings_communications', 'Appointment messages', 'Reminders, quiet hours, pausing texts and SMS credits.', ['communications', 'reminders', 'reminder', 'quiet hours', 'pause texts', 'sms credits', 'text messages', 'texts'], { type: 'admin', app: 'marketing', view: 'messages' }, 'exact_on_open'),
  entry('settings_notifications', 'Notifications', 'What you get notified about.', ['notifications', 'notify', 'alerts', 'bell'], { type: 'admin', app: 'settings', view: 'notifications' }),
  entry('settings_review_requests', 'Review requests', 'Automatic review requests after appointments.', ['review requests', 'ask for reviews', 'google reviews', 'review link'], { type: 'admin', app: 'marketing', view: 'reviews' }, 'exact_on_open'),
  entry('settings_visibility', 'Visibility', 'What client details team members can see.', ['visibility', 'hide phone', 'hide client', 'privacy of client details'], { type: 'admin', app: 'settings', view: 'visibility' }),
  entry('settings_features', 'Features', 'Which Luster features are turned on.', ['features', 'feature', 'turn on', 'turn off', 'enable', 'disable', 'plan'], { type: 'admin', app: 'settings', view: 'features' }),
  entry('settings_account', 'Account', 'Your account and sign-in.', ['account', 'sign in', 'login', 'password', 'phone number', 'email address'], { type: 'admin', app: 'settings', view: 'account' }),

  entry('booking_page_hub', 'Booking Page', 'Your booking page: preview, edit and publish.', ['booking page', 'website', 'my page', 'public page', 'link to my page', 'share link'], { type: 'path', path: '/admin/website' }),
  entry('page_layouts', 'Layouts', 'Choose the layout of your booking page.', ['layout', 'layouts', 'design', 'template', 'quick book'], { type: 'bookingPage', panel: 'layouts' }),
  entry('page_appearance', 'Appearance', 'Colours and look of your booking page.', ['appearance', 'colours', 'colors', 'theme', 'style', 'look'], { type: 'bookingPage', panel: 'appearance' }),
  entry('page_information', 'Business info display', 'What business details customers see, including hours and bio visibility.', ['business info', 'business information', 'show bio', 'hide bio', 'display hours', 'contact details shown'], { type: 'bookingPage', panel: 'information' }),
  entry('page_text', 'About & website text', 'Your introduction: specialty line and bio.', ['about', 'website text', 'introduction', 'intro', 'bio text', 'specialty line', 'tagline', 'description of my salon'], { type: 'bookingPage', panel: 'text' }),
  entry('page_gallery', 'Photos & Gallery', 'Upload your logo, profile photo, cover image and gallery photos.', ['logo', 'upload logo', 'upload my logo', 'brand logo', 'cover', 'cover image', 'cover photo', 'hero image', 'banner', 'profile picture', 'profile photo', 'gallery', 'photos', 'upload photo', 'upload image'], { type: 'bookingPage', panel: 'gallery' }),
  entry('page_policies', 'Page policies', 'Photo and social policies shown on your booking page.', ['page policies', 'photo policy', 'social policy'], { type: 'bookingPage', panel: 'policies' }),
  entry('page_publish', 'Preview & publish', 'Preview your booking page and publish changes.', ['publish', 'go live', 'make live', 'preview', 'unpublished changes', 'revert', 'is my page live'], { type: 'bookingPage', panel: 'publish' }),

  entry('policies_photos', 'Photo policies', 'Rules for client photos.', ['photo policies', 'client photos policy'], { type: 'path', path: '/admin/policies', query: { section: 'photos' } }),
  entry('policies_social', 'Social policies', 'Rules for social sharing.', ['social policies', 'sharing policy'], { type: 'path', path: '/admin/policies', query: { section: 'social' } }),
];

export type RegistryKey = string;

const byKey = new Map(OWNER_ASSISTANT_REGISTRY.map(item => [item.key, item]));

export function getRegistryEntry(key: string): RegistryEntry | null {
  return byKey.get(key) ?? null;
}

export function isRegistryKey(key: string): boolean {
  return byKey.has(key);
}

export function buildRegistryHref(entryOrKey: RegistryEntry | string, args: { locale: string; salonSlug: string }): string | null {
  const item = typeof entryOrKey === 'string' ? getRegistryEntry(entryOrKey) : entryOrKey;
  if (!item) {
    return null;
  }
  const locale = args.locale === 'fr' ? 'fr' : 'en';
  const qs = new URLSearchParams();
  qs.set('salon', args.salonSlug);
  switch (item.target.type) {
    case 'admin': {
      if (item.target.app) {
        qs.set('app', item.target.app);
      }
      if (item.target.view) {
        qs.set('view', item.target.view);
      }
      return `/${locale}/admin?${qs.toString()}`;
    }
    case 'bookingPage': {
      qs.set('panel', item.target.panel);
      return `/${locale}/admin/booking-page?${qs.toString()}`;
    }
    case 'path': {
      for (const [k, v] of Object.entries(item.target.query ?? {})) {
        qs.set(k, v);
      }
      return `/${locale}${item.target.path}?${qs.toString()}`;
    }
    default:
      return null;
  }
}

/**
 * The assistant's one text-normalisation rule: lowercase, NFKC, punctuation to
 * spaces, whitespace collapsed. Exported because the tools that match an
 * owner-typed name against a service or a team member must normalise exactly
 * the way registry search does — two rules would mean two answers.
 */
export function normalizeAssistantText(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic synonym/label search. Scores: exact synonym phrase match 6,
 * every query token present in a synonym 3, token in label 2, token in
 * description/key 1. Returns the best `limit` entries with a positive score.
 */
export function searchRegistry(query: string, limit = 5): RegistryEntry[] {
  const q = normalizeAssistantText(query);
  if (!q) {
    return [];
  }
  const tokens = q.split(' ').filter(token => token.length > 1);
  const scored = OWNER_ASSISTANT_REGISTRY.map((item) => {
    let score = 0;
    const synonyms = item.synonyms.map(normalizeAssistantText);
    if (synonyms.includes(q)) {
      score += 6;
    }
    for (const synonym of synonyms) {
      const synonymTokens = synonym.split(' ');
      if (tokens.length > 0 && tokens.every(token => synonymTokens.includes(token))) {
        score += 3;
      } else if (tokens.some(token => synonymTokens.includes(token))) {
        score += 1;
      }
    }
    const labelTokens = normalizeAssistantText(item.label).split(' ');
    const descriptionTokens = normalizeAssistantText(`${item.description} ${item.key.replace(/_/g, ' ')}`).split(' ');
    for (const token of tokens) {
      if (labelTokens.includes(token)) {
        score += 2;
      }
      if (descriptionTokens.includes(token)) {
        score += 1;
      }
    }
    return { item, score };
  });
  return scored
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.item.key.localeCompare(b.item.key))
    .slice(0, limit)
    .map(candidate => candidate.item);
}
