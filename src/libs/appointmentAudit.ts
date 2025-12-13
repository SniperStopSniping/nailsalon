/**
 * Appointment Audit Logging Helper
 *
 * Step 16A - Provides immutable audit trail for all appointment changes.
 *
 * Usage:
 * ```typescript
 * import { logAppointmentChange } from '@/libs/appointmentAudit';
 *
 * await logAppointmentChange({
 *   appointmentId: 'appt_123',
 *   salonId: 'salon_456',
 *   action: 'tech_reassigned',
 *   performedBy: 'user_789',
 *   performedByRole: 'admin',
 *   performedByName: 'Jane Admin',
 *   previousValue: { technicianId: 'tech_old' },
 *   newValue: { technicianId: 'tech_new' },
 *   reason: 'Original tech called in sick',
 * });
 * ```
 */

import { db } from '@/libs/DB';
import {
  type AppointmentAuditAction,
  appointmentAuditLogSchema,
  type AuditPerformerRole,
} from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

export type LogAppointmentChangeParams = {
  appointmentId: string;
  salonId: string;
  action: AppointmentAuditAction;
  performedBy: string;
  performedByRole: AuditPerformerRole;
  performedByName?: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
};

// =============================================================================
// Main Logging Function
// =============================================================================

/**
 * Log an appointment change to the immutable audit log.
 *
 * This function is designed to never throw - audit logging should not
 * break the main operation. Errors are logged to console.
 */
export async function logAppointmentChange(
  params: LogAppointmentChangeParams,
): Promise<void> {
  try {
    await db.insert(appointmentAuditLogSchema).values({
      id: `audit_${crypto.randomUUID()}`,
      appointmentId: params.appointmentId,
      salonId: params.salonId,
      action: params.action,
      performedBy: params.performedBy,
      performedByRole: params.performedByRole,
      performedByName: params.performedByName ?? null,
      previousValue: params.previousValue ?? null,
      newValue: params.newValue ?? null,
      reason: params.reason ?? null,
    });
  } catch (error) {
    // Never throw - audit logging should not break operations
    console.error('[AUDIT LOG ERROR] Failed to log appointment change:', {
      params,
      error,
    });
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Log appointment creation
 */
export async function logAppointmentCreated(
  appointmentId: string,
  salonId: string,
  performedBy: string,
  performedByRole: AuditPerformerRole,
  appointmentData: Record<string, unknown>,
  performedByName?: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'created',
    performedBy,
    performedByRole,
    performedByName,
    newValue: appointmentData,
  });
}

/**
 * Log appointment status change
 */
export async function logStatusChange(
  appointmentId: string,
  salonId: string,
  performedBy: string,
  performedByRole: AuditPerformerRole,
  previousStatus: string,
  newStatus: string,
  reason?: string,
  performedByName?: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'status_changed',
    performedBy,
    performedByRole,
    performedByName,
    previousValue: { status: previousStatus },
    newValue: { status: newStatus },
    reason,
  });
}

/**
 * Log technician reassignment
 */
export async function logTechReassignment(
  appointmentId: string,
  salonId: string,
  performedBy: string,
  performedByRole: AuditPerformerRole,
  previousTechId: string | null,
  newTechId: string,
  reason?: string,
  performedByName?: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'tech_reassigned',
    performedBy,
    performedByRole,
    performedByName,
    previousValue: { technicianId: previousTechId },
    newValue: { technicianId: newTechId },
    reason,
  });
}

/**
 * Log appointment locking
 */
export async function logAppointmentLocked(
  appointmentId: string,
  salonId: string,
  lockedBy: string,
  lockedByName?: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'locked',
    performedBy: `staff:${lockedBy}`,
    performedByRole: 'staff',
    performedByName: lockedByName,
    newValue: { lockedAt: new Date().toISOString(), lockedBy },
  });
}

/**
 * Log admin override (unlocking a locked appointment)
 */
export async function logAdminOverride(
  appointmentId: string,
  salonId: string,
  adminId: string,
  adminName: string,
  overrideType: string,
  previousValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'admin_override',
    performedBy: adminId,
    performedByRole: 'admin',
    performedByName: adminName,
    previousValue: { ...previousValue, overrideType },
    newValue,
    reason,
  });
}

/**
 * Log client arrival
 */
export async function logClientArrival(
  appointmentId: string,
  salonId: string,
  performedBy: string,
  performedByRole: AuditPerformerRole,
  wasLate: boolean,
  performedByName?: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'arrived',
    performedBy,
    performedByRole,
    performedByName,
    newValue: {
      arrivedAt: new Date().toISOString(),
      wasLate,
    },
  });
}

/**
 * Log tech notes update
 */
export async function logNotesUpdated(
  appointmentId: string,
  salonId: string,
  technicianId: string,
  technicianName?: string,
): Promise<void> {
  await logAppointmentChange({
    appointmentId,
    salonId,
    action: 'notes_updated',
    performedBy: `staff:${technicianId}`,
    performedByRole: 'staff',
    performedByName: technicianName,
    // Note: We intentionally don't log the actual note content for privacy
    newValue: { notesUpdatedAt: new Date().toISOString() },
  });
}
