// Standalone offline graph journal; intentionally no import from Schema.ts.
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { customerPaymentProviderConflictSchema, customerPaymentProviderInboxSchema, customerPaymentProviderOperationSchema } from './customerPaymentProviderSchema';

export const customerPaymentDisputeProjectionSchema = pgTable('customer_payment_dispute_projection', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  conflictId: text('conflict_id').references(() => customerPaymentProviderConflictSchema.id, { onDelete: 'restrict' }),
  projectionVersion: integer('projection_version').notNull(),
  fingerprint: text('fingerprint').notNull(),
  receiptFingerprint: text('receipt_fingerprint').notNull(),
  projection: jsonb('projection').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_projection_once').on(table.inboxId, table.projectionVersion, table.receiptFingerprint, table.fingerprint) }));
export const customerPaymentDisputeCorrelationLinkSchema = pgTable('customer_payment_dispute_correlation_link', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_correlation_link_once').on(table.operationId, table.inboxId) }));
export const customerPaymentDisputeCorrelationSchema = pgTable('customer_payment_dispute_correlation', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  sourceRevision: text('source_revision').notNull(),
  ownershipRevision: text('ownership_revision').notNull(),
  source: jsonb('source').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_correlation_version_once').on(table.operationId, table.version) }));
export const customerPaymentDisputeCandidateSchema = pgTable('customer_payment_dispute_candidate', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull(),
  key: jsonb('key').$type<Record<string, unknown>>().notNull(),
  firstOperationId: text('first_operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_candidate_once').on(table.keyHash) }));
export const customerPaymentDisputeClaimSchema = pgTable('customer_payment_dispute_claim', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => customerPaymentDisputeCandidateSchema.id, { onDelete: 'restrict' }),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  correlationId: text('correlation_id').notNull().references(() => customerPaymentDisputeCorrelationSchema.id, { onDelete: 'restrict' }),
  fingerprint: text('fingerprint').notNull(),
  facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_claim_once').on(table.candidateId, table.operationId, table.fingerprint) }));
export const customerPaymentDisputeBalanceCandidateSchema = pgTable('customer_payment_dispute_balance_candidate', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull(),
  key: jsonb('key').$type<Record<string, unknown>>().notNull(),
  firstOperationId: text('first_operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_balance_candidate_once').on(table.keyHash) }));
export const customerPaymentDisputeBalanceClaimSchema = pgTable('customer_payment_dispute_balance_claim', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => customerPaymentDisputeBalanceCandidateSchema.id, { onDelete: 'restrict' }),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  correlationId: text('correlation_id').notNull().references(() => customerPaymentDisputeCorrelationSchema.id, { onDelete: 'restrict' }),
  fingerprint: text('fingerprint').notNull(),
  facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_dispute_balance_claim_once').on(table.candidateId, table.operationId, table.fingerprint) }));
