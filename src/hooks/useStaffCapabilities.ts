'use client';

/**
 * Staff Capabilities Hook
 *
 * Fetches and caches effective modules + visibility for the logged-in staff member.
 * Used by staff UI to conditionally render features based on what's actually enabled.
 *
 * Error handling:
 * - 401: Sets error, clears cached capabilities, caller should redirect to login
 * - Other errors: Sets error state, clears cached capabilities
 *
 * NOTE: Does NOT special-case MODULE_DISABLED because the capabilities endpoint
 * should never return it. MODULE_DISABLED handling belongs in feature fetch calls.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  StaffModules,
  StaffVisibility,
  UseStaffCapabilitiesResult,
} from '@/types/staffCapabilities';

// Re-export types for convenience
export type { StaffModules, StaffVisibility, UseStaffCapabilitiesResult };
export type { StaffCapabilities } from '@/types/staffCapabilities';

// =============================================================================
// DEFAULTS (used while loading to prevent flash)
// =============================================================================

// These are intentionally restrictive - show nothing until we know what's allowed
const DEFAULT_MODULES: StaffModules = {
  scheduleOverrides: false,
  staffEarnings: false,
};

// =============================================================================
// HOOK
// =============================================================================

export function useStaffCapabilities(): UseStaffCapabilitiesResult {
  const [modules, setModules] = useState<StaffModules | null>(null);
  const [visibility, setVisibility] = useState<StaffVisibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  const fetchCapabilities = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIsUnauthorized(false);

    try {
      const response = await fetch('/api/staff/capabilities');

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
          setIsUnauthorized(true);
          setError(data.error?.message || 'Not authenticated');
          // SECURITY: Clear any cached capabilities to prevent stale UI after logout/expiry
          setModules(null);
          setVisibility(null);
          return;
        }

        setError(data.error?.message || 'Failed to fetch capabilities');
        // Also clear on other errors to be safe
        setModules(null);
        setVisibility(null);
        return;
      }

      const data = await response.json();

      if (data.data?.modules) {
        setModules(data.data.modules);
      }

      if (data.data?.visibility) {
        setVisibility(data.data.visibility);
      }
    } catch (err) {
      console.error('Failed to fetch staff capabilities:', err);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities();
  }, [fetchCapabilities]);

  return {
    modules,
    visibility,
    loading,
    error,
    isUnauthorized,
    refetch: fetchCapabilities,
  };
}

// =============================================================================
// HELPER: Check if capabilities are loaded
// =============================================================================

/**
 * Helper to check if a module is enabled, with safe default while loading.
 * Returns false if capabilities not yet loaded.
 */
export function isModuleEnabled(
  modules: StaffModules | null,
  module: keyof StaffModules,
): boolean {
  if (!modules) {
    return DEFAULT_MODULES[module];
  }
  return modules[module];
}
