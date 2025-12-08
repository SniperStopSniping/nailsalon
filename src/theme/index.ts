/**
 * Theme System
 *
 * Multi-tenant theming support for the nail salon booking platform.
 *
 * Exports:
 * - Theme types (Theme, ThemeColors, ThemeRegistry, EspressoTheme, EspressoTokens)
 * - Theme definitions (themes, defaultThemeKey, getTheme)
 * - Espresso theme (espressoTheme, n5)
 * - ThemeProvider and useTheme hook
 * - CSS variable constants (themeVars)
 *
 * Usage:
 * ```tsx
 * // In layout.tsx
 * import { ThemeProvider } from '@/theme';
 *
 * export default function Layout({ children }) {
 *   return <ThemeProvider>{children}</ThemeProvider>;
 * }
 *
 * // In components - using CSS variables
 * import { useTheme, themeVars } from '@/theme';
 *
 * function MyComponent() {
 *   const { theme } = useTheme();
 *   return <div style={{ background: theme.colors.primary }}>...</div>;
 *   // Or with Tailwind:
 *   return <div className="bg-[var(--theme-primary)]">...</div>;
 * }
 *
 * // In components - using n5 tokens (Espresso theme)
 * import { n5 } from '@/theme';
 *
 * function MyComponent() {
 *   return (
 *     <div
 *       style={{
 *         borderRadius: n5.radiusCard,
 *         boxShadow: n5.shadowLg,
 *         padding: n5.spaceLg,
 *       }}
 *     >
 *       ...
 *     </div>
 *   );
 * }
 * ```
 */

// Type definitions
export type {
  EspressoButtons,
  EspressoColors,
  EspressoRadii,
  EspressoShadows,
  EspressoSpacing,
  EspressoTheme,
  EspressoTokens,
  EspressoTypography,
  Theme,
  ThemeColors,
  ThemeRegistry,
} from './theme.types';

// Theme definitions and utilities
export {
  defaultThemeKey,
  espressoTheme,
  getFullTheme,
  getTheme,
  lavenderTheme,
  luxuryRewardsTheme,
  n5,
  nailSalonNo5Theme,
  premiumGlassTheme,
  themes,
} from './themes';

// Provider and hooks
export { ThemeProvider, themeVars, useTheme } from './ThemeProvider';
