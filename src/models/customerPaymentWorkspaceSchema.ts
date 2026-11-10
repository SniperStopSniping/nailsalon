import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { PaymentWorkspaceState } from '@/libs/customerPayments/server/workspaceContract';

export const customerPaymentWorkspacePolicySchema = pgTable('customer_payment_workspace_policy', {
  salonId: text('salon_id').primaryKey(),
  revision: integer('revision').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  cancellationPolicy: text('cancellation_policy').notNull(),
  bindingId: text('binding_id'),
  platformAccountId: text('platform_account_id'),
  livemode: boolean('livemode').notNull(),
  actorId: text('actor_id').notNull(),
  requestId: uuid('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const customerPaymentWorkspacePolicyAuditSchema = pgTable('customer_payment_workspace_policy_audit', {
  salonId: text('salon_id').notNull(),
  revision: integer('revision').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  actorId: text('actor_id').notNull(),
  requestId: uuid('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ version: primaryKey({ columns: [table.salonId, table.revision] }), once: uniqueIndex('customer_payment_workspace_policy_request_once').on(table.salonId, table.requestId) }));

/** Source-of-truth operations; SQL checks parent scope and writes audit atomically. */
export const customerPaymentWorkspaceSchema = pgTable('customer_payment_workspace', {
  appointmentId: text('appointment_id').primaryKey(),
  salonId: text('salon_id').notNull(),
  revision: integer('revision').notNull(),
  state: jsonb('state').$type<PaymentWorkspaceState>().notNull(),
  requestId: text('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const customerPaymentWorkspaceAuditSchema = pgTable('customer_payment_workspace_audit', {
  appointmentId: text('appointment_id').notNull(),
  salonId: text('salon_id').notNull(),
  revision: integer('revision').notNull(),
  state: jsonb('state').$type<PaymentWorkspaceState>().notNull(),
  requestId: text('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({
  version: primaryKey({ columns: [table.appointmentId, table.revision] }),
  requestOnce: uniqueIndex('customer_payment_workspace_request_once').on(table.salonId, table.requestId),
}));

/** Minimal signed facts only. No customer details, card data or raw body. */
export const customerPaymentLiveReceiptSchema = pgTable('customer_payment_live_receipt', {
  id: text('id').primaryKey(),
  platformAccountId: text('platform_account_id').notNull(),
  accountId: text('account_id').notNull(),
  livemode: boolean('livemode').notNull(),
  eventId: text('event_id').notNull(),
  payloadDigest: text('payload_digest').notNull(),
  receipt: jsonb('receipt').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull(),
}, table => ({
  deliveryOnce: uniqueIndex('customer_payment_live_receipt_once').on(table.platformAccountId, table.accountId, table.livemode, table.eventId, table.payloadDigest),
}));

export const customerPaymentLiveObservationSchema = pgTable('customer_payment_live_observation', {
  id: text('id').primaryKey(),
  appointmentId: text('appointment_id').notNull(),
  salonId: text('salon_id').notNull(),
  operationId: text('operation_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
}, table => ({ once: uniqueIndex('customer_payment_live_observation_once').on(table.operationId, table.fingerprint) }));

/** Immutable allocation after independent provider reads, never a create response. */
export const customerPaymentLiveSettlementSchema = pgTable('customer_payment_live_settlement', {
  operationId: text('operation_id').primaryKey(),
  appointmentId: text('appointment_id').notNull(),
  salonId: text('salon_id').notNull(),
  kind: text('kind').$type<'payment' | 'refund'>().notNull(),
  platformAccountId: text('platform_account_id').notNull(),
  accountId: text('account_id').notNull(),
  livemode: boolean('livemode').notNull(),
  objectId: text('object_id').notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  chargeId: text('charge_id').notNull(),
  parentOperationId: text('parent_operation_id'),
  principalCents: integer('principal_cents').notNull(),
  tipCents: integer('tip_cents').notNull(),
  evidenceHash: text('evidence_hash').notNull(),
  evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ objectOnce: uniqueIndex('customer_payment_live_settlement_object_once').on(table.platformAccountId, table.accountId, table.livemode, table.objectId) }));
