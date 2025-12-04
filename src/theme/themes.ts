/**
 * Theme Definitions
 *
 * This module contains all available themes for the multi-tenant platform.
 * Currently contains the default "Nail Salon No.5" theme.
 *
 * Future themes will be added here and registered in the `themes` object.
 * Each salon's themeKey in the database will map to a key in this registry.
 */

import type { Theme, ThemeRegistry } from './theme.types';

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
  },
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
};

/**
 * Default theme key used when no tenant theme is specified
 * or when the tenant's themeKey is not found in the registry.
 */
export const defaultThemeKey = 'nail-salon-no5';

/**
 * Get a theme by key with fallback to default.
 */
export function getTheme(themeKey?: string | null): Theme {
  if (themeKey && themes[themeKey]) {
    return themes[themeKey];
  }
  return themes[defaultThemeKey]!;
}

