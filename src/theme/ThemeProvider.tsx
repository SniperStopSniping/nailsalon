'use client';

/**
 * Theme Provider
 *
 * Provides theme context to the entire application and injects CSS variables.
 *
 * Behavior:
 * - Injects theme colors as CSS variables (--theme-*)
 * - Injects full theme tokens as CSS variables (--n5-*)
 * - Supports per-page theming via themeKey prop
 *
 * Per-page theming:
 * - Each page can specify a themeKey (espresso, lavender, etc.)
 * - ThemeProvider wraps children in a div with inline CSS variables
 * - Components use var(--n5-*) references which automatically pick up the correct values
 */

import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';

import type { EspressoTheme, Theme } from './theme.types';
import { defaultThemeKey, getFullTheme, getTheme } from './themes';

/**
 * Theme context value provided to consumers
 */
type ThemeContextValue = {
  /** Current theme object with all color definitions */
  theme: Theme;
  /** Current theme key identifier */
  themeKey: string;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
  children: ReactNode;
  /**
   * Theme key to use. If not provided, uses defaultThemeKey.
   *
   * For per-page theming, pass the themeKey from getPageAppearance().
   * For global theming, this can be read from tenant context.
   */
  themeKey?: string;
};

/**
 * Convert camelCase to kebab-case for CSS variable names.
 * e.g., "primaryDark" -> "primary-dark"
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Build CSS variables object from theme for inline styles.
 * Returns an object that can be spread into a style prop.
 */
function buildThemeVariables(themeKey: string): Record<string, string> {
  const theme: EspressoTheme = getFullTheme(themeKey);
  const vars: Record<string, string> = {};

  // Colors (17 tokens) - uses --n5-bg-page, --n5-ink-main, etc.
  Object.entries(theme.colors).forEach(([key, value]) => {
    vars[`--n5-${toKebabCase(key)}`] = value;
  });

  // Typography (2 tokens) - fontHeading, fontBody
  vars['--n5-font-heading'] = theme.typography.fontHeading;
  vars['--n5-font-body'] = theme.typography.fontBody;

  // Radii (6 tokens) - radiusCard, radiusMd, etc.
  Object.entries(theme.radii).forEach(([key, value]) => {
    vars[`--n5-${toKebabCase(key)}`] = value;
  });

  // Shadows (5 tokens) - shadowSm, shadowLg, etc.
  Object.entries(theme.shadows).forEach(([key, value]) => {
    vars[`--n5-${toKebabCase(key)}`] = value;
  });

  // Spacing (6 tokens) - spaceXs, spaceMd, etc.
  Object.entries(theme.spacing).forEach(([key, value]) => {
    vars[`--n5-${toKebabCase(key)}`] = value;
  });

  // Buttons (8 tokens) - buttonPrimaryBg, buttonRadius, etc.
  Object.entries(theme.buttons).forEach(([key, value]) => {
    vars[`--n5-button-${toKebabCase(key).replace('button-', '')}`] = value;
  });

  // Legacy --theme-* variables for backward compatibility
  vars['--theme-primary'] = theme.colors.accent;
  vars['--theme-primary-dark'] = theme.colors.accentHover;
  vars['--theme-primary-light'] = theme.colors.accentSoft;
  vars['--theme-accent'] = theme.colors.inkMain;
  vars['--theme-accent-light'] = theme.colors.inkMuted;
  vars['--theme-background'] = theme.colors.bgPage;
  vars['--theme-card-background'] = theme.colors.bgCard;
  vars['--theme-surface-alt'] = theme.colors.bgSurface;
  vars['--theme-selected-background'] = theme.colors.bgSelected;
  vars['--theme-accent-selected'] = theme.colors.bgHighlight;
  vars['--theme-input-background'] = theme.colors.bgSurface;
  vars['--theme-highlight-background'] = theme.colors.bgHighlight;
  vars['--theme-card-border'] = theme.colors.border;
  vars['--theme-border-muted'] = theme.colors.borderMuted;
  vars['--theme-selected-ring'] = theme.colors.borderAccent;
  vars['--theme-title-text'] = theme.colors.inkMain;
  vars['--theme-espresso'] = theme.colors.inkMain;
  vars['--theme-taupe'] = theme.colors.inkMuted;
  vars['--theme-cream'] = theme.colors.bgPage;
  vars['--theme-peach'] = theme.colors.accentSoft;
  vars['--theme-streak-orange'] = theme.colors.warning;
  vars['--theme-success-green'] = theme.colors.success;

  return vars;
}

/**
 * ThemeProvider component
 *
 * Wraps the application and provides theme context.
 * Injects CSS variables via a wrapper div with inline styles.
 * This approach is more reliable than manipulating document.documentElement
 * because it uses React's normal rendering cycle and CSS cascade.
 *
 * Usage:
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * For per-page theming:
 * ```tsx
 * <ThemeProvider themeKey="lavender">
 *   <PageContent />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children, themeKey }: ThemeProviderProps) {
  const resolvedThemeKey = themeKey || defaultThemeKey;
  const theme = getTheme(resolvedThemeKey);

  // Build CSS variables for inline styles (memoized)
  const cssVariables = useMemo(
    () => buildThemeVariables(resolvedThemeKey),
    [resolvedThemeKey],
  );

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeKey: resolvedThemeKey,
    }),
    [theme, resolvedThemeKey],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div style={cssVariables as CSSProperties}>
        {children}
      </div>
    </ThemeContext.Provider>
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
 * CSS variable names for theme colors (legacy format).
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
  primaryLight: 'var(--theme-primary-light)',
  accent: 'var(--theme-accent)',
  accentLight: 'var(--theme-accent-light)',
  background: 'var(--theme-background)',
  cardBackground: 'var(--theme-card-background)',
  cardBg: 'var(--theme-card-background)', // Alias for cardBackground
  surfaceAlt: 'var(--theme-surface-alt)',
  selectedBackground: 'var(--theme-selected-background)',
  accentSelected: 'var(--theme-accent-selected)',
  inputBackground: 'var(--theme-input-background)',
  highlightBackground: 'var(--theme-highlight-background)',
  cardBorder: 'var(--theme-card-border)',
  borderMuted: 'var(--theme-border-muted)',
  selectedRing: 'var(--theme-selected-ring)',
  titleText: 'var(--theme-title-text)',
  secondaryText: 'var(--theme-taupe)', // Alias for muted text
  // Premium Glass Theme - Additional semantic colors
  espresso: 'var(--theme-espresso)',
  taupe: 'var(--theme-taupe)',
  cream: 'var(--theme-cream)',
  peach: 'var(--theme-peach)',
  streakOrange: 'var(--theme-streak-orange)',
  successGreen: 'var(--theme-success-green)',
} as const;

/**
 * CSS variable names for Espresso theme tokens (n5 format).
 * These are injected by ThemeProvider and referenced by the n5 object.
 *
 * Example usage in className:
 * - `bg-[var(--n5-bg-page)]`
 * - `text-[var(--n5-ink-main)]`
 * - `border-[var(--n5-border)]`
 */
export const n5Vars = {
  // Colors
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
} as const;
