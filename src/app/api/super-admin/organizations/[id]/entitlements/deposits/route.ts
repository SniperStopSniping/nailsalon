import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import {
  DEPOSITS_ENTITLEMENT_AUDIT_ACTION,
  resolveDepositEntitlement,
} from '@/libs/depositPolicy';
import { requireSuperAdminGuard } from '@/libs/superAdmin';
import { salonAuditLogSchema, salonSchema } from '@/models/Schema';
import type { SalonFeatures } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

/**
 * THE SANCTIONED WRITER of `features.money.deposits`.
 *
 * The super-admin organizations PATCH protects this key, which makes it
 * immutable through that route in both directions. Without this endpoint the key
 * would have no writer able to SET it anywhere under `src/app/api`, and both
 * per-salon go-live and the emergency kill switch would become "run SQL against
 * production".
 *
 * A privileged route that flips a money gate: the super-admin guard, the
 * `expectedEntitled` compare-and-set taken under `SELECT … FOR UPDATE`, and the
 * transactional audit row are all mandatory. Shipping it without any one of them
 * is worse than not shipping it.
 */

const mutationSchema = z.object({
  entitled: z.boolean(),
  reason: z.string().max(500).optional(),
  expectedEntitled: z.boolean(),
}).strict();

type MutationResult
  = | { kind: 'not_found' }
  | { kind: 'conflict'; entitled: boolean }
  | { kind: 'success'; changed: boolean; entitled: boolean };

/**
 * Writes ONLY `{money,deposits}`, from the LIVE row, under `jsonb_typeof`
 * guards for both `features` and `features->'money'` so a legacy scalar cannot
 * turn the whole column NULL.
 */
function buildNextFeaturesExpression(entitled: boolean) {
  const liveFeatures = sql`
    CASE
      WHEN jsonb_typeof(${salonSchema.features}) = 'object'
        THEN ${salonSchema.features}
      ELSE '{}'::jsonb
    END
  `;
  const liveMoney = sql`
    CASE
      WHEN jsonb_typeof(${liveFeatures} -> 'money') = 'object'
        THEN ${liveFeatures} -> 'money'
      ELSE '{}'::jsonb
    END
  `;
  const moneyWithDeposits = sql`jsonb_set(
    ${liveMoney},
    '{deposits}',
    to_jsonb(${entitled}::boolean),
    true
  )`;

  return sql`jsonb_set(
    ${liveFeatures},
    '{money}',
    ${moneyWithDeposits},
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
  const { entitled, expectedEntitled } = validated.data;
  const reason = validated.data.reason?.trim() || null;

  try {
    const result = await db.transaction<MutationResult>(async (tx) => {
      // FIRST STATEMENT. Without the lock two concurrent calls both read the old
      // value, both pass `expectedEntitled`, both write, and two audit rows claim
      // the same `previousValue` — so a go-live can win over an emergency kill on
      // the route that IS the fastest kill switch.
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

      const currentEntitled = resolveDepositEntitlement(
        salon.features as SalonFeatures | null | undefined,
      );

      if (currentEntitled !== expectedEntitled) {
        return { kind: 'conflict', entitled: currentEntitled };
      }

      // Repeated calls must not spam the audit log.
      if (currentEntitled === entitled) {
        return { kind: 'success', changed: false, entitled: currentEntitled };
      }

      const [updated] = await tx
        .update(salonSchema)
        .set({
          features: buildNextFeaturesExpression(entitled) as unknown as SalonFeatures,
        })
        .where(eq(salonSchema.id, salonId))
        .returning();

      if (!updated) {
        throw new Error('Deposits entitlement update returned no salon row');
      }

      const [audit] = await tx
        .insert(salonAuditLogSchema)
        .values({
          id: crypto.randomUUID(),
          salonId,
          action: DEPOSITS_ENTITLEMENT_AUDIT_ACTION,
          performedBy: guard.admin.id,
          performedByEmail: guard.admin.email,
          metadata: {
            field: 'money_deposits',
            previousValue: currentEntitled,
            newValue: entitled,
            details: reason
              ? `Deposits entitlement changed from ${currentEntitled} to ${entitled} — ${reason}`
              : `Deposits entitlement changed from ${currentEntitled} to ${entitled}`,
          },
        })
        .returning();

      if (!audit) {
        throw new Error('Deposits entitlement audit insert returned no row');
      }

      return {
        kind: 'success',
        changed: true,
        entitled: resolveDepositEntitlement(
          updated.features as SalonFeatures | null | undefined,
        ),
      };
    });

    if (result.kind === 'not_found') {
      return Response.json({ error: 'Salon not found' }, { status: 404 });
    }
    if (result.kind === 'conflict') {
      return Response.json(
        {
          error: 'Deposits entitlement changed since it was loaded',
          code: 'DEPOSITS_ENTITLEMENT_CONFLICT',
          current: { entitled: result.entitled },
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return Response.json(
      { changed: result.changed, entitled: result.entitled },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Error updating deposits entitlement:', error);
    return Response.json(
      { error: 'Failed to update deposits entitlement' },
      { status: 500 },
    );
  }
}
