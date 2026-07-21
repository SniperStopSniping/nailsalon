/**
 * Salon Purge
 *
 * Single source of truth for destroying a salon's data in a foreign-key-safe
 * order. Used by the super-admin hard delete, the data reset route, and the
 * impact preview.
 *
 * Why this exists: the live database has 45 foreign keys pointing at `salon`,
 * 21 of them restrict-style (NO ACTION / RESTRICT). Deleting the salon means
 * clearing every one of them in dependency order. Getting the order wrong —
 * or running the deletes outside a transaction — leaves a tenant permanently
 * half-destroyed, which is exactly what happened before this module existed.
 *
 * Two rules govern every change here:
 *   1. Every step runs inside ONE transaction. Never accept the module-level
 *      `db` handle for writes — only a transaction handle.
 *   2. A CASCADE from `salon` does NOT protect an intermediate step. That
 *      cascade only fires when the salon row itself is deleted, which is last.
 *
 * Each step declares a single `where` predicate that is used both to count and
 * to delete, so the impact preview can never drift from what the purge does.
 */

import type { SQL } from 'drizzle-orm';
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import type { db } from '@/libs/DB';
import {
  addOnSchema,
  adminInviteSchema,
  appointmentAddOnSchema,
  appointmentAuditLogSchema,
  appointmentFinalItemSchema,
  appointmentPaymentSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  auditLogSchema,
  autopostQueueSchema,
  clientPreferencesSchema,
  fraudSignalSchema,
  googleCalendarDraftSchema,
  referralSchema,
  reviewSchema,
  rewardSchema,
  salonClientSchema,
  salonLocationSchema,
  salonPageAppearanceSchema,
  salonSchema,
  salonSignupInviteSchema,
  serviceAddOnSchema,
  serviceSchema,
  technicianBlockedSlotSchema,
  technicianScheduleOverrideSchema,
  technicianSchema,
  technicianServicesSchema,
  technicianTimeOffSchema,
} from '@/models/Schema';

/**
 * Structural handle covering both the pooled database and a transaction, and
 * both drivers (node-postgres in production, PGlite under Vitest). Mirrors the
 * `ConflictGuardTx` convention in src/libs/bookingConflictGuard.ts.
 */
export type PurgeTx = {
  select: typeof db.select;
  delete: typeof db.delete;
  update: typeof db.update;
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * Thrown when rows belonging to ANOTHER salon reference this salon's records.
 * Widening the delete predicates to clear them would destroy a third party's
 * data, so we refuse the purge instead and let a human decide.
 */
export class SalonPurgeBlockedError extends Error {
  readonly blockers: { table: string; column: string; count: number }[];

  constructor(blockers: { table: string; column: string; count: number }[]) {
    super(
      `Cannot purge salon: ${blockers.length} cross-tenant reference(s) still point at this salon's records (${blockers
        .map(b => `${b.table}.${b.column}`)
        .join(', ')}).`,
    );
    this.name = 'SalonPurgeBlockedError';
    this.blockers = blockers;
  }
}

// =============================================================================
// SUBQUERY HELPERS
// =============================================================================
// Each returns the set of this salon's ids for a given table, used as a
// subquery so a step never materializes ids in application memory.

const appointmentIdsOf = (tx: PurgeTx, salonId: string) =>
  tx.select({ id: appointmentSchema.id }).from(appointmentSchema).where(eq(appointmentSchema.salonId, salonId));

const technicianIdsOf = (tx: PurgeTx, salonId: string) =>
  tx.select({ id: technicianSchema.id }).from(technicianSchema).where(eq(technicianSchema.salonId, salonId));

const serviceIdsOf = (tx: PurgeTx, salonId: string) =>
  tx.select({ id: serviceSchema.id }).from(serviceSchema).where(eq(serviceSchema.salonId, salonId));

const addOnIdsOf = (tx: PurgeTx, salonId: string) =>
  tx.select({ id: addOnSchema.id }).from(addOnSchema).where(eq(addOnSchema.salonId, salonId));

const salonClientIdsOf = (tx: PurgeTx, salonId: string) =>
  tx.select({ id: salonClientSchema.id }).from(salonClientSchema).where(eq(salonClientSchema.salonId, salonId));

const referralIdsOf = (tx: PurgeTx, salonId: string) =>
  tx.select({ id: referralSchema.id }).from(referralSchema).where(eq(referralSchema.salonId, salonId));

async function countWhere(tx: PurgeTx, table: PgTable, where: SQL | undefined): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return Number(row?.n ?? 0);
}

// =============================================================================
// STEP DEFINITIONS
// =============================================================================

/**
 * Which category of a salon's data a step belongs to. The hard delete runs
 * every step; the reset route runs a subset.
 */
export type PurgeGroup =
  | 'appointments'
  /** Saved preferences and favourites — what the reset modal calls "Client Preferences". */
  | 'clients'
  /** The client records themselves (loyalty points, spend). Never cleared by a reset. */
  | 'client_records'
  | 'staff'
  | 'rewards'
  | 'catalog'
  | 'salon';

export type PurgeStep = {
  /** Physical table name. Used in counts, errors and the coverage guard test. */
  table: string;
  group: PurgeGroup;
  /** Why this step exists and why it sits at this position. */
  reason: string;
  /** Count the rows this step would affect, without writing. */
  count: (tx: PurgeTx, salonId: string) => Promise<number>;
  /** Delete or null out this salon's rows. */
  apply: (tx: PurgeTx, salonId: string) => Promise<void>;
};

type StepSpec = {
  table: string;
  group: PurgeGroup;
  reason: string;
  target: PgTable;
  where: (tx: PurgeTx, salonId: string) => SQL | undefined;
};

/** A step that deletes rows matching its predicate. */
function deleteStep(spec: StepSpec): PurgeStep {
  return {
    table: spec.table,
    group: spec.group,
    reason: spec.reason,
    count: (tx, salonId) => countWhere(tx, spec.target, spec.where(tx, salonId)),
    apply: async (tx, salonId) => {
      await tx.delete(spec.target).where(spec.where(tx, salonId));
    },
  };
}

/** A step that nulls out a column instead of deleting the row. */
function nullOutStep(spec: StepSpec & { set: Record<string, null> }): PurgeStep {
  return {
    table: spec.table,
    group: spec.group,
    reason: spec.reason,
    count: (tx, salonId) => countWhere(tx, spec.target, spec.where(tx, salonId)),
    apply: async (tx, salonId) => {
      await tx.update(spec.target).set(spec.set).where(spec.where(tx, salonId));
    },
  };
}

/**
 * Migration 0052 left two backup tables that are salon-scoped by their parent's
 * id but carry NO foreign key, so they are invisible to any FK-derived plan and
 * would be silently orphaned by the purge.
 */
function backupTableStep(spec: {
  table: string;
  group: PurgeGroup;
  parentTable: 'appointment' | 'salon_client';
}): PurgeStep {
  const scoped = (salonId: string) => sql`
    id in (select id from ${sql.identifier(spec.parentTable)} where salon_id = ${salonId})
  `;

  return {
    table: spec.table,
    group: spec.group,
    reason: `Migration 0052 backup table keyed by ${spec.parentTable}.id with no foreign key. Must precede the ${spec.parentTable} delete or the rows become unrecoverable orphans.`,
    count: async (tx, salonId) => {
      const result = await tx.execute(sql`
        select count(*)::int as n from ${sql.identifier(spec.table)} where ${scoped(salonId)}
      `);
      const rows = readRows(result);
      return Number(rows[0]?.n ?? 0);
    },
    apply: async (tx, salonId) => {
      await tx.execute(sql`delete from ${sql.identifier(spec.table)} where ${scoped(salonId)}`);
    },
  };
}

/** node-postgres returns { rows }, PGlite returns the array directly. */
function readRows(result: unknown): Record<string, unknown>[] {
  const r = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(r?.rows)) {
    return r.rows;
  }
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

/**
 * THE ORDERED PURGE PLAN.
 *
 * Order is load-bearing and was verified against the live foreign-key graph.
 * Read the `reason` on each step before moving one.
 */
export const SALON_PURGE_PLAN: PurgeStep[] = [
  deleteStep({
    table: 'fraud_signal',
    group: 'appointments',
    target: fraudSignalSchema,
    reason:
      'Must be first. fraud_signal.appointment_id and .salon_client_id are ON DELETE RESTRICT and NOT NULL. RESTRICT is enforced immediately, so a single row blocks the appointment delete.',
    where: (tx, salonId) =>
      or(
        eq(fraudSignalSchema.salonId, salonId),
        inArray(fraudSignalSchema.appointmentId, appointmentIdsOf(tx, salonId)),
        inArray(fraudSignalSchema.salonClientId, salonClientIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'review',
    group: 'appointments',
    target: reviewSchema,
    reason:
      'Four blocking NO ACTION foreign keys (appointment_id, salon_client_id, technician_id, salon_id) and nothing cascades into it.',
    where: (tx, salonId) =>
      or(
        eq(reviewSchema.salonId, salonId),
        inArray(reviewSchema.appointmentId, appointmentIdsOf(tx, salonId)),
        inArray(reviewSchema.salonClientId, salonClientIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'reward',
    group: 'rewards',
    target: rewardSchema,
    reason:
      'reward.used_in_appointment_id and .referral_id are NO ACTION, so rewards must go BEFORE appointments and BEFORE referrals. The old handler had this inverted.',
    where: (tx, salonId) =>
      or(
        eq(rewardSchema.salonId, salonId),
        inArray(rewardSchema.usedInAppointmentId, appointmentIdsOf(tx, salonId)),
        inArray(rewardSchema.referralId, referralIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'google_calendar_draft',
    group: 'appointments',
    target: googleCalendarDraftSchema,
    reason:
      'Trap: its salon_id IS cascade, but that only fires when the salon row goes (last). converted_appointment_id is NO ACTION and blocks the appointment delete long before then.',
    where: (tx, salonId) =>
      or(
        eq(googleCalendarDraftSchema.salonId, salonId),
        inArray(googleCalendarDraftSchema.convertedAppointmentId, appointmentIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'appointment_photo',
    group: 'appointments',
    target: appointmentPhotoSchema,
    reason:
      'Cascades off appointment, but salon_id and uploaded_by_tech_id are both NO ACTION. Explicit so no orphan can block the salon or technician delete.',
    where: (tx, salonId) =>
      or(
        eq(appointmentPhotoSchema.salonId, salonId),
        inArray(appointmentPhotoSchema.appointmentId, appointmentIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'appointment_final_item',
    group: 'appointments',
    target: appointmentFinalItemSchema,
    reason: 'salon_id is NO ACTION NOT NULL; catalog_service_id and catalog_add_on_id are NO ACTION.',
    where: (tx, salonId) =>
      or(
        eq(appointmentFinalItemSchema.salonId, salonId),
        inArray(appointmentFinalItemSchema.appointmentId, appointmentIdsOf(tx, salonId)),
        inArray(appointmentFinalItemSchema.catalogServiceId, serviceIdsOf(tx, salonId)),
        inArray(appointmentFinalItemSchema.catalogAddOnId, addOnIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'appointment_payment',
    group: 'appointments',
    target: appointmentPaymentSchema,
    reason: 'appointment_payment.salon_id is NO ACTION NOT NULL (appointment_id cascades).',
    where: (tx, salonId) =>
      or(
        eq(appointmentPaymentSchema.salonId, salonId),
        inArray(appointmentPaymentSchema.appointmentId, appointmentIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'appointment_audit_log',
    group: 'appointments',
    target: appointmentAuditLogSchema,
    reason: 'appointment_audit_log.salon_id is NO ACTION NOT NULL (appointment_id cascades).',
    where: (tx, salonId) =>
      or(
        eq(appointmentAuditLogSchema.salonId, salonId),
        inArray(appointmentAuditLogSchema.appointmentId, appointmentIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'autopost_queue',
    group: 'appointments',
    target: autopostQueueSchema,
    reason: 'autopost_queue.salon_id is NO ACTION NOT NULL (appointment_id cascades).',
    where: (tx, salonId) =>
      or(
        eq(autopostQueueSchema.salonId, salonId),
        inArray(autopostQueueSchema.appointmentId, appointmentIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'appointment_services',
    group: 'appointments',
    target: appointmentServicesSchema,
    reason:
      'No salon_id column. The service_id arm is load-bearing: service_id is NO ACTION NOT NULL, so these rows must be gone before the service delete.',
    where: (tx, salonId) =>
      or(
        inArray(appointmentServicesSchema.appointmentId, appointmentIdsOf(tx, salonId)),
        inArray(appointmentServicesSchema.serviceId, serviceIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'appointment_add_on',
    group: 'appointments',
    target: appointmentAddOnSchema,
    reason: 'No salon_id column. The add_on_id arm is load-bearing: add_on_id is NO ACTION.',
    where: (tx, salonId) =>
      or(
        inArray(appointmentAddOnSchema.appointmentId, appointmentIdsOf(tx, salonId)),
        inArray(appointmentAddOnSchema.addOnId, addOnIdsOf(tx, salonId)),
      ),
  }),
  backupTableStep({
    table: 'luster_migration_backup_0052_appointment_times',
    group: 'appointments',
    parentTable: 'appointment',
  }),
  deleteStep({
    table: 'appointment',
    group: 'appointments',
    target: appointmentSchema,
    reason:
      'One statement. Cascades appointment_access_token, appointment_artifacts, appointment_payment_link, integration_outbox, notification_delivery and retention_campaign_redemption; SET NULLs client_communication, google_calendar_event and retention_campaign.',
    where: (_tx, salonId) => eq(appointmentSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'client_preferences',
    group: 'clients',
    target: clientPreferencesSchema,
    reason: 'salon_id is NO ACTION NOT NULL and favorite_tech_id is NO ACTION. Must precede the technician delete.',
    where: (_tx, salonId) => eq(clientPreferencesSchema.salonId, salonId),
  }),
  backupTableStep({
    table: 'luster_migration_backup_0052_client_times',
    group: 'client_records',
    parentTable: 'salon_client',
  }),
  deleteStep({
    table: 'salon_client',
    group: 'client_records',
    target: salonClientSchema,
    reason:
      'salon_id is NO ACTION NOT NULL. Must come AFTER appointment (appointment.salon_client_id is RESTRICT) and BEFORE technician (preferred_technician_id is NO ACTION). Cascades client_communication and retention_campaign.',
    where: (_tx, salonId) => eq(salonClientSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'referral',
    group: 'rewards',
    target: referralSchema,
    reason: 'salon_id is NO ACTION NOT NULL. Must follow reward (reward.referral_id is NO ACTION).',
    where: (_tx, salonId) => eq(referralSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'technician_services',
    group: 'staff',
    target: technicianServicesSchema,
    reason:
      'No salon_id column and BOTH foreign keys are NO ACTION NOT NULL, so neither can be nulled and no cascade ever clears it. Blocks the technician AND the service delete.',
    where: (tx, salonId) =>
      or(
        inArray(technicianServicesSchema.technicianId, technicianIdsOf(tx, salonId)),
        inArray(technicianServicesSchema.serviceId, serviceIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'technician_blocked_slot',
    group: 'staff',
    target: technicianBlockedSlotSchema,
    reason: 'technician_id cascades, but salon_id is NO ACTION NOT NULL.',
    where: (tx, salonId) =>
      or(
        eq(technicianBlockedSlotSchema.salonId, salonId),
        inArray(technicianBlockedSlotSchema.technicianId, technicianIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'technician_schedule_override',
    group: 'staff',
    target: technicianScheduleOverrideSchema,
    reason: 'technician_id cascades, but salon_id is NO ACTION NOT NULL.',
    where: (tx, salonId) =>
      or(
        eq(technicianScheduleOverrideSchema.salonId, salonId),
        inArray(technicianScheduleOverrideSchema.technicianId, technicianIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'technician_time_off',
    group: 'staff',
    target: technicianTimeOffSchema,
    reason: 'technician_id cascades, but salon_id is NO ACTION NOT NULL.',
    where: (tx, salonId) =>
      or(
        eq(technicianTimeOffSchema.salonId, salonId),
        inArray(technicianTimeOffSchema.technicianId, technicianIdsOf(tx, salonId)),
      ),
  }),
  deleteStep({
    table: 'technician',
    group: 'staff',
    target: technicianSchema,
    reason: 'salon_id is NO ACTION NOT NULL. Cascades staff_session, time_off_request and notification.',
    where: (_tx, salonId) => eq(technicianSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'service_add_on',
    group: 'catalog',
    target: serviceAddOnSchema,
    reason: 'Cascades from both service and add_on, but cleared explicitly so ordering never depends on cascade timing.',
    where: (_tx, salonId) => eq(serviceAddOnSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'service',
    group: 'catalog',
    target: serviceSchema,
    reason:
      'salon_id is NO ACTION NOT NULL. Every referrer (appointment_services, technician_services, appointment_final_item) is already gone by this point.',
    where: (_tx, salonId) => eq(serviceSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'add_on',
    group: 'catalog',
    target: addOnSchema,
    reason: 'salon_id cascades from salon, but cleared here so appointment_add_on ordering is explicit.',
    where: (_tx, salonId) => eq(addOnSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'salon_page_appearance',
    group: 'salon',
    target: salonPageAppearanceSchema,
    reason: 'salon_id is NO ACTION NOT NULL.',
    where: (_tx, salonId) => eq(salonPageAppearanceSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'admin_invite',
    group: 'salon',
    target: adminInviteSchema,
    reason:
      'salon_id is NO ACTION. MUST be deleted, never nulled: admin_invite_role_salon_check forbids a NULL salon_id when role = ADMIN, so a null-out throws 23514 and rolls back the whole purge.',
    where: (_tx, salonId) => eq(adminInviteSchema.salonId, salonId),
  }),
  deleteStep({
    table: 'salon_location',
    group: 'salon',
    target: salonLocationSchema,
    reason: 'Cascades from salon, but technician.primary_location_id is SET NULL so this is cleanest after the technician delete.',
    where: (_tx, salonId) => eq(salonLocationSchema.salonId, salonId),
  }),
  nullOutStep({
    table: 'audit_log',
    group: 'salon',
    target: auditLogSchema,
    set: { salonId: null },
    reason:
      'NULL OUT, do not delete: salon_id is nullable with no CHECK constraint, so the platform audit trail (including the record of this deletion) survives the purge.',
    where: (_tx, salonId) => eq(auditLogSchema.salonId, salonId),
  }),
  nullOutStep({
    table: 'salon_signup_invite',
    group: 'salon',
    target: salonSignupInviteSchema,
    set: { resultSalonId: null },
    reason:
      'NULL OUT result_salon_id (nullable, no CHECK on this column). Load-bearing, not defensive: live rows exist with salon_id NULL and a real result_salon_id, so the cascade arm provably does not fire for them.',
    where: (_tx, salonId) => eq(salonSignupInviteSchema.resultSalonId, salonId),
  }),
  deleteStep({
    table: 'salon',
    group: 'salon',
    target: salonSchema,
    reason: 'Last. Cascades the remaining CASCADE children (memberships, sessions, integrations, policies, salon_audit_log).',
    where: (_tx, salonId) => eq(salonSchema.id, salonId),
  }),
];

// =============================================================================
// PRE-FLIGHT: CROSS-TENANT ASSERTION
// =============================================================================

/**
 * Several tables carry nullable NO ACTION foreign keys to this salon's
 * technician / service / add_on / salon_client. A row owned by ANOTHER salon
 * pointing at one of them would block the technician or service delete — but
 * only after most of the purge had already run.
 *
 * Widening the delete predicates to sweep those rows up would destroy a third
 * party's data, so instead we detect them up front and refuse. Runs inside the
 * transaction, before the first delete, so it aborts harmlessly.
 */
export async function assertNoCrossTenantReferences(tx: PurgeTx, salonId: string): Promise<void> {
  const techIds = technicianIdsOf(tx, salonId);
  const svcIds = serviceIdsOf(tx, salonId);
  const addOnIds = addOnIdsOf(tx, salonId);
  const clientIds = salonClientIdsOf(tx, salonId);

  const probes: { table: string; column: string; from: PgTable; where: SQL | undefined }[] = [
    {
      table: 'appointment',
      column: 'technician_id',
      from: appointmentSchema,
      where: and(ne(appointmentSchema.salonId, salonId), inArray(appointmentSchema.technicianId, techIds)),
    },
    {
      table: 'appointment',
      column: 'review_followup_sent_by',
      from: appointmentSchema,
      where: and(ne(appointmentSchema.salonId, salonId), inArray(appointmentSchema.reviewFollowupSentBy, techIds)),
    },
    {
      table: 'appointment',
      column: 'salon_client_id',
      from: appointmentSchema,
      where: and(ne(appointmentSchema.salonId, salonId), inArray(appointmentSchema.salonClientId, clientIds)),
    },
    {
      table: 'review',
      column: 'technician_id',
      from: reviewSchema,
      where: and(ne(reviewSchema.salonId, salonId), inArray(reviewSchema.technicianId, techIds)),
    },
    {
      table: 'appointment_photo',
      column: 'uploaded_by_tech_id',
      from: appointmentPhotoSchema,
      where: and(ne(appointmentPhotoSchema.salonId, salonId), inArray(appointmentPhotoSchema.uploadedByTechId, techIds)),
    },
    {
      table: 'client_preferences',
      column: 'favorite_tech_id',
      from: clientPreferencesSchema,
      where: and(ne(clientPreferencesSchema.salonId, salonId), inArray(clientPreferencesSchema.favoriteTechId, techIds)),
    },
    {
      table: 'salon_client',
      column: 'preferred_technician_id',
      from: salonClientSchema,
      where: and(ne(salonClientSchema.salonId, salonId), inArray(salonClientSchema.preferredTechnicianId, techIds)),
    },
    {
      table: 'appointment_final_item',
      column: 'catalog_service_id',
      from: appointmentFinalItemSchema,
      where: and(
        ne(appointmentFinalItemSchema.salonId, salonId),
        inArray(appointmentFinalItemSchema.catalogServiceId, svcIds),
      ),
    },
    {
      table: 'appointment_final_item',
      column: 'catalog_add_on_id',
      from: appointmentFinalItemSchema,
      where: and(
        ne(appointmentFinalItemSchema.salonId, salonId),
        inArray(appointmentFinalItemSchema.catalogAddOnId, addOnIds),
      ),
    },
  ];

  const blockers: { table: string; column: string; count: number }[] = [];

  for (const probe of probes) {
    const count = await countWhere(tx, probe.from, probe.where);
    if (count > 0) {
      blockers.push({ table: probe.table, column: probe.column, count });
    }
  }

  if (blockers.length > 0) {
    throw new SalonPurgeBlockedError(blockers);
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

export type PurgeResult = {
  /** Rows affected per table, in execution order. Zero-count steps are omitted. */
  counts: Record<string, number>;
  totalRows: number;
};

/**
 * Permanently destroy a salon and everything belonging to it.
 *
 * MUST be called with a transaction handle — a partial purge is worse than no
 * purge. Throws SalonPurgeBlockedError when another salon's rows reference this
 * one; callers should map that to a 409.
 */
export async function purgeSalonData(tx: PurgeTx, salonId: string): Promise<PurgeResult> {
  await assertNoCrossTenantReferences(tx, salonId);

  const counts: Record<string, number> = {};
  let totalRows = 0;

  for (const step of SALON_PURGE_PLAN) {
    const affected = await step.count(tx, salonId);
    await step.apply(tx, salonId);
    if (affected > 0) {
      counts[step.table] = affected;
      totalRows += affected;
    }
  }

  return { counts, totalRows };
}

/**
 * Run only the steps in the given groups — used by the data reset route, which
 * clears categories of data without removing the salon itself.
 */
export async function purgeSalonGroups(
  tx: PurgeTx,
  salonId: string,
  groups: PurgeGroup[],
): Promise<PurgeResult> {
  await assertNoCrossTenantReferences(tx, salonId);
  await unlinkGroupReferences(tx, salonId, groups);

  const counts: Record<string, number> = {};
  let totalRows = 0;

  for (const step of SALON_PURGE_PLAN) {
    if (step.group === 'salon' || !groups.includes(step.group)) {
      continue;
    }
    const affected = await step.count(tx, salonId);
    await step.apply(tx, salonId);
    if (affected > 0) {
      counts[step.table] = affected;
      totalRows += affected;
    }
  }

  return { counts, totalRows };
}

/**
 * Null out the nullable references that survive a partial reset. Without this,
 * resetting staff while keeping appointments fails on appointment.technician_id,
 * and resetting clients fails on the RESTRICT appointment.salon_client_id.
 */
async function unlinkGroupReferences(tx: PurgeTx, salonId: string, groups: PurgeGroup[]): Promise<void> {
  if (groups.includes('staff')) {
    // Every nullable NO ACTION referrer of `technician`. Nulling them is a no-op
    // when the referring rows are being deleted too, and the difference between
    // working and failing when they are not.
    await tx
      .update(appointmentSchema)
      .set({ technicianId: null })
      .where(and(eq(appointmentSchema.salonId, salonId), isNotNull(appointmentSchema.technicianId)));
    await tx
      .update(appointmentSchema)
      .set({ reviewFollowupSentBy: null })
      .where(and(eq(appointmentSchema.salonId, salonId), isNotNull(appointmentSchema.reviewFollowupSentBy)));
    await tx
      .update(appointmentPhotoSchema)
      .set({ uploadedByTechId: null })
      .where(and(eq(appointmentPhotoSchema.salonId, salonId), isNotNull(appointmentPhotoSchema.uploadedByTechId)));
    await tx
      .update(reviewSchema)
      .set({ technicianId: null })
      .where(and(eq(reviewSchema.salonId, salonId), isNotNull(reviewSchema.technicianId)));
    await tx
      .update(clientPreferencesSchema)
      .set({ favoriteTechId: null })
      .where(and(eq(clientPreferencesSchema.salonId, salonId), isNotNull(clientPreferencesSchema.favoriteTechId)));
    await tx
      .update(salonClientSchema)
      .set({ preferredTechnicianId: null })
      .where(and(eq(salonClientSchema.salonId, salonId), isNotNull(salonClientSchema.preferredTechnicianId)));
  }

  if (groups.includes('client_records')) {
    // appointment.salon_client_id is RESTRICT, so it must be released before the
    // client records can go.
    await tx
      .update(appointmentSchema)
      .set({ salonClientId: null })
      .where(and(eq(appointmentSchema.salonId, salonId), isNotNull(appointmentSchema.salonClientId)));
  }

  if (groups.includes('appointments')) {
    // reward.used_in_appointment_id is NO ACTION and rewards are a separate
    // group, so a redeemed reward blocks an appointments-only reset. Nulling it
    // keeps the reward and its points while releasing the appointment.
    await tx
      .update(rewardSchema)
      .set({ usedInAppointmentId: null })
      .where(and(eq(rewardSchema.salonId, salonId), isNotNull(rewardSchema.usedInAppointmentId)));
  }
}

/**
 * Count what a purge would affect, without writing anything. Backs the impact
 * preview in the delete/reset modals and the snapshot recorded in the audit log
 * before a hard delete.
 */
export async function countSalonImpact(handle: PurgeTx, salonId: string): Promise<PurgeResult> {
  const counts: Record<string, number> = {};
  let totalRows = 0;

  for (const step of SALON_PURGE_PLAN) {
    const n = await step.count(handle, salonId);
    if (n > 0) {
      counts[step.table] = n;
      totalRows += n;
    }
  }

  return { counts, totalRows };
}
