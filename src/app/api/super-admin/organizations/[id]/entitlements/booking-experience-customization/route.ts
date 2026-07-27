import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import {
  BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION,
  buildBookingExperienceEntitlementInspection,
  getBookingExperienceOverrideAuditId,
  getBookingExperienceOverrideState,
  parseBookingExperienceOverrideProvenance,
} from '@/libs/featureEntitlements';
import { requireSuperAdminGuard } from '@/libs/superAdmin';
import {
  salonAuditLogSchema,
  salonSchema,
} from '@/models/Schema';
import type {
  BookingExperienceEntitlementInspection,
  BookingExperienceEntitlementOverrideProvenance,
  BookingExperienceEntitlementOverrideServerState,
  BookingExperienceEntitlementOverrideState,
  SalonFeatures,
} from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

const overrideStateSchema = z.enum([
  'default',
  'force_enabled',
  'force_disabled',
]);

const mutationSchema = z.object({
  overrideState: overrideStateSchema,
  reason: z.string()
    .transform(reason => reason.trim())
    .refine(reason => reason.length <= 500, 'Reason must be 500 characters or fewer')
    .optional(),
  expectedOverrideState: overrideStateSchema,
  expectedOverrideAuditId: z.string().max(128).nullable(),
}).strict().superRefine((value, context) => {
  if (
    value.overrideState !== 'default'
    && (!value.reason || value.reason.length === 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'A reason is required for forced access',
    });
  }
});

type SalonRow = typeof salonSchema.$inferSelect;

type MutationResult =
  | { kind: 'not_found' }
  | { kind: 'invalid_features' }
  | {
    kind: 'conflict';
    current: BookingExperienceEntitlementOverrideServerState;
  }
  | {
    kind: 'success';
    changed: boolean;
    current: BookingExperienceEntitlementOverrideServerState;
  };

function toFeatures(value: unknown): SalonFeatures | null {
  if (value === null || value === undefined) {
    return {};
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? value as SalonFeatures
    : null;
}

function toBookingRecord(
  features: SalonFeatures,
): Record<string, unknown> | null {
  const booking = features.booking;
  if (booking === undefined) {
    return {};
  }
  return booking && typeof booking === 'object' && !Array.isArray(booking)
    ? booking as Record<string, unknown>
    : null;
}

async function loadProvenance(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  salonId: string,
  features: SalonFeatures,
): Promise<BookingExperienceEntitlementOverrideProvenance | null> {
  const auditId = getBookingExperienceOverrideAuditId(features);
  if (!auditId) {
    return null;
  }

  const [audit] = await executor
    .select({
      id: salonAuditLogSchema.id,
      salonId: salonAuditLogSchema.salonId,
      action: salonAuditLogSchema.action,
      performedBy: salonAuditLogSchema.performedBy,
      performedByEmail: salonAuditLogSchema.performedByEmail,
      metadata: salonAuditLogSchema.metadata,
      createdAt: salonAuditLogSchema.createdAt,
    })
    .from(salonAuditLogSchema)
    .where(and(
      eq(salonAuditLogSchema.id, auditId),
      eq(salonAuditLogSchema.salonId, salonId),
      eq(
        salonAuditLogSchema.action,
        BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION,
      ),
    ))
    .limit(1);

  return parseBookingExperienceOverrideProvenance(audit, {
    salonId,
    auditId,
    overrideState: getBookingExperienceOverrideState(features),
  });
}

function buildServerState(
  salon: Pick<SalonRow, 'plan'>,
  features: SalonFeatures,
  provenance: BookingExperienceEntitlementOverrideProvenance | null,
): BookingExperienceEntitlementOverrideServerState {
  return {
    features,
    bookingExperienceEntitlement:
      buildBookingExperienceEntitlementInspection({
        storedPlan: salon.plan,
        features,
      }, provenance),
  };
}

function buildAuditValue(
  inspection: BookingExperienceEntitlementInspection,
  reason: string | null,
) {
  return {
    featureKey: inspection.featureKey,
    overrideState: inspection.overrideState,
    entitled: inspection.entitled,
    source: inspection.source,
    planKey: inspection.planKey,
    planDefault: inspection.planDefault,
    reason,
  };
}

function buildNextFeaturesExpression(
  overrideState: BookingExperienceEntitlementOverrideState,
  auditId: string,
) {
  const liveFeatures = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.features}) = 'object'
        THEN ${salonSchema.features}
      ELSE '{}'::jsonb
    END
  `;
  const liveBooking = sql`
    CASE
      WHEN jsonb_typeof(${liveFeatures} -> 'booking') = 'object'
        THEN ${liveFeatures} -> 'booking'
      ELSE '{}'::jsonb
    END
  `;
  const bookingWithOverride = overrideState === 'default'
    ? sql`${liveBooking} - 'customization'`
    : sql`jsonb_set(
        ${liveBooking},
        '{customization}',
        to_jsonb(${overrideState === 'force_enabled'}::boolean),
        true
      )`;
  const bookingWithAuditPointer = sql`jsonb_set(
    ${bookingWithOverride},
    '{customizationOverrideAuditId}',
    to_jsonb(${auditId}::text),
    true
  )`;

  return sql`jsonb_set(
    ${liveFeatures},
    '{booking}',
    ${bookingWithAuditPointer},
    true
  )`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdminGuard();
  if (!guard.ok) {
    return guard.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validated = mutationSchema.safeParse(body);
  if (!validated.success) {
    return Response.json(
      { error: 'Invalid request data', details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const { id: salonId } = await params;
  const {
    overrideState,
    expectedOverrideState,
    expectedOverrideAuditId,
  } = validated.data;
  const reason = overrideState === 'default'
    ? null
    : validated.data.reason!;

  try {
    const result = await db.transaction<MutationResult>(async (tx) => {
      await tx.execute(
        sql`select id from ${salonSchema} where ${salonSchema.id} = ${salonId} for update`,
      );

      const [salon] = await tx
        .select()
        .from(salonSchema)
        .where(eq(salonSchema.id, salonId))
        .limit(1);

      if (!salon) {
        return { kind: 'not_found' };
      }

      const features = toFeatures(salon.features);
      if (!features) {
        return { kind: 'invalid_features' };
      }
      const booking = toBookingRecord(features);
      if (!booking) {
        return { kind: 'invalid_features' };
      }

      const provenance = await loadProvenance(tx, salonId, features);
      const current = buildServerState(salon, features, provenance);
      const currentInspection = current.bookingExperienceEntitlement;

      if (
        currentInspection.overrideState !== expectedOverrideState
        || currentInspection.overrideAuditId !== expectedOverrideAuditId
      ) {
        return { kind: 'conflict', current };
      }

      const isNoOp = overrideState === 'default'
        ? currentInspection.overrideState === 'default'
        : currentInspection.overrideState === overrideState
          && currentInspection.provenanceRecorded
          && currentInspection.reason === reason;

      if (isNoOp) {
        return { kind: 'success', changed: false, current };
      }

      const auditId = crypto.randomUUID();
      const [updated] = await tx
        .update(salonSchema)
        .set({
          features: buildNextFeaturesExpression(
            overrideState,
            auditId,
          ) as unknown as SalonFeatures,
        })
        .where(eq(salonSchema.id, salonId))
        .returning();

      const nextFeatures = toFeatures(updated?.features);
      if (!updated || !nextFeatures) {
        throw new Error('Entitlement override update returned no valid salon row');
      }
      const nextInspectionWithoutProvenance
        = buildBookingExperienceEntitlementInspection({
          storedPlan: updated.plan,
          features: nextFeatures,
        });

      const [audit] = await tx
        .insert(salonAuditLogSchema)
        .values({
          id: auditId,
          salonId,
          action: BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION,
          performedBy: guard.admin.id,
          performedByEmail: guard.admin.email,
          metadata: {
            field: 'booking_experience_customization',
            previousValue: buildAuditValue(
              currentInspection,
              currentInspection.reason,
            ),
            newValue: buildAuditValue(
              nextInspectionWithoutProvenance,
              reason,
            ),
            details: `Booking Experience Customization changed from ${currentInspection.overrideState} to ${overrideState}`,
          },
        })
        .returning();

      if (!audit) {
        throw new Error('Entitlement audit insert returned no row');
      }

      const nextProvenance = parseBookingExperienceOverrideProvenance(audit, {
        salonId,
        auditId,
        overrideState,
      });
      if (!nextProvenance) {
        throw new Error('Entitlement audit provenance could not be verified');
      }

      return {
        kind: 'success',
        changed: true,
        current: buildServerState(updated, nextFeatures, nextProvenance),
      };
    });

    if (result.kind === 'not_found') {
      return Response.json({ error: 'Salon not found' }, { status: 404 });
    }
    if (result.kind === 'invalid_features') {
      return Response.json(
        {
          error: 'Salon feature state is invalid',
          code: 'ENTITLEMENT_FEATURE_STATE_INVALID',
        },
        { status: 409 },
      );
    }
    if (result.kind === 'conflict') {
      return Response.json(
        {
          error: 'Booking Experience entitlement changed since it was loaded',
          code: 'ENTITLEMENT_OVERRIDE_CONFLICT',
          current: result.current,
        },
        {
          status: 409,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    return Response.json(
      {
        changed: result.changed,
        ...result.current,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Error updating Booking Experience entitlement override:', error);
    return Response.json(
      { error: 'Failed to update Booking Experience entitlement override' },
      { status: 500 },
    );
  }
}
