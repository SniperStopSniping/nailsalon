import { deepFreeze } from './data';
import {
  BOOKING_MENU_LAYOUTS,
  type BookingLayoutMemory,
  type BookingMenuLayout,
  type BookingPresentationTokens,
  type BookingPresentationValidationResult,
  type BookingSectionPresentationSettings,
  type LayoutSettingsByLayout,
} from './types';

export const DEFAULT_LAYOUT_SETTINGS = deepFreeze<LayoutSettingsByLayout>({
  visual_grid: {
    density: 'comfortable',
    imageMode: 'auto',
    showFeatured: true,
    categoryNavigation: 'pills',
    showDescriptions: false,
  },
  clean_list: {
    density: 'compact',
    showThumbnails: false,
    showDescriptions: true,
    categoryNavigation: 'pills',
  },
  editorial_cards: {
    density: 'comfortable',
    imageShape: 'landscape',
    descriptionLength: 'full',
    featuredTreatment: 'large',
  },
  category_menu: {
    density: 'comfortable',
    mobileNavigation: 'tabs',
    desktopNavigation: 'sidebar',
    showDescriptions: true,
    showCategoryCounts: true,
  },
  editorial_price_list: {
    density: 'spacious',
    showCategoryImages: false,
    descriptionLength: 'full',
    dividerStyle: 'fine',
  },
});

/**
 * V1 starter sites use one catalogue inside the canonical Booking engine.
 * Advanced/audit documents can still opt into the legacy featured rail, but
 * the normal starter path removes that duplicate presentation centrally.
 */
export const withoutFeaturedServicesRail = (
  settings: BookingSectionPresentationSettings,
): BookingSectionPresentationSettings => settings.layout === 'visual_grid'
  ? {
      ...settings,
      layoutSettings: { ...settings.layoutSettings, showFeatured: false },
    }
  : settings;

export const BOOKING_TOKEN_PRESETS = deepFreeze<
  Record<'warm' | 'neutral', BookingPresentationTokens>
>({
  warm: {
    background: '#fdf7f0',
    surface: '#faf4ec',
    card: '#ffffff',
    selected: '#f5ede5',
    text: '#2f2521',
    mutedText: '#6f625c',
    border: '#eadfd7',
    accent: '#6f2745',
    accentStrong: '#4c1d2e',
    accentContrast: '#ffffff',
    highlight: '#d6a34a',
    focus: '#c9547e',
    headingFamily: 'Georgia, \'Times New Roman\', serif',
    bodyFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif',
    radiusControl: '999px',
    radiusDialog: '26px',
    spacingScale: '4px',
  },
  neutral: {
    background: '#f5f5f3',
    surface: '#eeeeeb',
    card: '#ffffff',
    selected: '#e8e8e4',
    text: '#252522',
    mutedText: '#686864',
    border: '#d8d8d2',
    accent: '#3f4b4a',
    accentStrong: '#293332',
    accentContrast: '#ffffff',
    highlight: '#8d7c55',
    focus: '#526d6a',
    headingFamily: 'Georgia, \'Times New Roman\', serif',
    bodyFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif',
    radiusControl: '999px',
    radiusDialog: '20px',
    spacingScale: '4px',
  },
});

const cloneLayoutSettings = <Layout extends BookingMenuLayout>(
  _layout: Layout,
  settings: LayoutSettingsByLayout[Layout],
): LayoutSettingsByLayout[Layout] => ({ ...settings });

const createDefaultMemory = (): BookingLayoutMemory => ({
  visual_grid: cloneLayoutSettings('visual_grid', DEFAULT_LAYOUT_SETTINGS.visual_grid),
  clean_list: cloneLayoutSettings('clean_list', DEFAULT_LAYOUT_SETTINGS.clean_list),
  editorial_cards: cloneLayoutSettings('editorial_cards', DEFAULT_LAYOUT_SETTINGS.editorial_cards),
  category_menu: cloneLayoutSettings('category_menu', DEFAULT_LAYOUT_SETTINGS.category_menu),
  editorial_price_list: cloneLayoutSettings(
    'editorial_price_list',
    DEFAULT_LAYOUT_SETTINGS.editorial_price_list,
  ),
});

export const DEFAULT_BOOKING_PRESENTATION_SETTINGS = deepFreeze<
  BookingSectionPresentationSettings
>({
  version: 1,
  layout: 'visual_grid',
  typographyPreset: 'modern',
  headingScale: 'standard',
  bodyScale: 'standard',
  spacing: 'comfortable',
  layoutSettings: DEFAULT_LAYOUT_SETTINGS.visual_grid,
  layoutMemory: createDefaultMemory(),
});

export function createDefaultBookingPresentationSettings(): BookingSectionPresentationSettings {
  return {
    version: 1,
    layout: 'visual_grid',
    typographyPreset: 'modern',
    headingScale: 'standard',
    bodyScale: 'standard',
    spacing: 'comfortable',
    layoutSettings: cloneLayoutSettings(
      'visual_grid',
      DEFAULT_LAYOUT_SETTINGS.visual_grid,
    ),
    layoutMemory: createDefaultMemory(),
  };
}

export function getLayoutSettings<Layout extends BookingMenuLayout>(
  settings: BookingSectionPresentationSettings,
  layout: Layout,
): LayoutSettingsByLayout[Layout] {
  if (settings.layout === layout) {
    return settings.layoutSettings as LayoutSettingsByLayout[Layout];
  }
  return settings.layoutMemory?.[layout]
    ?? DEFAULT_LAYOUT_SETTINGS[layout];
}

function buildSettingsForLayout<Layout extends BookingMenuLayout>(
  settings: BookingSectionPresentationSettings,
  layout: Layout,
  layoutSettings: LayoutSettingsByLayout[Layout],
  layoutMemory?: BookingLayoutMemory,
): BookingSectionPresentationSettings {
  const common = {
    version: 1 as const,
    typographyPreset: settings.typographyPreset,
    headingScale: settings.headingScale,
    bodyScale: settings.bodyScale,
    spacing: settings.spacing,
    ...(layoutMemory === undefined ? {} : { layoutMemory }),
  };

  switch (layout) {
    case 'visual_grid':
      return { ...common, layout, layoutSettings: layoutSettings as LayoutSettingsByLayout['visual_grid'] };
    case 'clean_list':
      return { ...common, layout, layoutSettings: layoutSettings as LayoutSettingsByLayout['clean_list'] };
    case 'editorial_cards':
      return { ...common, layout, layoutSettings: layoutSettings as LayoutSettingsByLayout['editorial_cards'] };
    case 'category_menu':
      return { ...common, layout, layoutSettings: layoutSettings as LayoutSettingsByLayout['category_menu'] };
    case 'editorial_price_list':
      return { ...common, layout, layoutSettings: layoutSettings as LayoutSettingsByLayout['editorial_price_list'] };
    default:
      throw new Error('Unsupported Booking layout.');
  }
}

export function switchBookingLayout(
  settings: BookingSectionPresentationSettings,
  layout: BookingMenuLayout,
): BookingSectionPresentationSettings {
  if (layout === settings.layout) {
    return settings;
  }

  const layoutMemory: BookingLayoutMemory = {
    ...settings.layoutMemory,
    [settings.layout]: { ...settings.layoutSettings },
  };
  const remembered = getLayoutSettings(settings, layout);
  return buildSettingsForLayout(
    settings,
    layout,
    cloneLayoutSettings(layout, remembered),
    layoutMemory,
  );
}

export function replaceActiveLayoutSettings<Layout extends BookingMenuLayout>(
  settings: Extract<BookingSectionPresentationSettings, { layout: Layout }>,
  layoutSettings: LayoutSettingsByLayout[Layout],
): Extract<BookingSectionPresentationSettings, { layout: Layout }> {
  return {
    ...settings,
    layoutSettings: { ...layoutSettings },
    layoutMemory: {
      ...settings.layoutMemory,
      [settings.layout]: { ...layoutSettings },
    },
  } as Extract<BookingSectionPresentationSettings, { layout: Layout }>;
}

const ROOT_KEYS = new Set([
  'version',
  'layout',
  'typographyPreset',
  'headingScale',
  'bodyScale',
  'spacing',
  'layoutSettings',
  'layoutMemory',
]);

const LAYOUT_KEYS: Record<BookingMenuLayout, ReadonlySet<string>> = {
  visual_grid: new Set([
    'density',
    'imageMode',
    'showFeatured',
    'categoryNavigation',
    'showDescriptions',
  ]),
  clean_list: new Set([
    'density',
    'showThumbnails',
    'showDescriptions',
    'categoryNavigation',
  ]),
  editorial_cards: new Set([
    'density',
    'imageShape',
    'descriptionLength',
    'featuredTreatment',
  ]),
  category_menu: new Set([
    'density',
    'mobileNavigation',
    'desktopNavigation',
    'showDescriptions',
    'showCategoryCounts',
  ]),
  editorial_price_list: new Set([
    'density',
    'showCategoryImages',
    'descriptionLength',
    'dividerStyle',
  ]),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOneOf = <Value extends string>(
  value: unknown,
  options: readonly Value[],
): value is Value => typeof value === 'string' && options.includes(value as Value);

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(`${path}.${key} is not a supported setting.`);
    }
  }
}

function expectBoolean(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): boolean {
  if (typeof value[key] !== 'boolean') {
    issues.push(`${path}.${key} must be a boolean.`);
    return false;
  }
  return value[key] as boolean;
}

function expectEnum<Value extends string>(
  value: Record<string, unknown>,
  key: string,
  options: readonly Value[],
  path: string,
  issues: string[],
): Value {
  if (!isOneOf(value[key], options)) {
    issues.push(`${path}.${key} must be one of: ${options.join(', ')}.`);
    return options[0] as Value;
  }
  return value[key];
}

function parseLayoutSettings<Layout extends BookingMenuLayout>(
  input: unknown,
  layout: Layout,
  path: string,
  issues: string[],
): LayoutSettingsByLayout[Layout] | null {
  if (!isRecord(input)) {
    issues.push(`${path} must be an object for ${layout}.`);
    return null;
  }
  rejectUnknownKeys(input, LAYOUT_KEYS[layout], path, issues);

  switch (layout) {
    case 'visual_grid':
      return {
        density: expectEnum(input, 'density', ['compact', 'comfortable', 'spacious'], path, issues),
        imageMode: expectEnum(input, 'imageMode', ['auto', 'show', 'hide'], path, issues),
        showFeatured: expectBoolean(input, 'showFeatured', path, issues),
        categoryNavigation: expectEnum(input, 'categoryNavigation', ['pills', 'none'], path, issues),
        showDescriptions: expectBoolean(input, 'showDescriptions', path, issues),
      } as LayoutSettingsByLayout[Layout];
    case 'clean_list':
      return {
        density: expectEnum(input, 'density', ['compact', 'comfortable'], path, issues),
        showThumbnails: expectBoolean(input, 'showThumbnails', path, issues),
        showDescriptions: expectBoolean(input, 'showDescriptions', path, issues),
        categoryNavigation: expectEnum(input, 'categoryNavigation', ['pills', 'none'], path, issues),
      } as LayoutSettingsByLayout[Layout];
    case 'editorial_cards':
      return {
        density: expectEnum(input, 'density', ['comfortable', 'spacious'], path, issues),
        imageShape: expectEnum(input, 'imageShape', ['landscape', 'portrait', 'adaptive'], path, issues),
        descriptionLength: expectEnum(input, 'descriptionLength', ['short', 'full'], path, issues),
        featuredTreatment: expectEnum(input, 'featuredTreatment', ['standard', 'large'], path, issues),
      } as LayoutSettingsByLayout[Layout];
    case 'category_menu':
      return {
        density: expectEnum(input, 'density', ['compact', 'comfortable'], path, issues),
        mobileNavigation: expectEnum(input, 'mobileNavigation', ['pills', 'tabs', 'accordion'], path, issues),
        desktopNavigation: expectEnum(input, 'desktopNavigation', ['sidebar', 'top'], path, issues),
        showDescriptions: expectBoolean(input, 'showDescriptions', path, issues),
        showCategoryCounts: expectBoolean(input, 'showCategoryCounts', path, issues),
      } as LayoutSettingsByLayout[Layout];
    case 'editorial_price_list':
      return {
        density: expectEnum(input, 'density', ['comfortable', 'spacious'], path, issues),
        showCategoryImages: expectBoolean(input, 'showCategoryImages', path, issues),
        descriptionLength: expectEnum(input, 'descriptionLength', ['short', 'full'], path, issues),
        dividerStyle: expectEnum(input, 'dividerStyle', ['fine', 'strong', 'none'], path, issues),
      } as LayoutSettingsByLayout[Layout];
    default:
      throw new Error('Unsupported Booking layout.');
  }
}

export function validateBookingPresentationSettings(
  input: unknown,
): BookingPresentationValidationResult {
  const issues: string[] = [];
  if (!isRecord(input)) {
    return { success: false, issues: ['Booking presentation settings must be an object.'] };
  }
  rejectUnknownKeys(input, ROOT_KEYS, 'booking', issues);

  if (input.version !== 1) {
    issues.push('booking.version must be 1.');
  }
  const layout = isOneOf(input.layout, BOOKING_MENU_LAYOUTS)
    ? input.layout
    : null;
  if (!layout) {
    issues.push(`booking.layout must be one of: ${BOOKING_MENU_LAYOUTS.join(', ')}.`);
  }
  const typographyPreset = expectEnum(
    input,
    'typographyPreset',
    ['modern', 'editorial', 'soft', 'bold', 'classic'],
    'booking',
    issues,
  );
  const headingScale = expectEnum(
    input,
    'headingScale',
    ['small', 'standard', 'large'],
    'booking',
    issues,
  );
  const bodyScale = expectEnum(
    input,
    'bodyScale',
    ['standard', 'large'],
    'booking',
    issues,
  );
  const spacing = expectEnum(
    input,
    'spacing',
    ['compact', 'comfortable', 'spacious'],
    'booking',
    issues,
  );
  const layoutSettings = layout
    ? parseLayoutSettings(input.layoutSettings, layout, 'booking.layoutSettings', issues)
    : null;

  const layoutMemory: BookingLayoutMemory = {};
  if (input.layoutMemory !== undefined) {
    if (!isRecord(input.layoutMemory)) {
      issues.push('booking.layoutMemory must be an object when provided.');
    } else {
      rejectUnknownKeys(
        input.layoutMemory,
        new Set(BOOKING_MENU_LAYOUTS),
        'booking.layoutMemory',
        issues,
      );
      for (const memoryLayout of BOOKING_MENU_LAYOUTS) {
        const remembered = input.layoutMemory[memoryLayout];
        if (remembered !== undefined) {
          const parsed = parseLayoutSettings(
            remembered,
            memoryLayout,
            `booking.layoutMemory.${memoryLayout}`,
            issues,
          );
          if (parsed) {
            Object.assign(layoutMemory, { [memoryLayout]: parsed });
          }
        }
      }
    }
  }

  if (issues.length > 0 || !layout || !layoutSettings) {
    return { success: false, issues };
  }

  const common = {
    version: 1 as const,
    typographyPreset,
    headingScale,
    bodyScale,
    spacing,
    ...(input.layoutMemory === undefined ? {} : { layoutMemory }),
  };
  const template = createDefaultBookingPresentationSettings();
  const settings = buildSettingsForLayout(
    { ...template, ...common },
    layout,
    layoutSettings,
    input.layoutMemory === undefined ? undefined : layoutMemory,
  );
  return { success: true, settings };
}

export function parseBookingPresentationSettings(
  input: unknown,
): BookingSectionPresentationSettings | null {
  const result = validateBookingPresentationSettings(input);
  return result.success ? result.settings : null;
}

export function bookingTokenStyles(
  preset: 'warm' | 'neutral',
): Record<`--booking-${string}`, string> {
  const tokens = BOOKING_TOKEN_PRESETS[preset];
  return {
    '--booking-background': tokens.background,
    '--booking-surface': tokens.surface,
    '--booking-card': tokens.card,
    '--booking-selected': tokens.selected,
    '--booking-text': tokens.text,
    '--booking-muted': tokens.mutedText,
    '--booking-border': tokens.border,
    '--booking-accent': tokens.accent,
    '--booking-accent-strong': tokens.accentStrong,
    '--booking-accent-contrast': tokens.accentContrast,
    '--booking-highlight': tokens.highlight,
    '--booking-focus': tokens.focus,
    '--booking-heading-family': tokens.headingFamily,
    '--booking-body-family': tokens.bodyFamily,
    '--booking-radius-control': tokens.radiusControl,
    '--booking-radius-dialog': tokens.radiusDialog,
    '--booking-space-unit': tokens.spacingScale,
  };
}
