/**
 * DEV ONLY - Client-side dev role helpers
 *
 * This module provides browser-side utilities for the dev role switcher.
 * It communicates with /api/dev/role to set/get the role cookie.
 *
 * IMPORTANT: Client code must use NEXT_PUBLIC_DEV_MODE, not NODE_ENV.
 */

// =============================================================================
// TYPES
// =============================================================================

export type DevRole = 'super_admin' | 'admin' | 'staff' | 'client';

// =============================================================================
// DEV MODE CHECK
// =============================================================================

/**
 * Check if dev mode is enabled (client-side)
 * Must use NEXT_PUBLIC_ env var since NODE_ENV is unreliable in browser
 */
export function isDevModeClient(): boolean {
  return process.env.NEXT_PUBLIC_DEV_MODE === 'true';
}

// =============================================================================
// ROLE SWITCHING
// =============================================================================

/**
 * Switch to a different dev role
 * Posts to /api/dev/role to set the cookie
 *
 * @param role - The role to switch to, or null to clear
 */
export async function switchRole(role: DevRole | null): Promise<boolean> {
  try {
    const response = await fetch('/api/dev/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
      cache: 'no-store',
      credentials: 'include', // Required for cross-origin (LAN IP/staging)
    });

    if (!response.ok) {
      console.error('[DEV ROLE] Failed to switch role:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('[DEV ROLE] Error switching role:', error);
    return false;
  }
}

/**
 * Get the current dev role from the server
 * Fetches from /api/dev/role GET endpoint
 */
export async function getCurrentDevRole(): Promise<DevRole | null> {
  try {
    const response = await fetch('/api/dev/role', {
      cache: 'no-store',
      credentials: 'include', // Required for cross-origin (LAN IP/staging)
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.role ?? null;
  } catch {
    return null;
  }
}
