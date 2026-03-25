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

type CachedCapabilities = {
  modules: StaffModules | null;
  visibility: StaffVisibility | null;
  fetchedAt: number;
};

const STAFF_CAPABILITIES_TTL_MS = 30_000;

let cachedCapabilities: CachedCapabilities | null = null;
let inFlightCapabilitiesPromise: Promise<CachedCapabilities> | null = null;

async function requestStaffCapabilities(): Promise<CachedCapabilities> {
  const response = await fetch('/api/staff/capabilities');

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error?.message || 'Failed to fetch capabilities') as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const nextValue: CachedCapabilities = {
    modules: data.data?.modules ?? null,
    visibility: data.data?.visibility ?? null,
    fetchedAt: Date.now(),
  };
  cachedCapabilities = nextValue;
  return nextValue;
}

async function getStaffCapabilities(options?: { force?: boolean }): Promise<CachedCapabilities> {
  const force = options?.force ?? false;
  const now = Date.now();

  if (!force && cachedCapabilities && now - cachedCapabilities.fetchedAt < STAFF_CAPABILITIES_TTL_MS) {
    return cachedCapabilities;
  }

  if (!force && inFlightCapabilitiesPromise) {
    return inFlightCapabilitiesPromise;
  }

  inFlightCapabilitiesPromise = requestStaffCapabilities()
    .finally(() => {
      inFlightCapabilitiesPromise = null;
    });

  return inFlightCapabilitiesPromise;
}

// =============================================================================
// HOOK
// =============================================================================

export function useStaffCapabilities(): UseStaffCapabilitiesResult {
  const [modules, setModules] = useState<StaffModules | null>(null);
  const [visibility, setVisibility] = useState<StaffVisibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState(false);

  const fetchCapabilities = useCallback(async (options?: { force?: boolean }) => {
    setLoading(true);
    setError(null);
    setIsUnauthorized(false);

    try {
      const data = await getStaffCapabilities(options);
      setModules(data.modules);
      setVisibility(data.visibility);
    } catch (err) {
      const status = err instanceof Error && 'status' in err ? (err as Error & { status?: number }).status : undefined;
      if (status === 401) {
        setIsUnauthorized(true);
        setError(err instanceof Error ? err.message : 'Not authenticated');
        cachedCapabilities = null;
        setModules(null);
        setVisibility(null);
        return;
      }

      cachedCapabilities = null;
      setModules(null);
      setVisibility(null);
      console.error('Failed to fetch staff capabilities:', err);
      setError(err instanceof Error ? err.message : 'Network error');
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
    refetch: () => fetchCapabilities({ force: true }),
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
