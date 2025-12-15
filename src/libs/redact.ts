/**
 * Redaction Utilities
 *
 * Server-side field redaction based on visibility policy.
 * Uses explicit key omission - does NOT rely on undefined serialization.
 *
 * CRITICAL: These functions build new objects with only allowed fields.
 * Hidden fields do NOT appear in the output at all (not null, not undefined).
 *
 * STAFF FIELD POLICY (Step 16.4 Hardening):
 * =========================================
 *
 * ALLOWED (with visibility check):
 *   - clientName (showClientFullName)
 *   - clientPhone (showClientPhone)
 *   - totalPrice (showAppointmentPrice)
 *
 * ALWAYS ALLOWED (core appointment data):
 *   - id, startTime, endTime, status, technicianId
 *   - services (name only)
 *   - photos (id, imageUrl, thumbnailUrl, photoType)
 *
 * NEVER ALLOWED FOR STAFF (admin-only):
 *   - cancelReason - internal operations
 *   - internalNotes - admin-only notes
 *   - paymentStatus - financial data
 *   - techNotes - handled separately (only visible to assigned tech)
 *   - metadata - internal JSON blob
 *   - source/referral tracking - marketing data
 *   - profit, margin, cost - financial data
 *   - commissionRate, payoutDetails - financial data
 */

import type { ResolvedStaffVisibility } from '@/types/salonPolicy';

// =============================================================================
// FORBIDDEN FIELDS (Never include in staff responses)
// =============================================================================

/**
 * Fields that are NEVER included in staff responses, regardless of visibility settings.
 * These are stripped at the source - the redaction function doesn't even receive them.
 *
 * This list serves as documentation and can be used for runtime validation.
 */
export const STAFF_FORBIDDEN_FIELDS = [
  'cancelReason',
  'internalNotes',
  'paymentStatus',
  'metadata',
  'source',
  'referralId',
  'profit',
  'margin',
  'cost',
  'commissionRate',
  'payoutDetails',
] as const;

export type StaffForbiddenField = (typeof STAFF_FORBIDDEN_FIELDS)[number];

// =============================================================================
// INPUT TYPES (Loose - accepts any object with these fields)
// =============================================================================

/**
 * Appointment data that can be redacted.
 * Uses loose typing to work with various query result shapes.
 *
 * NOTE: This type intentionally does NOT include forbidden fields.
 * They should never be passed to redaction functions.
 */
export type RedactableAppointment = {
  id: string;
  startTime: string | Date;
  endTime: string | Date;
  status: string;
  technicianId: string | null;
  services?: Array<{ name: string }>;
  photos?: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl?: string | null;
    photoType: string;
  }>;
  // Fields that may be redacted based on visibility
  clientName?: string | null;
  clientPhone?: string;
  totalPrice?: number;
  // NOTE: notes field removed - client notes handled via showClientNotes
};

/**
 * Client data that can be redacted.
 */
export type RedactableClient = {
  id: string;
  // Fields that may be redacted
  phone?: string;
  fullName?: string | null;
  name?: string | null; // Alternative field name
  email?: string | null;
  notes?: string | null;
  totalVisits?: number | null;
  totalSpent?: number | null;
  lastVisitAt?: string | Date | null;
  memberSince?: string | null;
};

// =============================================================================
// OUTPUT TYPES
// =============================================================================

/**
 * Redacted appointment - only contains allowed fields.
 * Forbidden fields are NOT present in this type.
 */
export type RedactedAppointment = {
  id: string;
  startTime: string | Date;
  endTime: string | Date;
  status: string;
  technicianId: string | null;
  services?: Array<{ name: string }>;
  photos?: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl?: string | null;
    photoType: string;
  }>;
  // Optional fields (only present if visibility allows)
  clientName?: string | null;
  clientPhone?: string;
  totalPrice?: number;
};

/**
 * Redacted client - only contains allowed fields.
 */
export type RedactedClient = {
  id: string;
  // Optional fields (only present if visibility allows)
  phone?: string;
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
  notes?: string | null;
  totalVisits?: number | null;
  totalSpent?: number | null;
  lastVisitAt?: string | Date | null;
  memberSince?: string | null;
};

// =============================================================================
// REDACTION FUNCTIONS
// =============================================================================

/**
 * Redact appointment data for staff based on visibility policy.
 *
 * IMPORTANT: Builds a new object with only allowed fields.
 * Hidden fields are completely omitted (not set to null/undefined).
 *
 * @param appointment - Full appointment data
 * @param visibility - Resolved staff visibility settings
 * @returns Redacted appointment with only allowed fields
 */
export function redactAppointmentForStaff(
  appointment: RedactableAppointment,
  visibility: ResolvedStaffVisibility,
): RedactedAppointment {
  // Always include these core fields
  const result: RedactedAppointment = {
    id: appointment.id,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    technicianId: appointment.technicianId,
  };

  // Include services if present
  if (appointment.services) {
    result.services = appointment.services;
  }

  // Include photos if present
  if (appointment.photos) {
    result.photos = appointment.photos;
  }

  // Conditionally include sensitive fields
  if (visibility.showClientPhone && appointment.clientPhone !== undefined) {
    result.clientPhone = appointment.clientPhone;
  }

  if (visibility.showClientFullName && appointment.clientName !== undefined) {
    result.clientName = appointment.clientName;
  }

  if (visibility.showAppointmentPrice && appointment.totalPrice !== undefined) {
    result.totalPrice = appointment.totalPrice;
  }

  // ==========================================================================
  // NEVER INCLUDE (Step 16.4 Hardening)
  // These fields are admin-only and must never leak to staff:
  //   - cancelReason, internalNotes, paymentStatus
  //   - metadata, source, referralId
  //   - profit, margin, cost, commissionRate, payoutDetails
  // The input type doesn't include these, but this comment serves as
  // documentation and a reminder for anyone modifying this function.
  // ==========================================================================

  return result;
}

/**
 * Redact client data for staff based on visibility policy.
 *
 * IMPORTANT: Builds a new object with only allowed fields.
 * Hidden fields are completely omitted (not set to null/undefined).
 *
 * @param client - Full client data
 * @param visibility - Resolved staff visibility settings
 * @returns Redacted client with only allowed fields
 */
export function redactClientForStaff(
  client: RedactableClient,
  visibility: ResolvedStaffVisibility,
): RedactedClient {
  // Always include ID
  const result: RedactedClient = {
    id: client.id,
  };

  // Conditionally include fields based on visibility
  if (visibility.showClientPhone && client.phone !== undefined) {
    result.phone = client.phone;
  }

  if (visibility.showClientFullName) {
    if (client.fullName !== undefined) {
      result.fullName = client.fullName;
    }
    if (client.name !== undefined) {
      result.name = client.name;
    }
  }

  if (visibility.showClientEmail && client.email !== undefined) {
    result.email = client.email;
  }

  if (visibility.showClientNotes && client.notes !== undefined) {
    result.notes = client.notes;
  }

  // History fields - only include if showClientHistory is true
  if (visibility.showClientHistory) {
    if (client.totalVisits !== undefined) {
      result.totalVisits = client.totalVisits;
    }
    if (client.totalSpent !== undefined) {
      result.totalSpent = client.totalSpent;
    }
    if (client.lastVisitAt !== undefined) {
      result.lastVisitAt = client.lastVisitAt;
    }
    if (client.memberSince !== undefined) {
      result.memberSince = client.memberSince;
    }
  }

  return result;
}

/**
 * Check if visibility is full access (admin/super_admin).
 * Helper to avoid type narrowing issues.
 */
export function isFullAccess(
  visibility: ResolvedStaffVisibility | 'full_access',
): visibility is 'full_access' {
  return visibility === 'full_access';
}

// =============================================================================
// DEFENSE-IN-DEPTH HELPERS
// =============================================================================

/**
 * Sanitize an object by removing all forbidden fields.
 *
 * IMPORTANT: This is a DEFENSE-IN-DEPTH helper, NOT a replacement for
 * the whitelist-based redaction functions above.
 *
 * Use this as an extra safety layer when:
 * - You're not sure if the object might contain forbidden fields
 * - You want to be extra safe before JSON serialization
 *
 * NOTE: Only removes top-level keys. Does NOT deep-sanitize nested objects.
 * For full security, always use the whitelist-based redactXForStaff functions.
 *
 * @param obj - Object to sanitize
 * @returns Object with forbidden keys removed
 */
export function sanitizeForStaff<T extends Record<string, unknown>>(obj: T): T {
  const result: any = { ...obj };

  for (const key of STAFF_FORBIDDEN_FIELDS) {
    if (key in result) {
      delete result[key];
    }
  }

  return result as T;
}

/**
 * Deep sanitize an object by removing all forbidden fields at any depth.
 *
 * WARNING: This is expensive and should only be used when you cannot
 * guarantee the object structure. Prefer whitelist-based redaction.
 *
 * @param obj - Object to deep sanitize
 * @returns Object with forbidden keys removed at all depths
 */
export function deepSanitizeForStaff<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepSanitizeForStaff(item)) as T;
  }

  const result: any = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip forbidden keys
    if (STAFF_FORBIDDEN_FIELDS.includes(key as StaffForbiddenField)) {
      continue;
    }

    // Recursively sanitize nested objects
    result[key] = deepSanitizeForStaff(value);
  }

  return result as T;
}
