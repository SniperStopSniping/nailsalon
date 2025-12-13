'use client';

import type { ReactNode } from 'react';

import { ThemeProvider } from '@/theme';

/**
 * PageThemeWrapper
 *
 * Wraps page content with ThemeProvider when mode is 'theme'.
 * When mode is 'custom', renders children without any theme injection.
 *
 * Usage:
 * ```tsx
 * // In a server component
 * const { mode, themeKey } = await getPageAppearance(salonId, 'rewards');
 *
 * <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="rewards">
 *   <RewardsPageContent />
 * </PageThemeWrapper>
 * ```
 */
export type PageThemeWrapperProps = {
  /** Mode: 'custom' = no theme, 'theme' = use themeKey */
  mode: 'custom' | 'theme';
  /** Theme key when mode = 'theme', null otherwise */
  themeKey: string | null;
  /** Page name for debugging (e.g., 'rewards', 'profile') */
  pageName?: string;
  /** Page content */
  children: ReactNode;
};

/**
 * Dev-only debug banner showing current theme state
 */
function ThemeDebugBanner({
  pageName,
  mode,
  themeKey,
}: {
  pageName: string;
  mode: 'custom' | 'theme';
  themeKey: string | null;
}) {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        backgroundColor: mode === 'theme' ? '#10b981' : '#6b7280',
        color: 'white',
        fontSize: '11px',
        fontFamily: 'ui-monospace, monospace',
        padding: '4px 12px',
        display: 'flex',
        gap: '16px',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <span>
        <strong>page:</strong>
        {' '}
        {pageName}
      </span>
      <span>
        <strong>mode:</strong>
        {' '}
        {mode}
      </span>
      <span>
        <strong>themeKey:</strong>
        {' '}
        {themeKey || 'none'}
      </span>
    </div>
  );
}

export function PageThemeWrapper({ mode, themeKey, pageName = 'unknown', children }: PageThemeWrapperProps) {
  const debugBanner = <ThemeDebugBanner pageName={pageName} mode={mode} themeKey={themeKey} />;

  // Theme mode: wrap with ThemeProvider to inject CSS variables
  if (mode === 'theme' && themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        {debugBanner}
        {children}
      </ThemeProvider>
    );
  }

  // Custom mode: render without theme injection (page uses its existing styles)
  return (
    <>
      {debugBanner}
      {children}
    </>
  );
}
