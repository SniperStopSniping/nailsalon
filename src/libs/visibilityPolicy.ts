/**
 * Visibility Policy Helper
 *
 * Resolves salon visibility policies with defaults.
 * Used by API routes to determine what fields to include in responses.
 */

import type {
  ResolvedStaffVisibility,
  SalonVisibilityPolicy,
  ViewerRole,
} from '@/types/salonPolicy';

// =============================================================================
// DEFAULTS
// =============================================================================

/**
 * Default visibility settings for staff when salon has no policy configured.
 *
 * Day 1 Ship Defaults:
 * - showClientPhone: true (staff needs to contact clients)
 * - showClientEmail: false (rarely needed)
 * - showClientFullName: true (personalization)
 * - showAppointmentPrice: true (staff sees what client pays)
 * - showClientHistory: false (privacy by default)
 * - showClientNotes: true (service quality)
 * - showOtherTechAppointments: false (staff only sees own)
 */
export const STAFF_VISIBILITY_DEFAULTS: ResolvedStaffVisibility = {
  showClientPhone: true,
  showClientEmail: false,
  showClientFullName: true,
  showAppointmentPrice: true,
  showClientHistory: false,
  showClientNotes: true,
  showOtherTechAppointments: false,
};

// =============================================================================
// POLICY RESOLVER
// =============================================================================

/**
 * Get effective visibility settings for a given role.
 *
 * @param policy - Salon's visibility policy (can be null/undefined)
 * @param role - Viewer's role (super_admin, admin, staff)
 * @returns 'full_access' for admin/super_admin, or resolved staff visibility
 */
export function getEffectiveVisibility(
  policy: SalonVisibilityPolicy | null | undefined,
  role: ViewerRole,
): ResolvedStaffVisibility | 'full_access' {
  // Super admin and admin see everything - no redaction
  if (role === 'super_admin' || role === 'admin') {
    return 'full_access';
  }

  // Staff: merge salon policy with defaults
  const staffPolicy = policy?.staff ?? {};

  return {
    showClientPhone:
      staffPolicy.showClientPhone ?? STAFF_VISIBILITY_DEFAULTS.showClientPhone,
    showClientEmail:
      staffPolicy.showClientEmail ?? STAFF_VISIBILITY_DEFAULTS.showClientEmail,
    showClientFullName:
      staffPolicy.showClientFullName
      ?? STAFF_VISIBILITY_DEFAULTS.showClientFullName,
    showAppointmentPrice:
      staffPolicy.showAppointmentPrice
      ?? STAFF_VISIBILITY_DEFAULTS.showAppointmentPrice,
    showClientHistory:
      staffPolicy.showClientHistory
      ?? STAFF_VISIBILITY_DEFAULTS.showClientHistory,
    showClientNotes:
      staffPolicy.showClientNotes ?? STAFF_VISIBILITY_DEFAULTS.showClientNotes,
    showOtherTechAppointments:
      staffPolicy.showOtherTechAppointments
      ?? STAFF_VISIBILITY_DEFAULTS.showOtherTechAppointments,
  };
}
