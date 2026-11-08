// Standalone to avoid Schema.ts/customerPaymentSchema.ts runtime cycles.
// Migration0124 supplies cross-module foreign keys and deferred binding checks.
import { bigint, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const customerPaymentFixtureAdmissionSchema = pgTable('customer_payment_fixture_admission', {
  id: integer('id').primaryKey(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
});
export const customerPaymentFixturePlatformSchema = pgTable('customer_payment_fixture_platform', {
  platformId: text('platform_id').primaryKey(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
});
export const customerPaymentFixtureApplicationSchema = pgTable('customer_payment_fixture_application', {
  id: text('id').primaryKey(),
  operationId: text('operation_id').notNull(),
  quoteId: text('quote_id').notNull(),
  captureId: text('capture_id').notNull(),
  tenderId: text('tender_id').notNull(),
  salonId: text('salon_id').notNull(),
  appointmentId: text('appointment_id').notNull(),
  platformId: text('platform_id').notNull(),
  accountId: text('account_id').notNull(),
  mode: text('mode').$type<'test'>().notNull(),
  source: text('source').$type<'offline_fixture_test'>().notNull(),
  chargeId: text('charge_id').notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  correlationId: text('correlation_id').notNull(),
  sourceRevision: text('source_revision').notNull(),
  sourceEvidence: jsonb('source_evidence').$type<Record<string, unknown>>().notNull(),
  ownershipEvidence: jsonb('ownership_evidence').$type<readonly Record<string, unknown>[]>().notNull(),
  ownershipRevision: text('ownership_revision').notNull(),
  platformRevision: bigint('platform_revision', { mode: 'number' }).notNull(),
  captureFingerprint: text('capture_fingerprint').notNull(),
  quoteFingerprint: text('quote_fingerprint').notNull(),
  successInboxId: text('success_inbox_id').notNull(),
  successReceiptFingerprint: text('success_receipt_fingerprint').notNull(),
  successEventAt: timestamp('success_event_at', { withTimezone: true, mode: 'date' }).notNull(),
  currency: text('currency').$type<'cad'>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  principalCents: integer('principal_cents').notNull(),
  tipCents: integer('tip_cents').notNull(),
  applicationFeeCents: integer('application_fee_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({
  operationOnce: uniqueIndex('customer_payment_fixture_application_operation_once').on(table.operationId),
  captureOnce: uniqueIndex('customer_payment_fixture_application_capture_once').on(table.captureId),
  tenderOnce: uniqueIndex('customer_payment_fixture_application_tender_once').on(table.tenderId),
  chargeOnce: uniqueIndex('customer_payment_fixture_application_charge_once').on(table.platformId, table.accountId, table.mode, table.chargeId),
}));
export const customerPaymentFixtureHoldSchema = pgTable('customer_payment_fixture_hold', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull(),
  platformId: text('platform_id').notNull(),
  platformRevision: bigint('platform_revision', { mode: 'number' }).notNull(),
  sourceTable: text('source_table').notNull(),
  sourceId: text('source_id').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({ once: uniqueIndex('customer_payment_fixture_hold_once').on(table.applicationId, table.platformRevision) }));
export type CustomerPaymentFixtureApplication = typeof customerPaymentFixtureApplicationSchema.$inferSelect;
export type CustomerPaymentFixtureHold = typeof customerPaymentFixtureHoldSchema.$inferSelect;
