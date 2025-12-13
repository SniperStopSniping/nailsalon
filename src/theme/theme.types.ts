/**
 * Theme System Type Definitions
 *
 * This module defines the structure for multi-tenant themes.
 * Each salon (tenant) can have a different theme applied via their themeKey.
 */

/**
 * Legacy ThemeColors interface
 * Kept for backward compatibility with existing themes.
 */
export type ThemeColors = {
  // Brand colors
  primary: string; // Main brand color (gold: #f4b864)
  primaryDark: string; // Darker variant (dark gold: #d6a249)
  primaryLight: string; // Lighter variant for gradients (#FBC02D)
  accent: string; // Accent color (purple: #7b4ea3)
  accentLight: string; // Light accent (#9b6dc6)

  // Backgrounds
  background: string; // Page background (#f6ebdd)
  cardBackground: string; // Card bg (white)
  surfaceAlt: string; // Alternative surface for cards/hovers (#fff7ec)
  selectedBackground: string; // Selected state bg (#f5e6d3)
  accentSelected: string; // Purple selected state bg (#e9d5f5)
  inputBackground: string; // Input fields (neutral-50)
  highlightBackground: string; // Discount/points highlight (#fef9e7)

  // Borders
  cardBorder: string; // Card borders (#e6d6c2)
  borderMuted: string; // Muted border for pending/inactive states (#d9c6aa)
  selectedRing: string; // Selection ring (#d6a249)

  // Text (semantic, not hardcoded neutrals)
  titleText: string; // Page titles (#7b4ea3)

  // Premium Glass Theme - Additional semantic colors
  espresso: string; // Primary text for glass theme (#3F2B24)
  taupe: string; // Secondary text (#8A7E78)
  cream: string; // Soft cream accents (#FFF8E1)
  peach: string; // Soft peach accents (#FFE0B2)
  streakOrange: string; // Streak flame color (#FF9500)
  successGreen: string; // Check/success state (#34C759)
};

// ============================================================================
// ESPRESSO THEME TOKEN TYPES
// Complete design token system for the Espresso theme
// ============================================================================

/**
 * Espresso Theme Color Tokens
 * All colors extracted from the Profile/Rewards pages.
 */
export type EspressoColors = {
  // Backgrounds
  bgPage: string; // Ivory page background (#FDF7F0)
  bgCard: string; // White card backgrounds (#ffffff)
  bgSurface: string; // Surface for inputs, icon circles (#FAF4EC)
  bgHighlight: string; // Cream highlight backgrounds (#FFF8E1)
  bgSelected: string; // Selected state background (#F5EDE5)

  // Ink (Text)
  inkMain: string; // Espresso brown - primary text (#3F2B24)
  inkMuted: string; // Taupe - secondary text, labels (#8A7E78)
  inkInverse: string; // Light text on dark backgrounds (#FDF7F0)

  // Accent
  accent: string; // Rich gold - buttons, highlights, progress (#D6A249)
  accentSoft: string; // Light gold/cream for soft accents (#FFF8E1)
  accentHover: string; // Darker gold for hover states (#C5933E)

  // Borders
  border: string; // Card borders, dividers (#F0E6DE)
  borderMuted: string; // Subtle borders (drag handles, tracks) (#E5DDD5)
  borderAccent: string; // Gold accent borders (#D6A249)

  // Semantic
  success: string; // Green - check marks, success states (#34C759)
  warning: string; // Orange - streak flames (#FF9500)
  error: string; // Red - sign out button, error states (#EF4444)
};

/**
 * Espresso Theme Typography Tokens
 */
export type EspressoTypography = {
  fontHeading: string; // Serif font for headings
  fontBody: string; // Sans-serif font for body text
};

/**
 * Espresso Theme Radius Tokens
 */
export type EspressoRadii = {
  radiusCard: string; // Large cards, wallet card, dock (2rem)
  radiusSheet: string; // Slide-up modal (2.5rem)
  radiusMd: string; // Medium elements (1rem)
  radiusSm: string; // Small elements (0.5rem)
  radiusButton: string; // Button corners (0.75rem)
  radiusPill: string; // Pills, badges, fully rounded (9999px)
};

/**
 * Espresso Theme Shadow Tokens
 */
export type EspressoShadows = {
  shadowSm: string; // Small cards, buttons
  shadowMd: string; // Medium elevation
  shadowLg: string; // Hero/wallet card (gold tint)
  shadowDock: string; // Floating dock navigation
  shadowModal: string; // Slide-up sheet
};

/**
 * Espresso Theme Spacing Tokens
 */
export type EspressoSpacing = {
  spaceXs: string; // Tiny gaps (0.25rem)
  spaceSm: string; // Small gaps (0.5rem)
  spaceMd: string; // Standard padding (1rem)
  spaceLg: string; // Card padding, section gaps (1.5rem)
  spaceXl: string; // Large section spacing (2rem)
  space2xl: string; // Page section dividers (3rem)
};

/**
 * Espresso Theme Button Tokens
 */
export type EspressoButtons = {
  buttonPrimaryBg: string; // Gold primary button background (#D6A249)
  buttonPrimaryText: string; // White text on primary buttons (#ffffff)
  buttonSecondaryBg: string; // White secondary button background (#ffffff)
  buttonSecondaryText: string; // Espresso text on secondary buttons (#3F2B24)
  buttonGhostText: string; // Taupe text for ghost buttons (#8A7E78)
  buttonRadius: string; // Button corner radius (0.75rem)
  buttonPaddingX: string; // Horizontal padding (1.5rem)
  buttonPaddingY: string; // Vertical padding (0.75rem)
};

/**
 * Complete Espresso Theme Definition
 * Contains all design tokens for the Espresso theme.
 */
export type EspressoTheme = {
  key: string;
  name: string;
  colors: EspressoColors;
  typography: EspressoTypography;
  radii: EspressoRadii;
  shadows: EspressoShadows;
  spacing: EspressoSpacing;
  buttons: EspressoButtons;
};

/**
 * Static token object type for direct imports (n5)
 * Flattened structure for easy access in components.
 */
export type EspressoTokens = {
  // Colors (CSS variables)
  bgPage: string;
  bgCard: string;
  bgSurface: string;
  bgHighlight: string;
  bgSelected: string;
  inkMain: string;
  inkMuted: string;
  inkInverse: string;
  accent: string;
  accentSoft: string;
  accentHover: string;
  border: string;
  borderMuted: string;
  borderAccent: string;
  success: string;
  warning: string;
  error: string;

  // Typography (actual values for inline styles)
  fontHeading: string;
  fontBody: string;

  // Radii (actual values for inline styles)
  radiusCard: string;
  radiusSheet: string;
  radiusMd: string;
  radiusSm: string;
  radiusButton: string;
  radiusPill: string;

  // Shadows (actual values for inline styles)
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowDock: string;
  shadowModal: string;

  // Spacing (actual values for inline styles)
  spaceXs: string;
  spaceSm: string;
  spaceMd: string;
  spaceLg: string;
  spaceXl: string;
  space2xl: string;

  // Buttons (actual values for inline styles)
  buttonPrimaryBg: string;
  buttonPrimaryText: string;
  buttonSecondaryBg: string;
  buttonSecondaryText: string;
  buttonGhostText: string;
  buttonRadius: string;
  buttonPaddingX: string;
  buttonPaddingY: string;
};

// ============================================================================
// LEGACY THEME TYPES (kept for backward compatibility)
// ============================================================================

export type Theme = {
  key: string;
  name: string;
  colors: ThemeColors;
};

/**
 * Theme registry type for all available themes.
 * Maps themeKey -> Theme definition.
 */
export type ThemeRegistry = Record<string, Theme>;
