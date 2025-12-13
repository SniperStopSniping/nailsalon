/**
 * DEV ONLY - React hook for dev role switcher
 *
 * Provides access to dev mode state and role switching functionality.
 */

'use client';

import {
  type DevRole,
  getCurrentDevRole,
  isDevModeClient,
  switchRole,
} from '@/libs/devRole.client';

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for dev role switcher UI
 *
 * Returns:
 * - isDevMode: whether dev mode is enabled
 * - switchRole: function to switch to a different role
 * - getCurrentDevRole: function to get current role from server
 */
export function useDevRole() {
  const isDevMode = isDevModeClient();

  return {
    isDevMode,
    switchRole,
    getCurrentDevRole,
  };
}

// Re-export types for convenience
export type { DevRole };
