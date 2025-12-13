/**
 * Audit Log Helper
 *
 * Logs critical actions for debugging, compliance, and abuse detection.
 * Fire-and-forget: failures don't break the main flow.
 *
 * IMPORTANT: Do NOT log raw PII (phone numbers, emails, names).
 * Use entity IDs (salonClientId, referralId, rewardId) for correlation.
 */

import { db } from '@/libs/DB';
import { type AuditLogAction, auditLogSchema } from '@/models/Schema';

// =============================================================================
// TYPES
// =============================================================================

export type ActorType = 'admin' | 'staff' | 'client' | 'system' | 'webhook' | 'super_admin';

export type AuditLogEntry = {
  salonId?: string | null;
  actorType: ActorType;
  actorId?: string | null; // technicianId, adminUserId, salonClientId, etc.
  action: AuditLogAction;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
};

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Log an audit event. Fire-and-forget (doesn't throw).
 * Use this for all critical actions that need tracking.
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(auditLogSchema).values({
      id: `audit_${crypto.randomUUID()}`,
      salonId: entry.salonId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      actorPhone: null, // Intentionally not stored - use actorId for correlation
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (error) {
    // Fire-and-forget: log but don't throw
    console.error('[AuditLog] Failed to write audit log:', error);
  }
}

// =============================================================================
// CONVENIENCE HELPERS
// =============================================================================

/**
 * Log billing mode change
 */
export function logBillingModeChange(
  salonId: string,
  oldMode: string | null,
  newMode: string,
  actorType: ActorType = 'webhook',
  ip?: string,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType,
    action: 'billing_mode_changed',
    entityType: 'salon',
    entityId: salonId,
    metadata: { oldMode, newMode },
    ip,
  });
}

/**
 * Log subscription status change
 */
export function logSubscriptionStatusChange(
  salonId: string,
  oldStatus: string | null,
  newStatus: string,
  subscriptionId?: string,
  ip?: string,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType: 'webhook',
    action: 'subscription_status_changed',
    entityType: 'subscription',
    entityId: subscriptionId,
    metadata: { oldStatus, newStatus },
    ip,
  });
}

/**
 * Log reward granted
 */
export function logRewardGranted(
  salonId: string,
  rewardId: string,
  rewardType: string,
  points: number,
  salonClientId: string,
  actorType: ActorType = 'system',
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType,
    actorId: actorType === 'client' ? salonClientId : null,
    action: 'reward_granted',
    entityType: 'reward',
    entityId: rewardId,
    metadata: { rewardType, points, salonClientId },
  });
}

/**
 * Log referral claimed
 */
export function logReferralClaimed(
  salonId: string,
  referralId: string,
  salonClientId: string,
  ip?: string,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType: 'client',
    actorId: salonClientId,
    action: 'referral_claimed',
    entityType: 'referral',
    entityId: referralId,
    ip,
  });
}

/**
 * Log referral completed (referrer gets bonus)
 */
export function logReferralCompleted(
  salonId: string,
  referralId: string,
  referrerRewardId: string,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType: 'system',
    action: 'referral_completed',
    entityType: 'referral',
    entityId: referralId,
    metadata: { referrerRewardId },
  });
}

/**
 * Log review created
 */
export function logReviewCreated(
  salonId: string,
  reviewId: string,
  appointmentId: string,
  rating: number,
  salonClientId: string,
  ip?: string,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType: 'client',
    actorId: salonClientId,
    action: 'review_created',
    entityType: 'review',
    entityId: reviewId,
    metadata: { appointmentId, rating },
    ip,
  });
}

/**
 * Log review hidden by admin
 */
export function logReviewHidden(
  salonId: string,
  reviewId: string,
  adminId: string,
  reason?: string,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType: 'admin',
    actorId: adminId,
    action: 'review_hidden',
    entityType: 'review',
    entityId: reviewId,
    metadata: { reason },
  });
}

/**
 * Log appointment completed (triggers rewards)
 */
export function logAppointmentCompleted(
  salonId: string,
  appointmentId: string,
  technicianId: string,
  triggeredRewards?: string[],
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType: 'system',
    action: 'appointment_completed',
    entityType: 'appointment',
    entityId: appointmentId,
    metadata: { technicianId, triggeredRewards },
  });
}

/**
 * Log settings updated (admin or super-admin)
 */
export function logSettingsUpdated(
  salonId: string,
  actorType: 'admin' | 'super_admin',
  actorId: string,
  changedFields: string[],
  changes: Record<string, { before: unknown; after: unknown }>,
): Promise<void> {
  return logAuditEvent({
    salonId,
    actorType,
    actorId,
    action: 'settings_updated',
    entityType: 'salon',
    entityId: salonId,
    metadata: { changedFields, changes },
  });
}
