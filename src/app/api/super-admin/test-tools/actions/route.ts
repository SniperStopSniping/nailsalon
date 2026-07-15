import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { getDeploymentEnvironment } from '@/libs/authConfig.server';
import { db } from '@/libs/DB';
import { requireSuperAdminTestTools } from '@/libs/superAdminTestTools.server';
import { salonSchema } from '@/models/Schema';

const actionSchema = z.object({
  action: z.enum([
    'copy_public_url',
    'copy_booking_url',
    'open_public_page',
    'open_booking_page',
    'open_owner_dashboard',
    'integration_health_viewed',
  ]),
  salonId: z.string().min(1),
});

export async function POST(request: Request) {
  const guard = await requireSuperAdminTestTools();
  if (!guard.ok) {
    return guard.response;
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid test-tool action' }, { status: 400 });
  }

  const [salon] = await db
    .select({ id: salonSchema.id })
    .from(salonSchema)
    .where(eq(salonSchema.id, parsed.data.salonId))
    .limit(1);
  if (!salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  await logAuditEvent({
    salonId: salon.id,
    actorType: 'super_admin',
    actorId: guard.admin.id,
    action: parsed.data.action === 'integration_health_viewed'
      ? 'integration_health_checked'
      : 'test_tool_action',
    entityType: 'salon',
    entityId: salon.id,
    metadata: {
      testAction: parsed.data.action,
      environment: getDeploymentEnvironment(),
    },
  });

  return Response.json({ success: true });
}
