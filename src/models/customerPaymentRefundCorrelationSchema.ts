// Standalone offline graph journal; intentionally no import from Schema.ts.
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { customerPaymentProviderInboxSchema, customerPaymentProviderOperationSchema } from './customerPaymentProviderSchema';

export const customerPaymentRefundProjectionSchema = pgTable('customer_payment_refund_projection', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  projectionVersion: integer('projection_version').notNull(),
  fingerprint: text('fingerprint').notNull(),
  receiptFingerprint: text('receipt_fingerprint').notNull(),
  projection: jsonb('projection').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_refund_projection_once').on(table.inboxId, table.projectionVersion, table.fingerprint) }));
export const customerPaymentRefundCorrelationLinkSchema = pgTable('customer_payment_refund_correlation_link', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_refund_correlation_link_once').on(table.operationId, table.inboxId) }));
export const customerPaymentRefundCorrelationSchema = pgTable('customer_payment_refund_correlation', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  parentOperationId: text('parent_operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  sourceRevision: text('source_revision').notNull(),
  ownershipRevision: text('ownership_revision').notNull(),
  source: jsonb('source').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_refund_correlation_version_once').on(table.operationId, table.version) }));
export const customerPaymentMovementCandidateSchema = pgTable('customer_payment_movement_candidate', {
  id: text('id').primaryKey(),
  movementKeyHash: text('movement_key_hash').notNull(),
  movementKey: jsonb('movement_key').$type<Record<string, unknown>>().notNull(),
  firstOperationId: text('first_operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_movement_candidate_once').on(table.movementKeyHash) }));
export const customerPaymentMovementClaimSchema = pgTable('customer_payment_movement_claim', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => customerPaymentMovementCandidateSchema.id, { onDelete: 'restrict' }),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  correlationId: text('correlation_id').notNull().references(() => customerPaymentRefundCorrelationSchema.id, { onDelete: 'restrict' }),
  fingerprint: text('fingerprint').notNull(),
  facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_movement_claim_once').on(table.candidateId, table.operationId, table.fingerprint) }));
