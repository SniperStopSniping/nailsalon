/**
 * Theme System Type Definitions
 *
 * This module defines the structure for multi-tenant themes.
 * Each salon (tenant) can have a different theme applied via their themeKey.
 */

export interface ThemeColors {
  // Brand colors
  primary: string; // Main brand color (gold: #f4b864)
  primaryDark: string; // Darker variant (dark gold: #d6a249)
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
}

export interface Theme {
  key: string;
  name: string;
  colors: ThemeColors;
}

/**
 * Theme registry type for all available themes.
 * Maps themeKey -> Theme definition.
 */
export type ThemeRegistry = Record<string, Theme>;

