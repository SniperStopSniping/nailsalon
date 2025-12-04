/**
 * Theme System
 *
 * Multi-tenant theming support for the nail salon booking platform.
 *
 * Exports:
 * - Theme types (Theme, ThemeColors, ThemeRegistry)
 * - Theme definitions (themes, defaultThemeKey, getTheme)
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
 * // In components
 * import { useTheme, themeVars } from '@/theme';
 *
 * function MyComponent() {
 *   const { theme } = useTheme();
 *   return <div style={{ background: theme.colors.primary }}>...</div>;
 *   // Or with Tailwind:
 *   return <div className="bg-[var(--theme-primary)]">...</div>;
 * }
 * ```
 */

// Type definitions
export type { Theme, ThemeColors, ThemeRegistry } from './theme.types';

// Theme definitions and utilities
export {
  nailSalonNo5Theme,
  themes,
  defaultThemeKey,
  getTheme,
} from './themes';

// Provider and hooks
export { ThemeProvider, useTheme, themeVars } from './ThemeProvider';

