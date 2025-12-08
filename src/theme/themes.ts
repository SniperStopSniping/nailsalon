/**
 * Theme Definitions
 *
 * This module contains all available themes for the multi-tenant platform.
 * Currently contains the default "Nail Salon No.5" theme.
 *
 * Future themes will be added here and registered in the `themes` object.
 * Each salon's themeKey in the database will map to a key in this registry.
 */

import type { EspressoTheme, EspressoTokens, Theme, ThemeRegistry } from './theme.types';

/**
 * Nail Salon No.5 Theme
 *
 * The default luxury spa aesthetic with warm golds and purple accents.
 * This is the original brand identity for the platform.
 */
export const nailSalonNo5Theme: Theme = {
  key: 'nail-salon-no5',
  name: 'Nail Salon No.5',
  colors: {
    // Brand colors
    primary: '#f4b864', // Main gold
    primaryDark: '#d6a249', // Dark gold (selected states, rings)
    primaryLight: '#FBC02D', // Light gold for gradients
    accent: '#7b4ea3', // Purple (titles)
    accentLight: '#9b6dc6', // Light purple (gradients)

    // Backgrounds
    background: '#f6ebdd', // Warm beige page background
    cardBackground: '#ffffff', // White cards
    surfaceAlt: '#fff7ec', // Alternative surface for cards/hovers
    selectedBackground: '#f5e6d3', // Selected card background
    accentSelected: '#e9d5f5', // Purple selected state background
    inputBackground: '#fafaf9', // Input fields (neutral-50)
    highlightBackground: '#fef9e7', // Points/discount highlight

    // Borders
    cardBorder: '#e6d6c2', // Warm beige card border
    borderMuted: '#d9c6aa', // Muted border for pending/inactive states
    selectedRing: '#d6a249', // Gold selection ring

    // Text
    titleText: '#7b4ea3', // Purple page titles

    // Premium Glass Theme - Additional semantic colors
    // (Using theme-appropriate values for this theme)
    espresso: '#5C4037', // Warm brown for primary text
    taupe: '#8A7E78', // Secondary text
    cream: '#fff7ec', // Soft cream (same as surfaceAlt)
    peach: '#f5e6d3', // Soft peach (same as selectedBackground)
    streakOrange: '#FF9500', // Streak flame color
    successGreen: '#34C759', // Check/success state
  },
};

/**
 * Premium Glass Theme
 *
 * iOS-inspired glassmorphism aesthetic with espresso browns and gold accents.
 * Features warm ivory backgrounds with peach/cream highlights.
 */
export const premiumGlassTheme: Theme = {
  key: 'premium-glass',
  name: 'Premium Glass',
  colors: {
    // Brand colors
    primary: '#D6A249', // Rich gold
    primaryDark: '#C5933E', // Darker gold (selected states, rings)
    primaryLight: '#FBC02D', // Light gold for gradients
    accent: '#3F2B24', // Espresso brown (primary text)
    accentLight: '#5C4A44', // Lighter brown

    // Backgrounds
    background: '#FDF7F0', // Ivory page background
    cardBackground: '#ffffff', // White cards
    surfaceAlt: '#FFF8E1', // Cream surface for cards/hovers
    selectedBackground: '#F5EDE5', // Selected card background
    accentSelected: '#FFE0B2', // Peach selected state background
    inputBackground: '#fafaf9', // Input fields (neutral-50)
    highlightBackground: '#FFF8E1', // Cream highlight

    // Borders
    cardBorder: '#F0E6DE', // Warm card border
    borderMuted: '#E8DED6', // Muted border for pending/inactive states
    selectedRing: '#D6A249', // Gold selection ring

    // Text
    titleText: '#8A7E78', // Taupe secondary text

    // Premium Glass Theme - Additional semantic colors
    espresso: '#3F2B24', // Primary text (espresso brown)
    taupe: '#8A7E78', // Secondary text
    cream: '#FFF8E1', // Soft cream accents
    peach: '#FFE0B2', // Soft peach accents
    streakOrange: '#FF9500', // Streak flame color
    successGreen: '#34C759', // Check/success state
  },
};

/**
 * Luxury Rewards Theme
 *
 * Exact match for the original RewardsPage design.
 * Espresso brown primary text, rich gold accents, warm ivory backgrounds.
 * This theme replicates the original hardcoded color palette pixel-perfect.
 */
export const luxuryRewardsTheme: Theme = {
  key: 'luxury-rewards',
  name: 'Luxury Rewards',
  colors: {
    // Brand colors - exact from original design
    primary: '#D6A249', // Rich gold (buttons, accents, progress bars)
    primaryDark: '#D6A249', // Same gold for consistency
    primaryLight: '#FBC02D', // Light gold for gradients
    accent: '#3F2B24', // Espresso brown (primary text color)
    accentLight: '#5D4037', // Lighter brown (decorative blur)

    // Backgrounds - exact from original design
    background: '#FDF7F0', // Ivory page background
    cardBackground: '#ffffff', // White cards
    surfaceAlt: '#FFF8E1', // Gold tier badge background
    selectedBackground: '#FAF4EC', // Icon circle background in reward cards
    accentSelected: '#F3E5F5', // Purple tier badge background
    inputBackground: '#F9F5F1', // Slider track background
    highlightBackground: '#E8F5E9', // Green tier badge background

    // Borders - exact from original design
    cardBorder: '#F0E6DE', // Icon circle border, sheet elements
    borderMuted: '#E5DDD5', // Drag handle, slider track border
    selectedRing: '#D6A249', // Gold selection ring

    // Text - exact from original design
    titleText: '#3F2B24', // Page titles (espresso)

    // Semantic colors - exact from original design
    espresso: '#3F2B24', // Primary text throughout
    taupe: '#8A7E78', // Secondary text, labels, subtitles
    cream: '#FDF7F0', // Card text on dark backgrounds
    peach: '#8D6E63', // Decorative blur accent
    streakOrange: '#FF9500', // Streak flame color
    successGreen: '#34C759', // Check/success state
  },
};

// ============================================================================
// ESPRESSO THEME - Complete Design Token System
// ============================================================================

/**
 * Espresso Theme
 *
 * Complete design token system extracted from Profile/Rewards pages.
 * Includes colors, typography, radii, shadows, spacing, and button tokens.
 *
 * Color palette:
 * - Primary text: Espresso brown (#3F2B24)
 * - Secondary text: Taupe (#8A7E78)
 * - Accent: Rich gold (#D6A249)
 * - Background: Warm ivory (#FDF7F0)
 */
export const espressoTheme: EspressoTheme = {
  key: 'espresso',
  name: 'Espresso',

  // ---------------------------------------------------------------------------
  // COLORS (17 tokens)
  // ---------------------------------------------------------------------------
  colors: {
    // Backgrounds
    bgPage: '#FDF7F0', // Ivory page background
    bgCard: '#ffffff', // White card backgrounds
    bgSurface: '#FAF4EC', // Surface for inputs, icon circles
    bgHighlight: '#FFF8E1', // Cream highlight backgrounds
    bgSelected: '#F5EDE5', // Selected state background

    // Ink (Text)
    inkMain: '#3F2B24', // Espresso brown - primary text
    inkMuted: '#8A7E78', // Taupe - secondary text, labels
    inkInverse: '#FDF7F0', // Light text on dark backgrounds

    // Accent
    accent: '#D6A249', // Rich gold - buttons, highlights, progress
    accentSoft: '#FFF8E1', // Light gold/cream for soft accents
    accentHover: '#C5933E', // Darker gold for hover states

    // Borders
    border: '#F0E6DE', // Card borders, dividers
    borderMuted: '#E5DDD5', // Subtle borders (drag handles, tracks)
    borderAccent: '#D6A249', // Gold accent borders

    // Semantic
    success: '#34C759', // Green - check marks, success states
    warning: '#FF9500', // Orange - streak flames
    error: '#EF4444', // Red - sign out button, error states
  },

  // ---------------------------------------------------------------------------
  // TYPOGRAPHY (2 tokens)
  // ---------------------------------------------------------------------------
  typography: {
    fontHeading: '\'Playfair Display\', Georgia, serif',
    fontBody: '\'Inter\', -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif',
  },

  // ---------------------------------------------------------------------------
  // RADII (6 tokens)
  // ---------------------------------------------------------------------------
  radii: {
    radiusCard: '2rem', // Large cards, wallet card, dock (32px)
    radiusSheet: '2.5rem', // Slide-up modal (40px)
    radiusMd: '1rem', // Medium elements (16px)
    radiusSm: '0.5rem', // Small elements (8px)
    radiusButton: '0.75rem', // Button corners (12px)
    radiusPill: '9999px', // Pills, badges, fully rounded
  },

  // ---------------------------------------------------------------------------
  // SHADOWS (5 tokens)
  // ---------------------------------------------------------------------------
  shadows: {
    shadowSm: '0 2px 8px -2px rgba(63, 43, 36, 0.1)', // Small cards, buttons
    shadowMd: '0 4px 20px -10px rgba(0, 0, 0, 0.05)', // Medium elevation
    shadowLg: '0 25px 50px -12px rgba(214, 162, 73, 0.25)', // Hero/wallet card (gold tint)
    shadowDock: '0 8px 30px rgba(63, 43, 36, 0.1)', // Floating dock navigation
    shadowModal: '0 -20px 60px -20px rgba(63, 43, 36, 0.2)', // Slide-up sheet
  },

  // ---------------------------------------------------------------------------
  // SPACING (6 tokens)
  // ---------------------------------------------------------------------------
  spacing: {
    spaceXs: '0.25rem', // Tiny gaps (4px)
    spaceSm: '0.5rem', // Small gaps (8px)
    spaceMd: '1rem', // Standard padding (16px)
    spaceLg: '1.5rem', // Card padding, section gaps (24px)
    spaceXl: '2rem', // Large section spacing (32px)
    space2xl: '3rem', // Page section dividers (48px)
  },

  // ---------------------------------------------------------------------------
  // BUTTONS (8 tokens)
  // ---------------------------------------------------------------------------
  buttons: {
    buttonPrimaryBg: '#D6A249', // Gold primary button background
    buttonPrimaryText: '#ffffff', // White text on primary buttons
    buttonSecondaryBg: '#ffffff', // White secondary button background
    buttonSecondaryText: '#3F2B24', // Espresso text on secondary buttons
    buttonGhostText: '#8A7E78', // Taupe text for ghost buttons
    buttonRadius: '0.75rem', // Button corner radius (12px)
    buttonPaddingX: '1.5rem', // Horizontal padding (24px)
    buttonPaddingY: '0.75rem', // Vertical padding (12px)
  },
};

// ============================================================================
// LAVENDER THEME - Complete Design Token System
// ============================================================================

/**
 * Lavender Theme
 *
 * Purple-based variant with the same 44-token structure as Espresso.
 * Cool lavender/violet palette for a softer, more romantic aesthetic.
 *
 * Color palette:
 * - Primary text: Deep purple (#4A3B5C)
 * - Secondary text: Dusty lavender (#8B7B98)
 * - Accent: Rich violet (#7B4EA3)
 * - Background: Soft lavender (#F8F5FC)
 */
export const lavenderTheme: EspressoTheme = {
  key: 'lavender',
  name: 'Lavender',

  // ---------------------------------------------------------------------------
  // 1. COLORS (17 tokens)
  // ---------------------------------------------------------------------------
  colors: {
    // Backgrounds
    bgPage: '#F8F5FC', // Soft lavender page background
    bgCard: '#ffffff', // White card backgrounds
    bgSurface: '#F3EEF8', // Light purple surface for inputs, icon circles
    bgHighlight: '#EDE7F6', // Soft violet highlight backgrounds
    bgSelected: '#E8E0F0', // Selected state background

    // Ink (Text)
    inkMain: '#4A3B5C', // Deep purple - primary text
    inkMuted: '#8B7B98', // Dusty lavender - secondary text, labels
    inkInverse: '#F8F5FC', // Light text on dark backgrounds

    // Accent
    accent: '#7B4EA3', // Rich violet - buttons, highlights, progress
    accentSoft: '#EDE7F6', // Light violet for soft accents
    accentHover: '#6A4190', // Darker violet for hover states

    // Borders
    border: '#E8E0F0', // Lavender card borders, dividers
    borderMuted: '#DDD5E8', // Subtle lavender borders
    borderAccent: '#7B4EA3', // Violet accent borders

    // Semantic
    success: '#34C759', // Green - check marks, success states
    warning: '#FF9500', // Orange - streak flames
    error: '#EF4444', // Red - sign out button, error states
  },

  // ---------------------------------------------------------------------------
  // 2. TYPOGRAPHY (2 tokens) - Same structure, same fonts
  // ---------------------------------------------------------------------------
  typography: {
    fontHeading: '\'Playfair Display\', Georgia, serif',
    fontBody: '\'Inter\', -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif',
  },

  // ---------------------------------------------------------------------------
  // 3. RADII (6 tokens) - Same structure, same values
  // ---------------------------------------------------------------------------
  radii: {
    radiusCard: '2rem', // Large cards, wallet card, dock (32px)
    radiusSheet: '2.5rem', // Slide-up modal (40px)
    radiusMd: '1rem', // Medium elements (16px)
    radiusSm: '0.5rem', // Small elements (8px)
    radiusButton: '0.75rem', // Button corners (12px)
    radiusPill: '9999px', // Pills, badges, fully rounded
  },

  // ---------------------------------------------------------------------------
  // 4. SHADOWS (5 tokens) - Purple-tinted rgba values
  // ---------------------------------------------------------------------------
  shadows: {
    shadowSm: '0 2px 8px -2px rgba(74, 59, 92, 0.1)', // Small cards, buttons (purple tint)
    shadowMd: '0 4px 20px -10px rgba(0, 0, 0, 0.05)', // Medium elevation (neutral)
    shadowLg: '0 25px 50px -12px rgba(123, 78, 163, 0.25)', // Hero/wallet card (violet tint)
    shadowDock: '0 8px 30px rgba(74, 59, 92, 0.1)', // Floating dock navigation (purple tint)
    shadowModal: '0 -20px 60px -20px rgba(74, 59, 92, 0.2)', // Slide-up sheet (purple tint)
  },

  // ---------------------------------------------------------------------------
  // 5. SPACING (6 tokens) - Same structure, same values
  // ---------------------------------------------------------------------------
  spacing: {
    spaceXs: '0.25rem', // Tiny gaps (4px)
    spaceSm: '0.5rem', // Small gaps (8px)
    spaceMd: '1rem', // Standard padding (16px)
    spaceLg: '1.5rem', // Card padding, section gaps (24px)
    spaceXl: '2rem', // Large section spacing (32px)
    space2xl: '3rem', // Page section dividers (48px)
  },

  // ---------------------------------------------------------------------------
  // 6. BUTTONS (8 tokens) - Purple color variants
  // ---------------------------------------------------------------------------
  buttons: {
    buttonPrimaryBg: '#7B4EA3', // Violet primary button background
    buttonPrimaryText: '#ffffff', // White text on primary buttons
    buttonSecondaryBg: '#ffffff', // White secondary button background
    buttonSecondaryText: '#4A3B5C', // Deep purple text on secondary buttons
    buttonGhostText: '#8B7B98', // Dusty lavender text for ghost buttons
    buttonRadius: '0.75rem', // Button corner radius (12px)
    buttonPaddingX: '1.5rem', // Horizontal padding (24px)
    buttonPaddingY: '0.75rem', // Vertical padding (12px)
  },
};

// ============================================================================
// PASTEL THEME - Complete Design Token System
// ============================================================================

/**
 * Pastel Theme
 *
 * Light, airy, feminine variant with warm ivory/gold/cream palette.
 * Soft pastel tones for a delicate, romantic aesthetic.
 *
 * Color palette:
 * - Primary text: Warm espresso brown (#3F2B24)
 * - Secondary text: Soft taupe (#8A7E78)
 * - Accent: Gold (#D6A249)
 * - Background: Soft ivory (#FDF7F0)
 * - Highlights: Cream (#FFF8E1) and Peach (#FFE0B2)
 */
export const pastelTheme: EspressoTheme = {
  key: 'pastel',
  name: 'Pastel',

  // ---------------------------------------------------------------------------
  // 1. COLORS (17 tokens)
  // ---------------------------------------------------------------------------
  colors: {
    // Backgrounds - soft ivory/cream
    bgPage: '#FDF7F0', // Soft ivory page background
    bgCard: '#ffffff', // Pure white card backgrounds
    bgSurface: '#FFF8E1', // Cream surface for inputs, icon circles
    bgHighlight: '#FFE0B2', // Soft peach highlight backgrounds
    bgSelected: '#F5EFE9', // Selected state background

    // Ink (Text) - warm browns
    inkMain: '#3F2B24', // Espresso - primary text
    inkMuted: '#8A7E78', // Taupe - secondary text, labels
    inkInverse: '#FDF7F0', // Light text on dark backgrounds

    // Accent - gold
    accent: '#D6A249', // Gold - buttons, highlights, progress
    accentSoft: '#FFF8E1', // Cream for soft accents
    accentHover: '#C5933E', // Darker gold for hover states

    // Borders
    border: '#F0E6DE', // Warm card borders, dividers
    borderMuted: '#E5DDD5', // Subtle warm borders
    borderAccent: '#D6A249', // Gold accent borders

    // Semantic
    success: '#34C759', // Green - check marks, success states
    warning: '#FF9500', // Orange - streak flames
    error: '#EF4444', // Red - sign out button, error states
  },

  // ---------------------------------------------------------------------------
  // 2. TYPOGRAPHY (2 tokens) - Same structure, same fonts
  // ---------------------------------------------------------------------------
  typography: {
    fontHeading: '\'Playfair Display\', Georgia, serif',
    fontBody: '\'Inter\', -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif',
  },

  // ---------------------------------------------------------------------------
  // 3. RADII (6 tokens) - Same structure, same values
  // ---------------------------------------------------------------------------
  radii: {
    radiusCard: '2rem', // Large cards, wallet card, dock (32px)
    radiusSheet: '2.5rem', // Slide-up modal (40px)
    radiusMd: '1rem', // Medium elements (16px)
    radiusSm: '0.5rem', // Small elements (8px)
    radiusButton: '0.75rem', // Button corners (12px)
    radiusPill: '9999px', // Pills, badges, fully rounded
  },

  // ---------------------------------------------------------------------------
  // 4. SHADOWS (5 tokens) - Gold-tinted rgba values for warm feel
  // ---------------------------------------------------------------------------
  shadows: {
    shadowSm: '0 2px 8px -2px rgba(214, 162, 73, 0.1)', // Small cards, buttons (gold tint)
    shadowMd: '0 4px 20px -10px rgba(0, 0, 0, 0.05)', // Medium elevation (neutral)
    shadowLg: '0 25px 50px -12px rgba(214, 162, 73, 0.25)', // Hero/wallet card (gold tint)
    shadowDock: '0 8px 30px rgba(214, 162, 73, 0.1)', // Floating dock navigation (gold tint)
    shadowModal: '0 -20px 60px -20px rgba(63, 43, 36, 0.15)', // Slide-up sheet (warm tint)
  },

  // ---------------------------------------------------------------------------
  // 5. SPACING (6 tokens) - Same structure, same values
  // ---------------------------------------------------------------------------
  spacing: {
    spaceXs: '0.25rem', // Tiny gaps (4px)
    spaceSm: '0.5rem', // Small gaps (8px)
    spaceMd: '1rem', // Standard padding (16px)
    spaceLg: '1.5rem', // Card padding, section gaps (24px)
    spaceXl: '2rem', // Large section spacing (32px)
    space2xl: '3rem', // Page section dividers (48px)
  },

  // ---------------------------------------------------------------------------
  // 6. BUTTONS (8 tokens) - Gold color variants
  // ---------------------------------------------------------------------------
  buttons: {
    buttonPrimaryBg: '#D6A249', // Gold primary button background
    buttonPrimaryText: '#ffffff', // White text on primary buttons
    buttonSecondaryBg: '#ffffff', // White secondary button background
    buttonSecondaryText: '#3F2B24', // Espresso text on secondary buttons
    buttonGhostText: '#8A7E78', // Taupe text for ghost buttons
    buttonRadius: '0.75rem', // Button corner radius (12px)
    buttonPaddingX: '1.5rem', // Horizontal padding (24px)
    buttonPaddingY: '0.75rem', // Vertical padding (12px)
  },
};

/**
 * n5 - Static Espresso Theme Tokens
 *
 * Flattened token object for direct import in components.
 * Use this for inline styles where CSS variables aren't practical.
 *
 * Usage:
 * ```tsx
 * import { n5 } from '@/theme';
 *
 * <div style={{ borderRadius: n5.radiusCard, boxShadow: n5.shadowLg }}>
 *   ...
 * </div>
 * ```
 */
export const n5: EspressoTokens = {
  // Colors (CSS variable references for use in style props)
  bgPage: 'var(--n5-bg-page)',
  bgCard: 'var(--n5-bg-card)',
  bgSurface: 'var(--n5-bg-surface)',
  bgHighlight: 'var(--n5-bg-highlight)',
  bgSelected: 'var(--n5-bg-selected)',
  inkMain: 'var(--n5-ink-main)',
  inkMuted: 'var(--n5-ink-muted)',
  inkInverse: 'var(--n5-ink-inverse)',
  accent: 'var(--n5-accent)',
  accentSoft: 'var(--n5-accent-soft)',
  accentHover: 'var(--n5-accent-hover)',
  border: 'var(--n5-border)',
  borderMuted: 'var(--n5-border-muted)',
  borderAccent: 'var(--n5-border-accent)',
  success: 'var(--n5-success)',
  warning: 'var(--n5-warning)',
  error: 'var(--n5-error)',

  // Typography (actual values - fonts need to be actual values, not CSS vars)
  fontHeading: espressoTheme.typography.fontHeading,
  fontBody: espressoTheme.typography.fontBody,

  // Radii (actual values for inline styles)
  radiusCard: espressoTheme.radii.radiusCard,
  radiusSheet: espressoTheme.radii.radiusSheet,
  radiusMd: espressoTheme.radii.radiusMd,
  radiusSm: espressoTheme.radii.radiusSm,
  radiusButton: espressoTheme.radii.radiusButton,
  radiusPill: espressoTheme.radii.radiusPill,

  // Shadows (actual values for inline styles)
  shadowSm: espressoTheme.shadows.shadowSm,
  shadowMd: espressoTheme.shadows.shadowMd,
  shadowLg: espressoTheme.shadows.shadowLg,
  shadowDock: espressoTheme.shadows.shadowDock,
  shadowModal: espressoTheme.shadows.shadowModal,

  // Spacing (actual values for inline styles)
  spaceXs: espressoTheme.spacing.spaceXs,
  spaceSm: espressoTheme.spacing.spaceSm,
  spaceMd: espressoTheme.spacing.spaceMd,
  spaceLg: espressoTheme.spacing.spaceLg,
  spaceXl: espressoTheme.spacing.spaceXl,
  space2xl: espressoTheme.spacing.space2xl,

  // Buttons (actual values for inline styles)
  buttonPrimaryBg: espressoTheme.buttons.buttonPrimaryBg,
  buttonPrimaryText: espressoTheme.buttons.buttonPrimaryText,
  buttonSecondaryBg: espressoTheme.buttons.buttonSecondaryBg,
  buttonSecondaryText: espressoTheme.buttons.buttonSecondaryText,
  buttonGhostText: espressoTheme.buttons.buttonGhostText,
  buttonRadius: espressoTheme.buttons.buttonRadius,
  buttonPaddingX: espressoTheme.buttons.buttonPaddingX,
  buttonPaddingY: espressoTheme.buttons.buttonPaddingY,
};

/**
 * Theme Registry
 *
 * Maps themeKey -> Theme definition.
 * Add new themes here as they are created.
 *
 * Example future themes:
 * - 'modern-minimalist': Clean black/white aesthetic
 * - 'rose-gold': Pink-toned luxury theme
 * - 'ocean-spa': Blue/teal calming theme
 * - 'classic-elegance': Deep burgundy/cream theme
 */
export const themes: ThemeRegistry = {
  'nail-salon-no5': nailSalonNo5Theme,
  'premium-glass': premiumGlassTheme,
  'luxury-rewards': luxuryRewardsTheme,
};

/**
 * Full Theme Registry (EspressoTheme format)
 *
 * Registry of complete EspressoTheme definitions with all 44 tokens.
 * Used for per-page theme injection.
 */
const fullThemes: Record<string, EspressoTheme> = {
  espresso: espressoTheme,
  lavender: lavenderTheme,
  pastel: pastelTheme,
};

/**
 * Get a full EspressoTheme by key with fallback to espresso.
 *
 * Used by ThemeProvider to inject all token categories as CSS variables.
 */
export function getFullTheme(themeKey: string): EspressoTheme {
  return fullThemes[themeKey] ?? fullThemes.espresso ?? espressoTheme;
}

/**
 * Default theme key used when no tenant theme is specified
 * or when the tenant's themeKey is not found in the registry.
 */
export const defaultThemeKey = 'luxury-rewards';

/**
 * Get a theme by key with fallback to default.
 */
export function getTheme(themeKey?: string | null): Theme {
  if (themeKey && themes[themeKey]) {
    return themes[themeKey];
  }
  return themes[defaultThemeKey]!;
}
