import { z } from 'zod';

import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { Env } from '@/libs/Env';
import {
  applyMenuOrder,
  getMenuOperation,
  getOwnerAssistantMenu,
  MenuOrderError,
  prepareMenuOrder,
  undoMenuOrder,
} from '@/libs/ownerAssistant/menuOrder.server';

export const dynamic = 'force-dynamic';
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

const querySchema = z.object({
  salonSlug: z.string().trim().min(1),
  proposalId: z.string().trim().min(1).optional(),
});
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), salonSlug: z.string().trim().min(1), idempotencyKey: z.string().uuid(), orderedIds: z.array(z.string().min(1)).min(1).max(300) }).strict(),
  z.object({ action: z.literal('apply'), salonSlug: z.string().trim().min(1), proposalId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('undo'), salonSlug: z.string().trim().min(1), proposalId: z.string().min(1) }).strict(),
]);

function disabled(): Response {
  return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
}

function errorResponse(error: unknown): Response {
  if (error instanceof MenuOrderError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_ORDER' ? 400 : 409;
    return Response.json({ error: { code: error.code, message: error.message } }, { status });
  }
  console.error('Owner assistant menu action failed:', error);
  return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'The menu action could not be completed.' } }, { status: 500 });
}

async function ownerContext(salonSlug: string) {
  const active = await requireAdminSalonForSlug(salonSlug, { persistActiveSalon: false });
  if (active.error || !active.salon) {
    return { error: active.error!, salon: null, admin: null };
  }
  // Re-authenticate immediately before business reads/writes. This rejects
  // super-admin impersonation and requires the actor's own owner membership.
  const owner = await requireRealSalonOwner(active.salon.id);
  if (!owner.ok) {
    return { error: owner.response, salon: null, admin: null };
  }
  return { error: null, salon: active.salon, admin: owner.admin };
}

export async function GET(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return disabled();
  }
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid owner assistant request.' } }, { status: 400 });
  }
  const context = await ownerContext(parsed.data.salonSlug);
  if (context.error || !context.salon || !context.admin) {
    return context.error!;
  }
  try {
    if (parsed.data.proposalId) {
      const operation = await getMenuOperation({ salonId: context.salon.id, actorAdminId: context.admin.id, proposalId: parsed.data.proposalId });
      return Response.json({ data: operation.status === 'ready' || operation.status === 'no_op' ? { proposal: operation } : { receipt: operation } }, { headers: PRIVATE_NO_STORE });
    }
    const menu = await getOwnerAssistantMenu(context.salon.id);
    return Response.json({ data: { enabled: true, menu: menu.menu } }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (Env.OWNER_ASSISTANT_ENABLED !== 'true') {
    return disabled();
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid owner assistant action.' } }, { status: 400 });
  }
  const context = await ownerContext(parsed.data.salonSlug);
  if (context.error || !context.salon || !context.admin) {
    return context.error!;
  }
  try {
    if (parsed.data.action === 'prepare') {
      const proposal = await prepareMenuOrder({ salonId: context.salon.id, actorAdminId: context.admin.id, idempotencyKey: parsed.data.idempotencyKey, orderedIds: parsed.data.orderedIds });
      return Response.json({ data: { proposal } }, { headers: PRIVATE_NO_STORE });
    }
    const receipt = parsed.data.action === 'apply'
      ? await applyMenuOrder({ salonId: context.salon.id, actorAdminId: context.admin.id, proposalId: parsed.data.proposalId })
      : await undoMenuOrder({ salonId: context.salon.id, actorAdminId: context.admin.id, proposalId: parsed.data.proposalId });
    return Response.json({ data: { receipt } }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
