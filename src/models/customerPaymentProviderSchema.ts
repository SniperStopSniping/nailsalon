// Deliberately standalone: Schema.ts re-exports these tables without an import cycle.
// Migration0120 enforces existing appointment/quote foreign keys and scope checks.
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const customerPaymentProviderInboxSchema = pgTable('customer_payment_provider_inbox', {
  id: text('id').primaryKey(),
  endpointId: text('endpoint_id').notNull(),
  platformId: text('platform_id').notNull(),
  accountScope: text('account_scope').notNull(),
  accountKey: text('account_key').notNull(),
  mode: text('mode').notNull(),
  receiptIdentity: text('receipt_identity').notNull(),
  fingerprint: text('fingerprint').notNull(),
  receipt: jsonb('receipt').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_provider_inbox_once').on(table.endpointId, table.platformId, table.accountScope, table.accountKey, table.mode, table.receiptIdentity) }));
export const customerPaymentProviderConflictSchema = pgTable('customer_payment_provider_conflict', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  fingerprint: text('fingerprint').notNull(),
  receipt: jsonb('receipt').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_provider_conflict_once').on(table.inboxId, table.fingerprint) }));
export const customerPaymentProviderDeliverySchema = pgTable('customer_payment_provider_delivery', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull().references(() => customerPaymentProviderInboxSchema.id, { onDelete: 'restrict' }),
  consumer: text('consumer').notNull(),
  consumerVersion: integer('consumer_version').notNull(),
  state: text('state').$type<'pending' | 'processing' | 'completed' | 'review' | 'retry'>().notNull().default('pending'),
  version: integer('version').notNull().default(0),
  workerId: text('worker_id'),
  leaseToken: text('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true, mode: 'date' }),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_provider_delivery_once').on(table.inboxId, table.consumer, table.consumerVersion) }));
export const customerPaymentProviderOperationSchema = pgTable('customer_payment_provider_operation', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull(),
  appointmentId: text('appointment_id').notNull(),
  quoteId: text('quote_id').notNull(),
  requestId: text('request_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  identity: jsonb('identity').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_provider_operation_request_once').on(table.salonId, table.requestId) }));
export const customerPaymentProviderOperationStateSchema = pgTable('customer_payment_provider_operation_state', {
  operationId: text('operation_id').primaryKey().references(() => customerPaymentProviderOperationSchema.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  command: jsonb('command').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
export const customerPaymentProviderAuditSchema = pgTable('customer_payment_provider_audit', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  version: integer('version').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_provider_audit_once').on(table.entityType, table.entityId, table.version) }));
