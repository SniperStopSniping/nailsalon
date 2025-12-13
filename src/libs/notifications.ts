/**
 * Notifications Library
 *
 * Server-side helpers for creating in-app notifications.
 * Used by admin decision handlers to notify staff.
 */

import { nanoid } from 'nanoid';

import { db } from '@/libs/DB';
import {
  notificationSchema,
  type NotificationType,
  type NotificationRecipientRole,
} from '@/models/Schema';

// =============================================================================
// TYPES
// =============================================================================

export interface CreateStaffNotificationParams {
  salonId: string;
  technicianId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAdminNotificationParams {
  salonId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// CREATE NOTIFICATIONS
// =============================================================================

/**
 * Create a notification for a specific staff member (technician).
 */
export async function createStaffNotification(
  params: CreateStaffNotificationParams,
): Promise<{ id: string }> {
  const { salonId, technicianId, type, title, body, metadata } = params;

  const id = `notif_${nanoid()}`;

  await db.insert(notificationSchema).values({
    id,
    salonId,
    recipientRole: 'STAFF' as NotificationRecipientRole,
    recipientTechnicianId: technicianId,
    type,
    title,
    body,
    metadata: metadata ?? null,
  });

  return { id };
}

/**
 * Create a notification for admin users (not tied to a specific technician).
 * Note: Currently not used but available for future admin notifications.
 */
export async function createAdminNotification(
  params: CreateAdminNotificationParams,
): Promise<{ id: string }> {
  const { salonId, type, title, body, metadata } = params;

  const id = `notif_${nanoid()}`;

  await db.insert(notificationSchema).values({
    id,
    salonId,
    recipientRole: 'ADMIN' as NotificationRecipientRole,
    recipientTechnicianId: null,
    type,
    title,
    body,
    metadata: metadata ?? null,
  });

  return { id };
}

// =============================================================================
// NOTIFICATION CONTENT BUILDERS
// =============================================================================

/**
 * Build notification content for time-off request decisions.
 */
export function buildTimeOffDecisionNotification(params: {
  status: 'APPROVED' | 'DENIED';
  startDate: Date;
  endDate: Date;
}): { title: string; body: string } {
  const { status, startDate, endDate } = params;

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const dateRange = `${formatDate(startDate)} – ${formatDate(endDate)}`;

  if (status === 'APPROVED') {
    return {
      title: 'Time off approved',
      body: `Your time off request (${dateRange}) was approved.`,
    };
  }

  return {
    title: 'Time off denied',
    body: `Your time off request (${dateRange}) was denied.`,
  };
}

/**
 * Build notification content for schedule override decisions.
 */
export function buildOverrideDecisionNotification(params: {
  status: 'APPROVED' | 'DENIED';
  date: string;
  type: 'off' | 'hours';
}): { title: string; body: string } {
  const { status, date, type } = params;

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const overrideDesc = type === 'off' ? 'day off' : 'custom hours';

  if (status === 'APPROVED') {
    return {
      title: 'Schedule change approved',
      body: `Your ${overrideDesc} request for ${formattedDate} was approved.`,
    };
  }

  return {
    title: 'Schedule change denied',
    body: `Your ${overrideDesc} request for ${formattedDate} was denied.`,
  };
}
