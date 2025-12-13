/**
 * Fraud Detection System (v1)
 *
 * Non-blocking fraud signal system that flags suspicious patterns for human review.
 * Called ONLY from appointment completion route.
 *
 * Features:
 * - Appointment frequency detection (3+ in 7d, 5+ in 14d)
 * - Points velocity detection (5000+ points in 7d)
 * - Throttle to prevent spam (unresolved signals block new ones)
 * - Idempotent signal creation (ON CONFLICT DO NOTHING)
 */

import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import {
  appointmentSchema,
  fraudSignalSchema,
  type FraudSignalSeverity,
  type FraudSignalType,
  salonClientSchema,
} from '@/models/Schema';
import { FRAUD_DETECTION } from '@/utils/AppConfig';

// =============================================================================
// TYPES
// =============================================================================

type FrequencyCheckResult = {
  shouldFlag: boolean;
  count7d: number;
  count14d: number;
  severity: FraudSignalSeverity;
};

type VelocityCheckResult = {
  shouldFlag: boolean;
  totalPoints7d: number;
  severity: FraudSignalSeverity;
};

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Evaluate fraud signals for a completed appointment.
 * Called ONLY from /api/appointments/[id]/complete AFTER atomic completion.
 *
 * @param salonId - Salon ID
 * @param salonClientId - Stable client identity (NOT phone)
 * @param appointmentId - The appointment that was just completed
 * @param pointsEarnedThisAppt - Points earned from this appointment (computed from totalPrice cents)
 */
export async function evaluateAndFlagIfNeeded(
  salonId: string,
  salonClientId: string,
  appointmentId: string,
  pointsEarnedThisAppt: number,
): Promise<void> {
  try {
    // Get client phone for metadata (optional, for display only)
    const clientPhone = await getClientPhone(salonClientId);

    // Run both checks in parallel
    const [frequencyResult, velocityResult] = await Promise.all([
      checkAppointmentFrequency(salonId, salonClientId),
      checkPointsVelocity(salonId, salonClientId, appointmentId, pointsEarnedThisAppt),
    ]);

    // Create signals if thresholds exceeded (with throttle + idempotency)
    const signalPromises: Promise<void>[] = [];

    if (frequencyResult.shouldFlag) {
      const reason = frequencyResult.count14d >= FRAUD_DETECTION.APPT_FREQ_14D
        ? `Client completed ${frequencyResult.count14d} appointments in 14 days (threshold: ${FRAUD_DETECTION.APPT_FREQ_14D})`
        : `Client completed ${frequencyResult.count7d} appointments in 7 days (threshold: ${FRAUD_DETECTION.APPT_FREQ_7D})`;

      signalPromises.push(
        createSignalIfNotExists({
          salonId,
          salonClientId,
          appointmentId,
          type: 'HIGH_APPOINTMENT_FREQUENCY',
          severity: frequencyResult.severity,
          reason,
          metadata: {
            appointmentsInPeriod: Math.max(frequencyResult.count7d, frequencyResult.count14d),
            periodDays: frequencyResult.count14d >= FRAUD_DETECTION.APPT_FREQ_14D ? 14 : 7,
            threshold: frequencyResult.count14d >= FRAUD_DETECTION.APPT_FREQ_14D
              ? FRAUD_DETECTION.APPT_FREQ_14D
              : FRAUD_DETECTION.APPT_FREQ_7D,
            clientPhone,
          },
        }),
      );
    }

    if (velocityResult.shouldFlag) {
      signalPromises.push(
        createSignalIfNotExists({
          salonId,
          salonClientId,
          appointmentId,
          type: 'HIGH_REWARD_VELOCITY',
          severity: velocityResult.severity,
          reason: `Client earned ${velocityResult.totalPoints7d} points in 7 days (threshold: ${FRAUD_DETECTION.POINTS_7D_CAP})`,
          metadata: {
            pointsInPeriod: velocityResult.totalPoints7d,
            periodDays: 7,
            threshold: FRAUD_DETECTION.POINTS_7D_CAP,
            clientPhone,
          },
        }),
      );
    }

    await Promise.all(signalPromises);
  } catch (error) {
    // Log but don't throw - fraud detection should never block completion
    console.error('[FraudDetection] Evaluation failed:', error);
  }
}

// =============================================================================
// FREQUENCY CHECK
// =============================================================================

/**
 * Check appointment frequency for a client.
 * Uses ONE query with FILTER for both 7d and 14d counts.
 * Only counts status='completed' AND payment_status='paid'.
 */
async function checkAppointmentFrequency(
  salonId: string,
  salonClientId: string,
): Promise<FrequencyCheckResult> {
  const now = Date.now();
  const cutoff7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const cutoff14d = new Date(now - 14 * 24 * 60 * 60 * 1000);

  // Single query with FILTER for both windows
  const result = await db
    .select({
      count7d: sql<number>`COUNT(*) FILTER (WHERE ${appointmentSchema.completedAt} >= ${cutoff7d})::int`,
      count14d: sql<number>`COUNT(*) FILTER (WHERE ${appointmentSchema.completedAt} >= ${cutoff14d})::int`,
    })
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.salonId, salonId),
        eq(appointmentSchema.salonClientId, salonClientId),
        eq(appointmentSchema.status, 'completed'),
        eq(appointmentSchema.paymentStatus, 'paid'),
        gte(appointmentSchema.completedAt, cutoff14d),
      ),
    );

  const count7d = result[0]?.count7d ?? 0;
  const count14d = result[0]?.count14d ?? 0;

  // Determine severity (check 14d first - higher severity)
  let shouldFlag = false;
  let severity: FraudSignalSeverity = 'MEDIUM';

  if (count14d >= FRAUD_DETECTION.APPT_FREQ_14D) {
    shouldFlag = true;
    severity = 'HIGH';
  } else if (count7d >= FRAUD_DETECTION.APPT_FREQ_7D) {
    shouldFlag = true;
    severity = 'MEDIUM';
  }

  return { shouldFlag, count7d, count14d, severity };
}

// =============================================================================
// VELOCITY CHECK
// =============================================================================

/**
 * Check points velocity for a client.
 * Sums totalPrice (cents) for completed+paid appointments in last 7 days,
 * EXCLUDING the current appointment to avoid double-counting.
 * Then adds pointsEarnedThisAppt.
 */
async function checkPointsVelocity(
  salonId: string,
  salonClientId: string,
  currentAppointmentId: string,
  pointsEarnedThisAppt: number,
): Promise<VelocityCheckResult> {
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Sum totalPrice (cents) for other completed appointments in window
  const result = await db
    .select({
      sumCents: sql<number>`COALESCE(SUM(${appointmentSchema.totalPrice}), 0)::int`,
    })
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.salonId, salonId),
        eq(appointmentSchema.salonClientId, salonClientId),
        eq(appointmentSchema.status, 'completed'),
        eq(appointmentSchema.paymentStatus, 'paid'),
        gte(appointmentSchema.completedAt, cutoff7d),
        ne(appointmentSchema.id, currentAppointmentId), // Exclude current
      ),
    );

  const priorCents = result[0]?.sumCents ?? 0;
  const priorPoints = computeEarnedPointsFromCents(priorCents);
  const totalPoints7d = priorPoints + pointsEarnedThisAppt;

  // Determine severity
  let shouldFlag = false;
  let severity: FraudSignalSeverity = 'MEDIUM';

  if (totalPoints7d >= FRAUD_DETECTION.POINTS_7D_HIGH) {
    shouldFlag = true;
    severity = 'HIGH';
  } else if (totalPoints7d >= FRAUD_DETECTION.POINTS_7D_CAP) {
    shouldFlag = true;
    severity = 'MEDIUM';
  }

  return { shouldFlag, totalPoints7d, severity };
}

// =============================================================================
// SIGNAL CREATION (THROTTLE + IDEMPOTENT)
// =============================================================================

/**
 * Create a fraud signal if:
 * 1. No unresolved signal of same type exists for this client in throttle window
 * 2. No signal exists for this appointment+type (ON CONFLICT)
 */
async function createSignalIfNotExists(data: {
  salonId: string;
  salonClientId: string;
  appointmentId: string;
  type: FraudSignalType;
  severity: FraudSignalSeverity;
  reason: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  // 1. THROTTLE CHECK: Skip if unresolved signal exists in window
  const throttleDays = data.type === 'HIGH_APPOINTMENT_FREQUENCY'
    ? FRAUD_DETECTION.THROTTLE_FREQUENCY_DAYS
    : FRAUD_DETECTION.THROTTLE_VELOCITY_DAYS;

  const throttleCutoff = new Date(Date.now() - throttleDays * 24 * 60 * 60 * 1000);

  const existingUnresolved = await db
    .select({ id: fraudSignalSchema.id })
    .from(fraudSignalSchema)
    .where(
      and(
        eq(fraudSignalSchema.salonId, data.salonId),
        eq(fraudSignalSchema.salonClientId, data.salonClientId),
        eq(fraudSignalSchema.type, data.type),
        isNull(fraudSignalSchema.resolvedAt),
        gte(fraudSignalSchema.createdAt, throttleCutoff),
      ),
    )
    .limit(1);

  if (existingUnresolved.length > 0) {
    // Throttled - skip silently (this is expected, not an error)
    return;
  }

  // 2. INSERT with ON CONFLICT DO NOTHING (race-condition safe)
  const signalId = `fs_${crypto.randomUUID()}`;

  try {
    await db
      .insert(fraudSignalSchema)
      .values({
        id: signalId,
        salonId: data.salonId,
        salonClientId: data.salonClientId,
        appointmentId: data.appointmentId,
        type: data.type,
        severity: data.severity,
        reason: data.reason,
        metadata: data.metadata,
      })
      .onConflictDoNothing({
        target: [fraudSignalSchema.appointmentId, fraudSignalSchema.type],
      });
  } catch (error) {
    // Log at debug level only - conflicts are expected
    if (process.env.NODE_ENV === 'development') {
      console.debug('[FraudDetection] Signal insert conflict (expected):', error);
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get client phone for metadata (display only).
 */
async function getClientPhone(salonClientId: string): Promise<string | undefined> {
  const result = await db
    .select({ phone: salonClientSchema.phone })
    .from(salonClientSchema)
    .where(eq(salonClientSchema.id, salonClientId))
    .limit(1);

  return result[0]?.phone;
}
