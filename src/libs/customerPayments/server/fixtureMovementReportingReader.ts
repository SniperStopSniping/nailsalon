import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import { appointmentPaymentSchema, appointmentSchema } from '@/models/Schema';

import { CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED } from '../captureReporting';
import { fixtureMovementFingerprintFacts, fixtureMovementKeyFacts, projectOfflineFixtureMovementReport } from '../fixtureMovementReporting';
import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import { providerCorrelationFingerprint } from '../provider/correlation';
import { readOfflineFixtureCaptureEvidence } from './fixtureApplicationReader';

/** Historical cash reads never depend on permission to write another movement. */
export async function readOfflineFixtureMovementReport(database: Pick<typeof db, 'select'>, input: {
  salonId: string;
  currency: 'CAD' | 'USD';
  start: Date;
  end: Date;
  /** Reuse the same request’s legacy marker probe, never a source authority. */
  hasCustomerPaymentMarker?: boolean;
}) {
  const empty = () => ({ ...projectOfflineFixtureMovementReport({ ...input, captures: [], markers: [], evidence: [], movements: [], reconciliations: [] }), captureMarkers: [] as (typeof appointmentPaymentSchema.$inferSelect)[] });
  const [marker] = input.hasCustomerPaymentMarker === undefined
    ? await database.select({ id: appointmentPaymentSchema.id }).from(appointmentPaymentSchema)
      .innerJoin(appointmentSchema, eq(appointmentSchema.id, appointmentPaymentSchema.appointmentId))
      .where(and(eq(appointmentSchema.salonId, input.salonId), sql`(left(${appointmentPaymentSchema.id}, 5) = 'cpay_' OR left(COALESCE(${appointmentPaymentSchema.reference}, ''), 25) = 'customer_payment_capture:')`)).limit(1)
    : input.hasCustomerPaymentMarker ? [{ id: 'observed' }] : [];
  if (!marker) {
    return empty();
  }
  const fail = (): never => {
    throw new Error(CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED);
  };
  if (!isCustomerPaymentLedgerTestEnabled()) {
    fail();
  }
  const { customerPaymentCaptureSchema: captureTable } = await import('@/models/customerPaymentSchema');
  // Do not bound parents by capture time: a refund/dispute can occur months later.
  const captures = await database.select().from(captureTable).where(and(eq(captureTable.salonId, input.salonId), eq(captureTable.source, 'offline_fixture_test')));
  if (captures.length === 0) {
    return empty();
  }
  if (process.env.NODE_ENV !== 'test') {
    fail();
  }
  const { customerPaymentFixtureMovementSchema: movementTable, customerPaymentFixtureReconciliationSchema: reconciliationTable } = await import('@/models/customerPaymentFixtureMovementSchema');
  const markers = await database.select().from(appointmentPaymentSchema).where(and(eq(appointmentPaymentSchema.salonId, input.salonId), inArray(appointmentPaymentSchema.id, captures.map(row => row.tenderId))));
  // Read immutable snapshots before their rows. Concurrent complete batches are
  // detected below; their arrival must never manufacture a complete net total.
  const initialEvidence = await readOfflineFixtureCaptureEvidence(database, captures);
  const applicationIds = initialEvidence.map(row => row.application.id);
  let previousEvidence = initialEvidence;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reconciliations = await database.select().from(reconciliationTable).where(inArray(reconciliationTable.applicationId, applicationIds));
    const movements = await database.select().from(movementTable).where(inArray(movementTable.captureId, captures.map(row => row.id)));
    const latestReconciliations = await database.select().from(reconciliationTable).where(inArray(reconciliationTable.applicationId, applicationIds));
    for (const row of latestReconciliations) {
      if (providerCorrelationFingerprint(row.sourceEvidence) !== row.sourceRevision
        || providerCorrelationFingerprint(row.ownershipEvidence) !== row.ownershipRevision) {
        fail();
      }
    }
    for (const row of movements) {
      const candidate = row.evidence.candidateFacts;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        fail();
      }
      const facts = candidate as Record<string, unknown>;
      const fingerprintFacts = Object.fromEntries(Object.entries(facts).filter(([key]) => key !== 'fingerprint'
        && !(key === 'operationId' && (row.kind === 'customer_refund' || row.kind === 'application_fee_refund'))));
      if (providerCorrelationFingerprint(fingerprintFacts) !== row.evidence.candidateFingerprint
        || facts.fingerprint !== row.evidence.candidateFingerprint
        || providerCorrelationFingerprint(facts.movementKey) !== row.movementKeyHash
        || facts.amountCents !== row.amountCents || facts.currency !== row.currency
        || facts.chargeId !== row.chargeId || facts.paymentIntentId !== row.paymentIntentId) {
        fail();
      }
      if (providerCorrelationFingerprint(fixtureMovementFingerprintFacts(row)) !== row.fingerprint
        || providerCorrelationFingerprint(fixtureMovementKeyFacts(row)) !== row.movementKeyHash
        || providerCorrelationFingerprint(row.evidence.movementKey) !== row.movementKeyHash) {
        fail();
      }
    }
    // Read revision last. A source arrival without a posted batch still makes a
    // prior completeness claim stale and cannot disappear behind an older hold.
    const evidence = await readOfflineFixtureCaptureEvidence(database, captures);
    const stableBatches = reconciliations.length === latestReconciliations.length
      && reconciliations.every(row => latestReconciliations.some(latest => latest.id === row.id));
    const stableRevision = evidence.every(row => previousEvidence.some(previous => previous.application.id === row.application.id && previous.currentPlatformRevision === row.currentPlatformRevision));
    if (stableBatches && stableRevision) {
      return { ...projectOfflineFixtureMovementReport({ ...input, captures, markers, evidence, movements, reconciliations }), captureMarkers: markers };
    }
    if (attempt === 0) {
      previousEvidence = evidence;
      continue;
    }
    // Continuous arrivals: preserve the last complete historical closure only.
    // Every supplied birth batch still passes exact immutable member validation;
    // a partial new batch is never treated as a complete cash or net statement.
    const historicalIds = new Set(movements.map(row => row.reconciliationId));
    const historicalReconciliations = latestReconciliations.filter(row => historicalIds.has(row.id));
    return {
      ...projectOfflineFixtureMovementReport({ ...input, captures, markers, evidence, movements, reconciliations: historicalReconciliations }),
      movementReconciliationRequired: true,
      captureMarkers: markers,
    };
  }
  return fail();
}
