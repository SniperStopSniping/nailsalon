import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type { ReceiptProjection } from '@/libs/deposits/shadowProjection';

export type ShadowEvidence = Record<string, unknown>;
export type DepositShadowObjectKind = 'refund' | 'charge' | 'dispute';
export type DepositShadowDispatchKnowledge =
  | 'recorded'
  | 'dispatch_in_progress'
  | 'outcome_unknown'
  | 'provider_pending'
  | 'provider_requires_action'
  | 'provider_succeeded'
  | 'provider_failed'
  | 'provider_canceled'
  | 'rejected_before_execution'
  | 'unknown';
export type DepositShadowObligationState =
  | 'open'
  | 'satisfied_by_verified_returns'
  | 'resolution_required';

export const depositShadowStateSchema = pgTable(
  'deposit_shadow_state',
  {
    depositId: text('deposit_id').primaryKey(),
    salonId: text('salon_id').notNull(),
    appointmentId: text('appointment_id').notNull(),
    account: text('account').notNull(),
    livemode: boolean('livemode').notNull(),
    paymentIntentId: text('payment_intent_id'),
    chargeId: text('charge_id'),
    engine: text('engine').$type<'legacy'>().default('legacy').notNull(),
    generation: integer('generation').default(0).notNull(),
    version: integer('version').default(0).notNull(),
    fence: integer('fence').default(0).notNull(),
    leaseUntil: timestamp('lease_until', { mode: 'date', withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    oldestUnresolvedAt: timestamp('oldest_unresolved_at', { mode: 'date', withTimezone: true })
      .defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { mode: 'date', withTimezone: true }),
    lastClaimedAt: timestamp('last_claimed_at', { mode: 'date', withTimezone: true }),
    lastCompleteAt: timestamp('last_complete_at', { mode: 'date', withTimezone: true }),
    workClass: text('work_class').default('discovery').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    reason: text('reason').default('historical_unknown'),
    certificate: jsonb('certificate').$type<ShadowEvidence>(),
    cursor: jsonb('cursor').$type<ShadowEvidence>(),
    legacyFingerprint: text('legacy_fingerprint'),
  },
  table => ({
    identityUniq: uniqueIndex('deposit_shadow_state_identity_uniq').on(
      table.salonId,
      table.depositId,
      table.account,
      table.livemode,
    ),
    fairDueIdx: index('deposit_shadow_state_fair_due_idx').on(
      table.nextDueAt,
      table.salonId,
      table.account,
      table.livemode,
      table.workClass,
      table.depositId,
    ),
    engineValid: check('deposit_shadow_state_engine_check', sql`${table.engine} = 'legacy'`),
    generationValid: check('deposit_shadow_state_generation_check', sql`${table.generation} >= 0`),
    versionValid: check('deposit_shadow_state_version_check', sql`${table.version} >= 0`),
    fenceValid: check('deposit_shadow_state_fence_check', sql`${table.fence} >= 0`),
    attemptsValid: check('deposit_shadow_state_attempts_check', sql`${table.attempts} >= 0`),
  }),
);

export const depositShadowReceiptSchema = pgTable(
  'deposit_shadow_receipt',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    account: text('account'),
    livemode: boolean('livemode').notNull(),
    providerCreated: bigint('provider_created', { mode: 'number' }),
    apiVersion: text('api_version'),
    projection: jsonb('projection').$type<ReceiptProjection>().notNull(),
    receivedAt: timestamp('received_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    depositId: text('deposit_id'),
    salonId: text('salon_id'),
    generation: integer('generation'),
    nextDueAt: timestamp('next_due_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
    reason: text('reason'),
  },
  table => ({
    dueIdx: index('deposit_shadow_receipt_due_idx')
      .on(table.nextDueAt, table.eventId)
      .where(sql`${table.completedAt} IS NULL`),
    projectionObject: check(
      'deposit_shadow_receipt_projection_object_check',
      sql`jsonb_typeof(${table.projection}) = 'object'`,
    ),
    attemptsValid: check('deposit_shadow_receipt_attempts_check', sql`${table.attempts} >= 0`),
    generationValid: check(
      'deposit_shadow_receipt_generation_check',
      sql`${table.generation} IS NULL OR ${table.generation} >= 0`,
    ),
  }),
);

export const depositShadowCommandSchema = pgTable(
  'deposit_shadow_command',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull(),
    depositId: text('deposit_id').notNull(),
    account: text('account').notNull(),
    livemode: boolean('livemode').notNull(),
    paymentIntentId: text('payment_intent_id'),
    intendedCents: integer('intended_cents'),
    currency: text('currency'),
    requestedAt: timestamp('requested_at', { mode: 'date', withTimezone: true }),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    reason: text('reason'),
    source: text('source').$type<'legacy_import'>().default('legacy_import').notNull(),
    obligationState: text('obligation_state')
      .$type<DepositShadowObligationState>()
      .default('resolution_required')
      .notNull(),
    evidence: jsonb('evidence').$type<ShadowEvidence>().notNull(),
  },
  table => ({
    stateFk: foreignKey({
      name: 'deposit_shadow_command_state_fk',
      columns: [table.salonId, table.depositId, table.account, table.livemode],
      foreignColumns: [
        depositShadowStateSchema.salonId,
        depositShadowStateSchema.depositId,
        depositShadowStateSchema.account,
        depositShadowStateSchema.livemode,
      ],
    }).onDelete('restrict'),
    intendedCentsValid: check(
      'deposit_shadow_command_intended_cents_check',
      sql`${table.intendedCents} IS NULL OR ${table.intendedCents} > 0`,
    ),
    sourceValid: check('deposit_shadow_command_source_check', sql`${table.source} = 'legacy_import'`),
    obligationStateValid: check(
      'deposit_shadow_command_obligation_state_check',
      sql`${table.obligationState} IN ('open', 'satisfied_by_verified_returns', 'resolution_required')`,
    ),
    evidenceObject: check(
      'deposit_shadow_command_evidence_object_check',
      sql`jsonb_typeof(${table.evidence}) = 'object'`,
    ),
  }),
);

export const depositShadowAttemptSchema = pgTable(
  'deposit_shadow_attempt',
  {
    id: text('id').primaryKey(),
    commandId: text('command_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    intendedCents: integer('intended_cents'),
    parameters: jsonb('parameters').$type<ShadowEvidence>(),
    parametersDigest: text('parameters_digest'),
    idempotencyKey: text('idempotency_key'),
    dispatchKnowledge: text('dispatch_knowledge')
      .$type<DepositShadowDispatchKnowledge>()
      .default('unknown')
      .notNull(),
    providerRefundId: text('provider_refund_id'),
    requestId: text('request_id'),
    evidence: jsonb('evidence').$type<ShadowEvidence>().notNull(),
  },
  table => ({
    commandFk: foreignKey({
      name: 'deposit_shadow_attempt_command_id_fk',
      columns: [table.commandId],
      foreignColumns: [depositShadowCommandSchema.id],
    }).onDelete('restrict'),
    commandOrdinalUniq: uniqueIndex('deposit_shadow_attempt_command_ordinal_uniq').on(
      table.commandId,
      table.ordinal,
    ),
    ordinalValid: check('deposit_shadow_attempt_ordinal_check', sql`${table.ordinal} > 0`),
    intendedCentsValid: check(
      'deposit_shadow_attempt_intended_cents_check',
      sql`${table.intendedCents} IS NULL OR ${table.intendedCents} > 0`,
    ),
    parametersObject: check(
      'deposit_shadow_attempt_parameters_object_check',
      sql`${table.parameters} IS NULL OR jsonb_typeof(${table.parameters}) = 'object'`,
    ),
    evidenceObject: check(
      'deposit_shadow_attempt_evidence_object_check',
      sql`jsonb_typeof(${table.evidence}) = 'object'`,
    ),
    dispatchKnowledgeValid: check(
      'deposit_shadow_attempt_dispatch_knowledge_check',
      sql`${table.dispatchKnowledge} IN ('recorded', 'dispatch_in_progress', 'outcome_unknown', 'provider_pending', 'provider_requires_action', 'provider_succeeded', 'provider_failed', 'provider_canceled', 'rejected_before_execution', 'unknown')`,
    ),
  }),
);

export const depositShadowObjectSchema = pgTable(
  'deposit_shadow_object',
  {
    account: text('account').notNull(),
    livemode: boolean('livemode').notNull(),
    objectId: text('object_id').notNull(),
    salonId: text('salon_id').notNull(),
    depositId: text('deposit_id').notNull(),
    kind: text('kind').$type<DepositShadowObjectKind>().notNull(),
    facts: jsonb('facts').$type<ShadowEvidence>().notNull(),
    version: integer('version').notNull(),
    cycleId: text('cycle_id'),
  },
  table => ({
    pk: primaryKey({ columns: [table.account, table.livemode, table.objectId] }),
    stateFk: foreignKey({
      name: 'deposit_shadow_object_state_fk',
      columns: [table.salonId, table.depositId, table.account, table.livemode],
      foreignColumns: [
        depositShadowStateSchema.salonId,
        depositShadowStateSchema.depositId,
        depositShadowStateSchema.account,
        depositShadowStateSchema.livemode,
      ],
    }).onDelete('restrict'),
    kindValid: check('deposit_shadow_object_kind_check', sql`${table.kind} IN ('refund', 'charge', 'dispute')`),
    factsObject: check(
      'deposit_shadow_object_facts_object_check',
      sql`jsonb_typeof(${table.facts}) = 'object'`,
    ),
    versionValid: check('deposit_shadow_object_version_check', sql`${table.version} > 0`),
  }),
);

export const depositShadowObservationSchema = pgTable(
  'deposit_shadow_observation',
  {
    id: text('id').primaryKey(),
    salonId: text('salon_id').notNull(),
    depositId: text('deposit_id').notNull(),
    account: text('account').notNull(),
    livemode: boolean('livemode').notNull(),
    cycleId: text('cycle_id').notNull(),
    generation: integer('generation').notNull(),
    version: integer('version').notNull(),
    fence: integer('fence').notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    reason: text('reason'),
    evidence: jsonb('evidence').$type<ShadowEvidence>().notNull(),
  },
  table => ({
    stateFk: foreignKey({
      name: 'deposit_shadow_observation_state_fk',
      columns: [table.salonId, table.depositId, table.account, table.livemode],
      foreignColumns: [
        depositShadowStateSchema.salonId,
        depositShadowStateSchema.depositId,
        depositShadowStateSchema.account,
        depositShadowStateSchema.livemode,
      ],
    }).onDelete('restrict'),
    stateIdx: index('deposit_shadow_observation_state_idx').on(
      table.salonId,
      table.depositId,
      table.account,
      table.livemode,
      table.acceptedAt,
    ),
    generationValid: check('deposit_shadow_observation_generation_check', sql`${table.generation} >= 0`),
    versionValid: check('deposit_shadow_observation_version_check', sql`${table.version} >= 0`),
    fenceValid: check('deposit_shadow_observation_fence_check', sql`${table.fence} >= 0`),
    evidenceObject: check(
      'deposit_shadow_observation_evidence_object_check',
      sql`jsonb_typeof(${table.evidence}) = 'object'`,
    ),
  }),
);

export type DepositShadowState = typeof depositShadowStateSchema.$inferSelect;
export type NewDepositShadowState = typeof depositShadowStateSchema.$inferInsert;
export type DepositShadowReceipt = typeof depositShadowReceiptSchema.$inferSelect;
export type NewDepositShadowReceipt = typeof depositShadowReceiptSchema.$inferInsert;
export type DepositShadowCommand = typeof depositShadowCommandSchema.$inferSelect;
export type NewDepositShadowCommand = typeof depositShadowCommandSchema.$inferInsert;
export type DepositShadowAttempt = typeof depositShadowAttemptSchema.$inferSelect;
export type NewDepositShadowAttempt = typeof depositShadowAttemptSchema.$inferInsert;
export type DepositShadowObject = typeof depositShadowObjectSchema.$inferSelect;
export type NewDepositShadowObject = typeof depositShadowObjectSchema.$inferInsert;
export type DepositShadowObservation = typeof depositShadowObservationSchema.$inferSelect;
export type NewDepositShadowObservation = typeof depositShadowObservationSchema.$inferInsert;
