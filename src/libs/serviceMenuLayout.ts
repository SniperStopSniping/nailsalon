/**
 * Customer-facing service catalogue presentations.
 *
 * This is intentionally separate from `BookingPageLayout`: the latter owns
 * the whole booking page (`quick_book` / `editorial`), while this value only
 * changes how the same canonical services are browsed inside `serviceMenu`.
 * Keeping the contract client-safe lets the public renderer consume it
 * without importing the server-backed booking-page persistence module.
 */
export const SERVICE_MENU_LAYOUTS = [
  'visual_grid',
  'clean_list',
  'editorial_cards',
  'category_menu',
  'editorial_price_list',
] as const;

export type ServiceMenuLayout = (typeof SERVICE_MENU_LAYOUTS)[number];

export const DEFAULT_SERVICE_MENU_LAYOUT: ServiceMenuLayout = 'visual_grid';

export type ServiceMenuPresentation = Readonly<{
  columns: 1 | 2;
  description: 'hidden' | 'clamped' | 'editorial';
  grouped: boolean;
  image: 'hidden' | 'hero' | 'standard' | 'thumbnail';
  layout: ServiceMenuLayout;
}>;

const SERVICE_MENU_PRESENTATIONS: Record<ServiceMenuLayout, ServiceMenuPresentation> = {
  visual_grid: {
    layout: 'visual_grid',
    columns: 2,
    grouped: false,
    image: 'standard',
    description: 'clamped',
  },
  clean_list: {
    layout: 'clean_list',
    columns: 1,
    grouped: false,
    image: 'thumbnail',
    description: 'hidden',
  },
  editorial_cards: {
    layout: 'editorial_cards',
    columns: 1,
    grouped: false,
    image: 'hero',
    description: 'editorial',
  },
  category_menu: {
    layout: 'category_menu',
    columns: 1,
    grouped: true,
    image: 'thumbnail',
    description: 'hidden',
  },
  editorial_price_list: {
    layout: 'editorial_price_list',
    columns: 1,
    grouped: false,
    image: 'hidden',
    description: 'hidden',
  },
};

const SERVICE_MENU_LAYOUT_SET: ReadonlySet<string> = new Set(SERVICE_MENU_LAYOUTS);

/** Safe public-render fallback for missing, legacy, or corrupt stored values. */
export function resolveServiceMenuLayout(value: unknown): ServiceMenuLayout {
  return typeof value === 'string' && SERVICE_MENU_LAYOUT_SET.has(value)
    ? value as ServiceMenuLayout
    : DEFAULT_SERVICE_MENU_LAYOUT;
}

export function resolveServiceMenuPresentation(value: unknown): ServiceMenuPresentation {
  return SERVICE_MENU_PRESENTATIONS[resolveServiceMenuLayout(value)];
}
