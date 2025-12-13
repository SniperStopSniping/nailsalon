/**
 * Staff Capabilities Types
 *
 * Shared types for staff capabilities API and hook.
 * Single source of truth for the capabilities response contract.
 *
 * Used by:
 * - /api/staff/capabilities/route.ts (server)
 * - useStaffCapabilities hook (client)
 */

// =============================================================================
// MODULE TYPES
// =============================================================================

/**
 * Staff-relevant modules that can be enabled/disabled.
 * These affect what features staff can see/use.
 */
export type StaffModules = {
  /** Schedule overrides - one-time schedule changes */
  scheduleOverrides: boolean;
  /** Staff earnings - view earnings/tips (future) */
  staffEarnings: boolean;
};

/**
 * All staff module keys for type-safe iteration.
 */
export type StaffModuleKey = keyof StaffModules;

/**
 * Array of all staff module keys.
 */
export const STAFF_MODULE_KEYS: StaffModuleKey[] = [
  'scheduleOverrides',
  'staffEarnings',
];

// =============================================================================
// VISIBILITY TYPES
// =============================================================================

/**
 * Staff visibility settings - what fields staff can see.
 * Controlled by salon admin via settings.visibility.staff.*
 */
export type StaffVisibility = {
  /** Can staff see client phone numbers */
  clientPhone: boolean;
  /** Can staff see client email addresses */
  clientEmail: boolean;
  /** Can staff see client full names */
  clientFullName: boolean;
  /** Can staff see appointment prices */
  appointmentPrice: boolean;
  /** Can staff see client history (visits, spend) */
  clientHistory: boolean;
  /** Can staff see client notes */
  clientNotes: boolean;
  /** Can staff see other technicians' appointments */
  otherTechAppointments: boolean;
};

/**
 * All staff visibility keys for type-safe iteration.
 */
export type StaffVisibilityKey = keyof StaffVisibility;

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Response shape for GET /api/staff/capabilities
 */
export type StaffCapabilitiesResponse = {
  data: {
    modules: StaffModules;
    visibility: StaffVisibility;
  };
};

/**
 * Combined capabilities object.
 */
export type StaffCapabilities = {
  modules: StaffModules;
  visibility: StaffVisibility;
};

// =============================================================================
// HOOK RESULT TYPE
// =============================================================================

/**
 * Return type for useStaffCapabilities hook.
 */
export type UseStaffCapabilitiesResult = {
  /** Effective modules - which features are enabled (null while loading) */
  modules: StaffModules | null;
  /** Effective visibility - which fields staff can see (null while loading) */
  visibility: StaffVisibility | null;
  /** True while initial fetch is in progress */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** True if error was 401 (unauthorized) */
  isUnauthorized: boolean;
  /** Refetch capabilities */
  refetch: () => Promise<void>;
};
