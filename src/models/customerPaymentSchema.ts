import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import type { CustomerPaymentSnapshot } from '@/libs/customerPayments/money';
import type { CustomerPaymentDraftSettings } from '@/libs/customerPayments/settings';

import { appointmentPaymentSchema, appointmentSchema, salonSchema } from './Schema';

export const customerPaymentPolicySchema = pgTable('customer_payment_policy', {
  salonId: text('salon_id').primaryKey().references(() => salonSchema.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  settings: jsonb('settings').$type<CustomerPaymentDraftSettings>().notNull(),
  mode: text('mode').notNull().default('test'),
  collectionEnabled: boolean('collection_enabled').notNull().default(false),
}, table => ({
  testOnly: check('customer_payment_policy_test_only', sql`${table.mode} = 'test' AND ${table.collectionEnabled} = false`),
  revisionValid: check('customer_payment_policy_revision_valid', sql`${table.revision} >= 0`),
}));

export const customerPaymentPolicyReceiptSchema = pgTable('customer_payment_policy_receipt', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull().references(() => salonSchema.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  requestId: text('request_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  result: jsonb('result').$type<{ settings: CustomerPaymentDraftSettings; revision: number; testOnly: true; collectionEnabled: false }>().notNull(),
}, table => ({ once: uniqueIndex('customer_payment_policy_request_once').on(table.salonId, table.actorId, table.requestId) }));

export const customerPaymentPreparedQuoteSchema = pgTable('customer_payment_prepared_quote', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull(),
  appointmentId: text('appointment_id').notNull(),
  requestId: text('request_id').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  fingerprint: text('fingerprint').notNull(),
  policyRevision: integer('policy_revision').notNull(),
  stripeAccountId: text('stripe_account_id').notNull(),
  mode: text('mode').notNull().default('test'),
  executable: boolean('executable').notNull().default(false),
  snapshot: jsonb('snapshot').$type<CustomerPaymentSnapshot>().notNull(),
  context: jsonb('context').$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({
  tenant: foreignKey({ name: 'customer_payment_quote_appointment_tenant_fk', columns: [table.salonId, table.appointmentId], foreignColumns: [appointmentSchema.salonId, appointmentSchema.id] }).onDelete('cascade'),
  requestOnce: uniqueIndex('customer_payment_quote_request_once').on(table.salonId, table.appointmentId, table.requestId),
  identity: uniqueIndex('customer_payment_quote_tenant_identity').on(table.salonId, table.id, table.stripeAccountId, table.mode),
  captureIdentity: uniqueIndex('customer_payment_quote_capture_identity').on(table.salonId, table.id, table.appointmentId, table.stripeAccountId, table.mode),
  testOnly: check('customer_payment_quote_test_only', sql`${table.mode} = 'test' AND ${table.executable} = false`),
}));

export const customerPaymentCaptureSchema = pgTable('customer_payment_capture', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull(),
  appointmentId: text('appointment_id').notNull(),
  quoteId: text('quote_id').notNull(),
  stripeAccountId: text('stripe_account_id').notNull(),
  mode: text('mode').$type<'test'>().notNull().default('test'),
  source: text('source').$type<'synthetic_test'>().notNull().default('synthetic_test'),
  paymentIntentId: text('payment_intent_id').notNull(),
  tenderId: text('tender_id').notNull().references(() => appointmentPaymentSchema.id, { onDelete: 'restrict' }),
  currency: text('currency').notNull(),
  amountCents: integer('amount_cents').notNull(),
  applicationFeeCents: integer('application_fee_cents').notNull(),
  principalCents: integer('principal_cents').notNull(),
  tipCents: integer('tip_cents').notNull(),
  quotedApplicationFeeCents: integer('quoted_application_fee_cents').notNull(),
  state: text('state').$type<'posted' | 'held_review'>().notNull(),
  reviewReason: text('review_reason'),
  capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  fingerprint: text('fingerprint').notNull(),
}, table => ({
  quoteTenant: foreignKey({ name: 'customer_payment_capture_quote_tenant_fk', columns: [table.salonId, table.quoteId, table.appointmentId, table.stripeAccountId, table.mode], foreignColumns: [customerPaymentPreparedQuoteSchema.salonId, customerPaymentPreparedQuoteSchema.id, customerPaymentPreparedQuoteSchema.appointmentId, customerPaymentPreparedQuoteSchema.stripeAccountId, customerPaymentPreparedQuoteSchema.mode] }).onDelete('restrict'),
  appointmentTenant: foreignKey({ name: 'customer_payment_capture_appointment_tenant_fk', columns: [table.salonId, table.appointmentId], foreignColumns: [appointmentSchema.salonId, appointmentSchema.id] }).onDelete('restrict'),
  eventIdentity: uniqueIndex('customer_payment_capture_event_identity').on(table.id, table.stripeAccountId, table.mode),
  intentOnce: uniqueIndex('customer_payment_capture_intent_once').on(table.stripeAccountId, table.mode, table.paymentIntentId),
  tenderOnce: uniqueIndex('customer_payment_capture_tender_once').on(table.tenderId),
  tenderMarker: check('customer_payment_capture_tender_marker', sql`${table.tenderId} = 'cpay_' || ${table.id}`),
  syntheticOnly: check('customer_payment_capture_synthetic_only', sql`${table.mode} = 'test' AND ${table.source} = 'synthetic_test'`),
}));
export type CustomerPaymentCapture = typeof customerPaymentCaptureSchema.$inferSelect;

export const customerPaymentCaptureEventSchema = pgTable('customer_payment_capture_event', {
  id: text('id').primaryKey(),
  captureId: text('capture_id').notNull(),
  stripeAccountId: text('stripe_account_id').notNull(),
  mode: text('mode').$type<'test'>().notNull().default('test'),
  eventId: text('event_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, table => ({
  captureAccount: foreignKey({ name: 'customer_payment_capture_event_account_fk', columns: [table.captureId, table.stripeAccountId, table.mode], foreignColumns: [customerPaymentCaptureSchema.id, customerPaymentCaptureSchema.stripeAccountId, customerPaymentCaptureSchema.mode] }).onDelete('restrict'),
  eventOnce: uniqueIndex('customer_payment_capture_event_once').on(table.stripeAccountId, table.mode, table.eventId),
}));
