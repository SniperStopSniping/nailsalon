import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getAdminSession, requireAdminSalon } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { resolveRebookingPromptSettings } from '@/libs/rebookingPromptSettings';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const updateSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

async function context(request: Request) {
  return requireAdminSalon(
    new URL(request.url).searchParams.get('salonSlug') ?? '',
  );
}

export async function GET(request: Request): Promise<Response> {
  const { salon, error } = await context(request);
  if (error || !salon) {
    return error!;
  }

  return Response.json(
    {
      data: { settings: resolveRebookingPromptSettings(salon.settings) },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const { salon, error } = await context(request);
  if (error || !salon) {
    return error!;
  }

  const admin = await getAdminSession();
  if (!admin) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sign in to update rebooking prompts.',
        },
      },
      { status: 401 },
    );
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Choose whether to show the rebooking prompt.',
        },
      },
      { status: 400 },
    );
  }

  // Own only this top-level JSONB key. This avoids a stale settings card
  // replacing unrelated booking, communication, or payment configuration.
  const settingsExpression = sql`
    jsonb_set(
      CASE
        WHEN jsonb_typeof(${salonSchema.settings}) = 'object' THEN ${salonSchema.settings}
        ELSE '{}'::jsonb
      END,
      '{rebookingPrompt}',
      ${JSON.stringify({ enabled: parsed.data.enabled })}::jsonb,
      true
    )
  `;
  const [updated] = await db
    .update(salonSchema)
    .set({ settings: settingsExpression })
    .where(eq(salonSchema.id, salon.id))
    .returning();

  await logAuditEvent({
    salonId: salon.id,
    actorType: 'admin',
    actorId: admin.id,
    action: 'settings_updated',
    entityType: 'salon',
    entityId: salon.id,
    metadata: { feature: 'rebooking_prompt', enabled: parsed.data.enabled },
  });

  return Response.json(
    {
      data: { settings: resolveRebookingPromptSettings(updated?.settings) },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
