import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { summarizeDepositCredit } from '@/libs/appointmentDepositFinancials';
import { db } from '@/libs/DB';
import { resolveDepositCredit } from '@/libs/depositCredit';
import {
  filterDepositAuditMetadata,
  serializeDepositForRole,
} from '@/libs/deposits/depositLifecycle';
import {
  assertNoDevRoleBypass,
  requireDepositReadActor,
} from '@/libs/deposits/depositMoneyGuard';
import {
  appointmentAuditLogSchema,
  appointmentDepositSchema,
  DEPOSIT_AUDIT_ACTIONS,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';

type RouteContext = { params: Promise<{ id: string }> };

function privateJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return Response.json(body, { ...init, headers });
}

function withPrivateNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', PRIVATE_NO_STORE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<Response> {
  const bypass = await assertNoDevRoleBypass();
  if (bypass) {
    return withPrivateNoStore(bypass);
  }

  try {
    const { id: appointmentId } = await params;
    const access = await requireDepositReadActor({
      request,
      rateLimitKey: 'admin-deposit-panel',
      salonSlug: new URL(request.url).searchParams.get('salonSlug'),
      appointmentId,
    });
    if (!access.ok) {
      return withPrivateNoStore(access.response);
    }

    const auditPredicate = and(
      eq(appointmentAuditLogSchema.salonId, access.salon.id),
      eq(appointmentAuditLogSchema.appointmentId, appointmentId),
      inArray(appointmentAuditLogSchema.action, [...DEPOSIT_AUDIT_ACTIONS]),
    );
    const [deposits, auditRows, [auditCount]] = await Promise.all([
      db
        .select()
        .from(appointmentDepositSchema)
        .where(and(
          eq(appointmentDepositSchema.salonId, access.salon.id),
          eq(appointmentDepositSchema.appointmentId, appointmentId),
        ))
        .orderBy(
          desc(appointmentDepositSchema.createdAt),
          desc(appointmentDepositSchema.id),
        ),
      db
        .select({
          id: appointmentAuditLogSchema.id,
          action: appointmentAuditLogSchema.action,
          performedByRole: appointmentAuditLogSchema.performedByRole,
          performedByName: appointmentAuditLogSchema.performedByName,
          reason: appointmentAuditLogSchema.reason,
          createdAt: appointmentAuditLogSchema.createdAt,
          newValue: appointmentAuditLogSchema.newValue,
        })
        .from(appointmentAuditLogSchema)
        .where(auditPredicate)
        .orderBy(desc(appointmentAuditLogSchema.createdAt))
        .limit(50),
      db
        .select({ total: count() })
        .from(appointmentAuditLogSchema)
        .where(auditPredicate),
    ]);

    const role = access.admin.isSuperAdmin ? 'super_admin' : 'admin';
    // Historical NULL is an unknown frozen invoice identity. It must not be
    // reinterpreted using mutable current salon settings. The sentinel is safe
    // only when there are no deposit rows and therefore no money to compare.
    const invoiceCurrency = access.appointment?.invoiceCurrency
      ?? (deposits.length === 0 ? 'CAD' : '');
    const resolution = resolveDepositCredit({
      deposits,
      invoiceCurrency,
    });
    const deposit = deposits.find(row => row.status === 'paid')
      ?? deposits.find(row => row.status === 'checkout_created')
      ?? deposits[0]
      ?? null;
    return privateJson({
      appointmentStatus: access.appointment?.status ?? null,
      deposit: deposit ? serializeDepositForRole(role, deposit) : null,
      deposits: deposits.map(row => serializeDepositForRole(role, row)),
      depositCredit: summarizeDepositCredit(resolution),
      auditRows: auditRows.map(row => ({
        ...row,
        newValue: filterDepositAuditMetadata(row.newValue),
      })),
      moreOmitted: Math.max(0, (auditCount?.total ?? 0) - auditRows.length),
    });
  } catch (error) {
    console.error('Error loading appointment deposit panel:', error);
    return privateJson(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load deposit details.',
        },
      },
      { status: 500 },
    );
  }
}
