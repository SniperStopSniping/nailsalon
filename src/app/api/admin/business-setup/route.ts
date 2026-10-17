import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import { requireSetupOwner } from '@/features/business-setup/access.server';
import { setupEditSchema, SetupError, setupResetSchema } from '@/features/business-setup/contracts';
import { runSetupConversation, setupMessageSchema } from '@/features/business-setup/conversation.server';
import { approveSetup, editSetup, loadSetupHead, lockSetupSalon, openSetup, resetSetupDraft, restartSetup, reviewSetup } from '@/features/business-setup/drafts.server';
import { publishSetup } from '@/features/business-setup/publish.server';
import { applyOwnUpload, dismissOwnUpload, readOwnUpload, readOwnUploadSchema } from '@/features/business-setup/read-upload.server';
import { setupTimeline } from '@/features/business-setup/timeline';
import { db } from '@/libs/DB';
import { businessSetupTurnSchema, customSiteGenerationSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store' };
const base = { salonSlug: z.string().min(1).max(160) };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('open') }).strict(),
  z.object({ ...base, action: z.literal('reset'), input: setupResetSchema }).strict(),
  z.object({ ...base, action: z.literal('restore_previous'), input: setupResetSchema }).strict(),
  z.object({ ...base, action: z.literal('read_upload'), input: readOwnUploadSchema }).strict(),
  z.object({ ...base, action: z.literal('apply_upload'), operationId: z.string().uuid() }).strict(),
  z.object({ ...base, action: z.literal('dismiss_upload'), operationId: z.string().uuid() }).strict(),
  z.object({ ...base, action: z.literal('start_editing'), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ ...base, action: z.literal('message'), message: setupMessageSchema }).strict(),
  z.object({ ...base, action: z.literal('edit'), edit: setupEditSchema }).strict(),
  z.object({ ...base, action: z.literal('review') }).strict(),
  z.object({ ...base, action: z.literal('approve'), revision: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ ...base, action: z.literal('publish'), approvalId: z.string().uuid(), revision: z.number().int().positive(), operationId: z.string().uuid() }).strict(),
]);
function errorResponse(error: unknown) {
  if (error instanceof SetupError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID' ? 400 : 409, headers });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: { code: 'INVALID', message: 'Check the highlighted information and try again.' } }, { status: 400, headers });
  }
  return Response.json({ error: { code: 'UNAVAILABLE', message: 'We could not finish this step. Your saved changes are safe. Please try again.' } }, { status: 503, headers });
}
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get('salonSlug');
  if (!slug) {
    return new Response(null, { status: 400, headers });
  }
  const access = await requireSetupOwner(slug);
  if (access.response) {
    return access.response;
  }
  try {
    const data = await db.transaction(async (tx) => {
      await lockSetupSalon(tx, access.actor);
      const head = await loadSetupHead(tx, access.actor.salonId);
      const start = head.revision.document.sessionStartRevision ?? 1;
      const turns = await tx.select({ id: businessSetupTurnSchema.id, message: businessSetupTurnSchema.message, reply: businessSetupTurnSchema.reply, status: businessSetupTurnSchema.status, createdAt: businessSetupTurnSchema.createdAt, leaseExpiresAt: businessSetupTurnSchema.leaseExpiresAt, designOperationId: businessSetupTurnSchema.designOperationId, operations: businessSetupTurnSchema.operations, expectedRevision: businessSetupTurnSchema.expectedRevision }).from(businessSetupTurnSchema).where(and(eq(businessSetupTurnSchema.salonId, access.actor.salonId), eq(businessSetupTurnSchema.workspaceId, head.workspace.id), gte(businessSetupTurnSchema.expectedRevision, start))).orderBy(desc(businessSetupTurnSchema.createdAt)).limit(40);
      const designs = await tx.select({ id: customSiteGenerationSchema.id, message: customSiteGenerationSchema.message, status: customSiteGenerationSchema.status, createdAt: customSiteGenerationSchema.createdAt }).from(customSiteGenerationSchema).where(and(eq(customSiteGenerationSchema.salonId, access.actor.salonId), gte(customSiteGenerationSchema.expectedRevision, start))).orderBy(desc(customSiteGenerationSchema.createdAt)).limit(40);
      const messages = setupTimeline(turns, designs);
      return { ...head, messages, uploadReviews: turns.filter(turn => turn.status === 'upload_review').map(({ id, operations, reply, expectedRevision }) => ({ id, operations, notes: reply, expectedRevision })) };
    });
    return Response.json({ data }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response(null, { status: 403, headers });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 64000) {
    return new Response(null, { status: 413, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return new Response(null, { status: 400, headers });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      size += part.value.byteLength;
      if (size > 64000) {
        await reader.cancel();
        return new Response(null, { status: 413, headers });
      }
      chunks.push(part.value);
    }
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed: ReturnType<typeof requestSchema.parse>;
  try {
    parsed = requestSchema.parse(JSON.parse(text));
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const access = await requireSetupOwner(parsed.salonSlug);
  if (access.response) {
    return access.response;
  }
  try {
    let data: unknown;
    switch (parsed.action) {
      case 'reset':
      case 'restore_previous':
        data = await resetSetupDraft(access.actor, parsed.input, parsed.action === 'restore_previous');
        break;
      case 'read_upload':
        if (!access.aiEnabled) {
          return Response.json({ error: { message: 'AI is unavailable. Your uploads are saved.' } }, { status: 503, headers });
        }
        data = await readOwnUpload(access.actor, parsed.input);
        break;
      case 'dismiss_upload':
        data = await dismissOwnUpload(access.actor, parsed.operationId);
        break;
      case 'apply_upload':
        data = await applyOwnUpload(access.actor, parsed.operationId);
        break;
      case 'message':
        if (!access.aiEnabled) {
          return Response.json({ error: { message: 'AI is unavailable. Your saved setup is still editable below.' } }, { status: 503, headers });
        }
        data = await runSetupConversation(access.actor, parsed.message);
        break;
      case 'start_editing':
        data = await restartSetup(access.actor, parsed.expectedRevision);
        break;
      case 'open':
        data = await openSetup(access.actor);
        break;
      case 'edit':
        data = await editSetup(access.actor, parsed.edit);
        break;
      case 'review':
        data = await reviewSetup(access.actor);
        break;
      case 'approve':
        data = await approveSetup(access.actor, parsed.revision, parsed.hash);
        break;
      case 'publish':
        if (process.env.BUSINESS_SETUP_PUBLISH_ENABLED !== 'true') {
          return new Response(null, { status: 404, headers });
        }
        data = await publishSetup(access.actor, { approvalId: parsed.approvalId, revision: parsed.revision, operationId: parsed.operationId });
        break;
    }
    return Response.json({ data }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
