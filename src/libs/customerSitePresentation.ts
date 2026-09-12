/**
 * The free customer-site appearance selected during onboarding.
 *
 * This is intentionally separate from BookingPageConfig's premium
 * `stylePack` / `tokenOverrides` seam. These values describe the site the
 * owner already previewed before creating an account, so persisting and
 * rendering them is parity—not an entitlement upgrade.
 */
export const CUSTOMER_SITE_STYLE_PRESETS = [
  'modern',
  'editorial',
  'soft',
  'minimal',
  'bold',
  'luxury',
] as const;

export type CustomerSiteStylePreset = (typeof CUSTOMER_SITE_STYLE_PRESETS)[number];

export const CUSTOMER_SITE_PALETTE_PRESETS = [
  'luster_berry',
  'blush_cocoa',
  'terracotta_cream',
  'sage_stone',
  'lilac_plum',
  'navy_ivory',
  'monochrome',
  'black_champagne',
] as const;

export type CustomerSitePalettePreset = (typeof CUSTOMER_SITE_PALETTE_PRESETS)[number];

export const DEFAULT_CUSTOMER_SITE_STYLE_PRESET: CustomerSiteStylePreset = 'modern';
export const DEFAULT_CUSTOMER_SITE_PALETTE_PRESET: CustomerSitePalettePreset
  = 'luster_berry';

type CustomerSiteStyleRoles = Readonly<{
  bodyFont: string;
  buttonRadius: string;
  cardRadius: string;
  headingFont: string;
  /**
   * A family alone did not separate six styles: the renderer asked for the
   * same weight, tracking and leading whichever preset was active, so two
   * different faces still arrived with identical colour and rhythm. These
   * three carry the rest of each personality. Their fallbacks in the renderer
   * reproduce the values it hard-coded before, so a salon that has never
   * chosen a style renders exactly as it does today.
   */
  headingWeight: string;
  headingTracking: string;
  headingLeading: string;
}>;

type CustomerSitePaletteRoles = Readonly<{
  accent: string;
  button: string;
  buttonText: string;
  focusRing: string;
  ground: string;
  ink: string;
  line: string;
  muted: string;
  secondaryAccent: string;
  surface: string;
}>;

const STYLE_PRESET_SET: ReadonlySet<string> = new Set(CUSTOMER_SITE_STYLE_PRESETS);
const PALETTE_PRESET_SET: ReadonlySet<string> = new Set(CUSTOMER_SITE_PALETTE_PRESETS);

/**
 * Body copy stays one neutral sans for every preset. Addresses, hours, prices,
 * durations, policies and every booking control are operational text, and a
 * display face would cost readability for no personality gain — the six read
 * as six because of what happens to the headings.
 */
const CUSTOMER_SITE_BODY_FONT
  = 'var(--font-luster-sans), Inter, ui-sans-serif, system-ui, sans-serif';

/**
 * Exported so the onboarding preview can spend the same typefaces rather than
 * keeping a second copy of them. It kept its own table, which is how the six
 * styles ended up genuinely distinct on the published page while still looking
 * near-identical in setup.
 */
export const CUSTOMER_SITE_STYLE_ROLES: Record<CustomerSiteStylePreset, CustomerSiteStyleRoles> = {
  // Heavy grotesque. Replaces Arial Black, which was a system font the page
  // never loaded and which is absent on most Android devices. Impact comes
  // from weight and tight tracking, not from capitals: a 40-character brand
  // set in all-caps across three lines is harder to read, not bolder.
  bold: {
    bodyFont: CUSTOMER_SITE_BODY_FONT,
    buttonRadius: '4px',
    cardRadius: '0px',
    headingFont: 'var(--font-luster-bold), Archivo, Inter, ui-sans-serif, sans-serif',
    headingWeight: '800',
    headingTracking: '-0.022em',
    headingLeading: '1.04',
  },
  // Editorial serif at moderate contrast: magazine, not couture. Kept at a
  // near-neutral tracking so long brand names stay comfortable.
  editorial: {
    bodyFont: CUSTOMER_SITE_BODY_FONT,
    buttonRadius: '2px',
    cardRadius: '4px',
    headingFont: 'var(--font-luster-editorial), Newsreader, Georgia, \'Times New Roman\', serif',
    headingWeight: '600',
    headingTracking: '-0.004em',
    headingLeading: '1.12',
  },
  // High-contrast display serif, the most formal of the six. Separated from
  // editorial by contrast and by open tracking rather than by size, so it
  // gains presence without growing the header.
  luxury: {
    bodyFont: CUSTOMER_SITE_BODY_FONT,
    buttonRadius: '2px',
    cardRadius: '10px',
    headingFont: 'var(--font-luster-luxury), \'Playfair Display\', Georgia, serif',
    headingWeight: '500',
    headingTracking: '0.012em',
    headingLeading: '1.06',
  },
  // The one preset whose typography should go unnoticed: the body face doing
  // double duty, a step down in weight, and neutral tracking.
  minimal: {
    bodyFont: CUSTOMER_SITE_BODY_FONT,
    buttonRadius: '6px',
    cardRadius: '10px',
    headingFont: CUSTOMER_SITE_BODY_FONT,
    headingWeight: '500',
    headingTracking: '0.004em',
    headingLeading: '1.24',
  },
  // Contemporary geometric sans. Tight tracking and short leading keep it
  // crisp, which is what separates it from soft's rounder, airier setting.
  modern: {
    bodyFont: CUSTOMER_SITE_BODY_FONT,
    buttonRadius: '16px',
    cardRadius: '24px',
    headingFont: 'var(--font-luster-modern), Outfit, Inter, ui-sans-serif, sans-serif',
    headingWeight: '600',
    headingTracking: '-0.026em',
    headingLeading: '1.08',
  },
  // Rounded humanist sans, set lighter and more openly than modern. Warm
  // without the bubble-lettering that would read as juvenile.
  soft: {
    bodyFont: CUSTOMER_SITE_BODY_FONT,
    buttonRadius: '999px',
    cardRadius: '32px',
    headingFont: 'var(--font-luster-soft), Nunito, Inter, ui-sans-serif, sans-serif',
    headingWeight: '600',
    headingTracking: '0.014em',
    headingLeading: '1.26',
  },
};

const CUSTOMER_SITE_PALETTE_ROLES: Record<
  CustomerSitePalettePreset,
  CustomerSitePaletteRoles
> = {
  black_champagne: {
    accent: '#e1c27e',
    button: '#e1c27e',
    buttonText: '#211a16',
    focusRing: '#f3d99f',
    ground: '#151315',
    ink: '#fff7e8',
    line: '#51484a',
    muted: '#c9bab0',
    secondaryAccent: '#6e294f',
    surface: '#221e20',
  },
  blush_cocoa: {
    accent: '#914863',
    button: '#744052',
    buttonText: '#ffffff',
    focusRing: '#6843b0',
    ground: '#fff2f4',
    ink: '#452f35',
    line: '#e6cfd5',
    muted: '#755f65',
    secondaryAccent: '#d8a5ae',
    surface: '#fffafb',
  },
  lilac_plum: {
    accent: '#70427b',
    button: '#70427b',
    buttonText: '#ffffff',
    focusRing: '#424fbd',
    ground: '#f7f1fa',
    ink: '#39293f',
    line: '#ded0e4',
    muted: '#6f6075',
    secondaryAccent: '#b79ac7',
    surface: '#fefbff',
  },
  luster_berry: {
    accent: '#8f3155',
    button: '#8f3155',
    buttonText: '#ffffff',
    focusRing: '#6544b8',
    ground: '#fbf5f1',
    ink: '#30262a',
    line: '#dfd1d4',
    muted: '#706267',
    secondaryAccent: '#d8a4b6',
    surface: '#fffdfb',
  },
  monochrome: {
    accent: '#262626',
    button: '#202020',
    buttonText: '#ffffff',
    focusRing: '#6648b8',
    ground: '#f5f5f3',
    ink: '#202020',
    line: '#d1d1ce',
    muted: '#666663',
    secondaryAccent: '#a8a8a3',
    surface: '#ffffff',
  },
  navy_ivory: {
    accent: '#294d73',
    button: '#294d73',
    buttonText: '#ffffff',
    focusRing: '#7650b8',
    ground: '#faf7ef',
    ink: '#1d2c41',
    line: '#d5d4ce',
    muted: '#647083',
    secondaryAccent: '#8da4bc',
    surface: '#fffdf7',
  },
  sage_stone: {
    accent: '#2f6352',
    button: '#2f6352',
    buttonText: '#ffffff',
    focusRing: '#6544b8',
    ground: '#f1f4ee',
    ink: '#26372f',
    line: '#ced8d0',
    muted: '#607067',
    secondaryAccent: '#91aa97',
    surface: '#fbfdfa',
  },
  terracotta_cream: {
    accent: '#9b432f',
    button: '#913c2b',
    buttonText: '#ffffff',
    focusRing: '#5a49b8',
    ground: '#fbf1e5',
    ink: '#382923',
    line: '#dfcdbc',
    muted: '#756359',
    secondaryAccent: '#d99d71',
    surface: '#fffaf3',
  },
};

export function resolveCustomerSiteStylePreset(
  value: unknown,
): CustomerSiteStylePreset {
  return typeof value === 'string' && STYLE_PRESET_SET.has(value)
    ? value as CustomerSiteStylePreset
    : DEFAULT_CUSTOMER_SITE_STYLE_PRESET;
}

export function resolveCustomerSitePalettePreset(
  value: unknown,
): CustomerSitePalettePreset {
  return typeof value === 'string' && PALETTE_PRESET_SET.has(value)
    ? value as CustomerSitePalettePreset
    : DEFAULT_CUSTOMER_SITE_PALETTE_PRESET;
}

/** CSS variables consumed only inside the customer booking surface. */
export function getCustomerSitePresentationCssVariables(input: {
  palettePreset: unknown;
  stylePreset: unknown;
}): Record<string, string> {
  const palette = CUSTOMER_SITE_PALETTE_ROLES[
    resolveCustomerSitePalettePreset(input.palettePreset)
  ];
  const style = CUSTOMER_SITE_STYLE_ROLES[
    resolveCustomerSiteStylePreset(input.stylePreset)
  ];

  return {
    '--booking-brand-foreground': palette.buttonText,
    '--booking-brand-primary': palette.button,
    '--booking-brand-selection-background': palette.surface,
    '--booking-brand-state-border': palette.accent,
    '--booking-summary-background': palette.button,
    '--booking-summary-foreground': palette.buttonText,
    '--booking-summary-detail': palette.buttonText,
    '--booking-today-background': palette.surface,
    '--booking-today-foreground': palette.accent,
    '--booking-today-ring': `inset 0 0 0 1px ${palette.accent}`,
    '--customer-site-body-font': style.bodyFont,
    '--customer-site-button-radius': style.buttonRadius,
    '--customer-site-card-radius': style.cardRadius,
    '--customer-site-heading-font': style.headingFont,
    '--customer-site-heading-leading': style.headingLeading,
    '--customer-site-heading-tracking': style.headingTracking,
    '--customer-site-heading-weight': style.headingWeight,
    '--customer-site-ink': palette.ink,
    '--customer-site-muted': palette.muted,
    // Confirmation and receipt components still consume n5 tokens. Both token
    // families must come from this same palette, not a second theme registry.
    '--n5-bg-page': palette.ground,
    '--n5-bg-card': palette.surface,
    '--n5-bg-surface': palette.surface,
    '--n5-bg-highlight': palette.surface,
    '--n5-bg-selected': palette.surface,
    '--n5-ink-main': palette.ink,
    '--n5-ink-muted': palette.muted,
    '--n5-ink-inverse': palette.buttonText,
    '--n5-accent': palette.button,
    '--n5-accent-soft': palette.surface,
    '--n5-accent-hover': palette.accent,
    '--n5-border': palette.line,
    '--n5-border-muted': palette.line,
    '--n5-border-accent': palette.accent,
    '--n5-button-primary-bg': palette.button,
    '--n5-button-primary-text': palette.buttonText,
    '--n5-button-secondary-bg': palette.surface,
    '--n5-button-secondary-text': palette.ink,
    '--n5-button-ghost-text': palette.muted,
    '--n5-font-heading': style.headingFont,
    '--n5-font-body': style.bodyFont,
    '--theme-accent': palette.accent,
    '--theme-accent-light': palette.muted,
    '--theme-background': palette.ground,
    '--theme-border-muted': palette.line,
    '--theme-card-background': palette.surface,
    '--theme-card-border': palette.line,
    '--theme-highlight-background': palette.surface,
    '--theme-input-background': palette.surface,
    '--theme-primary': palette.button,
    '--theme-primary-dark': palette.accent,
    '--theme-primary-light': palette.secondaryAccent,
    '--theme-selected-background': palette.surface,
    '--theme-selected-ring': palette.focusRing,
    '--theme-surface-alt': palette.surface,
    '--theme-taupe': palette.muted,
    '--theme-title-text': palette.ink,
  };
}
