'use client';

/**
 * Theme Provider
 *
 * Provides theme context to the entire application and injects CSS variables.
 *
 * Current behavior:
 * - Uses default theme (nail-salon-no5)
 * - Injects theme colors as CSS variables (--theme-*)
 *
 * Future multi-tenant behavior:
 * - Will read themeKey from tenant/organization context
 * - Each salon will have their theme applied automatically
 * - God Viewer admin can override themes for any salon
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

import type { Theme } from './theme.types';
import { defaultThemeKey, getTheme } from './themes';

/**
 * Theme context value provided to consumers
 */
interface ThemeContextValue {
  /** Current theme object with all color definitions */
  theme: Theme;
  /** Current theme key identifier */
  themeKey: string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Theme key to use. If not provided, uses defaultThemeKey.
   *
   * Future: This will be read from tenant context automatically.
   * For now, it can be passed explicitly for testing different themes.
   */
  themeKey?: string;
}

/**
 * Convert camelCase to kebab-case for CSS variable names.
 * e.g., "primaryDark" -> "primary-dark"
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * ThemeProvider component
 *
 * Wraps the application and provides theme context.
 * Injects CSS variables for all theme colors on mount and when theme changes.
 *
 * Usage:
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * Or with explicit theme (for testing/preview):
 * ```tsx
 * <ThemeProvider themeKey="modern-minimalist">
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children, themeKey }: ThemeProviderProps) {
  const resolvedThemeKey = themeKey || defaultThemeKey;
  const theme = getTheme(resolvedThemeKey);

  // Inject CSS variables into document root
  useEffect(() => {
    const root = document.documentElement;

    // Set all theme color variables
    Object.entries(theme.colors).forEach(([key, value]) => {
      const cssVarName = `--theme-${toKebabCase(key)}`;
      root.style.setProperty(cssVarName, value);
    });

    // Cleanup: Remove CSS variables when provider unmounts
    // (useful for testing, not typically needed in production)
    return () => {
      Object.keys(theme.colors).forEach((key) => {
        const cssVarName = `--theme-${toKebabCase(key)}`;
        root.style.removeProperty(cssVarName);
      });
    };
  }, [theme]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeKey: resolvedThemeKey,
    }),
    [theme, resolvedThemeKey],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Hook to access the current theme
 *
 * @throws Error if used outside of ThemeProvider
 *
 * Usage:
 * ```tsx
 * const { theme, themeKey } = useTheme();
 * console.log(theme.colors.primary); // "#f4b864"
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error(
      'useTheme must be used within a ThemeProvider. '
        + 'Make sure your component is wrapped in <ThemeProvider>.',
    );
  }

  return context;
}

/**
 * CSS variable names for theme colors.
 * Use these constants to reference theme colors in Tailwind arbitrary values.
 *
 * Example usage in className:
 * - `bg-[var(--theme-primary)]`
 * - `text-[var(--theme-title-text)]`
 * - `border-[var(--theme-card-border)]`
 */
export const themeVars = {
  primary: 'var(--theme-primary)',
  primaryDark: 'var(--theme-primary-dark)',
  accent: 'var(--theme-accent)',
  accentLight: 'var(--theme-accent-light)',
  background: 'var(--theme-background)',
  cardBackground: 'var(--theme-card-background)',
  surfaceAlt: 'var(--theme-surface-alt)',
  selectedBackground: 'var(--theme-selected-background)',
  accentSelected: 'var(--theme-accent-selected)',
  inputBackground: 'var(--theme-input-background)',
  highlightBackground: 'var(--theme-highlight-background)',
  cardBorder: 'var(--theme-card-border)',
  borderMuted: 'var(--theme-border-muted)',
  selectedRing: 'var(--theme-selected-ring)',
  titleText: 'var(--theme-title-text)',
} as const;

