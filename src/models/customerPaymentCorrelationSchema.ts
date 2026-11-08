// Standalone offline graph journal; intentionally no import from Schema.ts.
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { customerPaymentProviderInboxSchema, customerPaymentProviderOperationSchema } from './customerPaymentProviderSchema';

export const customerPaymentCorrelationMutexSchema = pgTable('customer_payment_correlation_mutex', { id: integer('id').primaryKey(), revision: integer('revision').notNull().default(0) });
export const customerPaymentSessionProjectionSchema = pgTable('customer_payment_session_projection', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  projectionVersion: integer('projection_version').notNull(),
  fingerprint: text('fingerprint').notNull(),
  receiptFingerprint: text('receipt_fingerprint').notNull(),
  projection: jsonb('projection').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_session_projection_once').on(table.inboxId, table.projectionVersion, table.fingerprint) }));
export const customerPaymentCorrelationLinkSchema = pgTable('customer_payment_correlation_link', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_correlation_link_once').on(table.operationId, table.inboxId) }));
export const customerPaymentCorrelationSchema = pgTable('customer_payment_correlation', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  sourceRevision: text('source_revision').notNull(),
  ownershipRevision: text('ownership_revision').notNull(),
  source: jsonb('source').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_correlation_version_once').on(table.operationId, table.version) }));
export const customerPaymentChargeCandidateSchema = pgTable('customer_payment_charge_candidate', {
  id: text('id').primaryKey(),
  platformId: text('platform_id').notNull(),
  accountId: text('account_id').notNull(),
  mode: text('mode').notNull(),
  chargeId: text('charge_id').notNull(),
  firstOperationId: text('first_operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_charge_candidate_once').on(table.platformId, table.accountId, table.mode, table.chargeId) }));
export const customerPaymentChargeClaimSchema = pgTable('customer_payment_charge_claim', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => customerPaymentChargeCandidateSchema.id, { onDelete: 'restrict' }),
  operationId: text('operation_id').notNull().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  correlationId: text('correlation_id').notNull().references(() => customerPaymentCorrelationSchema.id, { onDelete: 'restrict' }),
  fingerprint: text('fingerprint').notNull(),
  facts: jsonb('facts').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_charge_claim_once').on(table.candidateId, table.operationId, table.fingerprint) }));
