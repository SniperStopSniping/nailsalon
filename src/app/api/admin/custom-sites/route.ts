import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import { AI_REQUEST_CREDIT_LIMIT } from '@/features/ai-credits/catalog';
import { runWithAiCredits } from '@/features/ai-credits/request-metering.server';
import { AiCreditError } from '@/features/ai-credits/wallet.server';
import { requireSetupOwner } from '@/features/business-setup/access.server';
import { setupAiConfigured } from '@/features/business-setup/ai-trial.server';
import { SetupError } from '@/features/business-setup/contracts';
import { runSetupConversation } from '@/features/business-setup/conversation.server';
import { editSetup, loadSetupHead, lockSetupSalon, readSetupSnapshot } from '@/features/business-setup/drafts.server';
import { reviewCanvaArtwork, saveCustomSource } from '@/features/custom-sites/artifacts.server';
import { assetDataUrl, ownedAssets, uploadCustomAsset } from '@/features/custom-sites/assets.server';
import { canvaLayoutSchema, editCanvaLayout } from '@/features/custom-sites/canva-layout.server';
import { canvaNativePhotoChoices, editCanvaNativeContent } from '@/features/custom-sites/canva-native-edit.server';
import { canvaNativeEditSchema } from '@/features/custom-sites/canva-native-edits';
import { canvaReplaceSchema, replaceCanvaPage } from '@/features/custom-sites/canva-replace.server';
import { customSiteGenerateSchema, customSiteSourceSchema, designBriefSchema } from '@/features/custom-sites/contracts';
import { generateCustomSite, resumeCustomSite } from '@/features/custom-sites/generate.server';
import { editCustomMedia, mediaEditSchema } from '@/features/custom-sites/media-edit.server';
import { customSiteRendererOrigin, setupCustomSitePayload } from '@/features/custom-sites/payload.server';
import { isExplicitServicePriceEdit } from '@/features/custom-sites/price-edit';
import { previewShareInput, revokeCustomPreview, shareCustomPreview } from '@/features/custom-sites/share.server';
import { db } from '@/libs/DB';
import { customSiteArtifactSchema as artifacts, customSiteAssetSchema as assets, customSiteGenerationSchema as jobs, setupAiCallSchema as calls } from '@/models/Schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store' };
const edit = { expectedRevision: z.number().int().positive(), operationId: z.string().uuid() };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review_canva'), input: z.object(edit).strict() }).strict(),
  z.object({ action: z.literal('share'), input: previewShareInput }).strict(),
  z.object({ action: z.literal('revoke_share'), token: previewShareInput.shape.token }).strict(),
  z.object({ action: z.literal('preferences'), input: z.object({ ...edit, values: designBriefSchema }).strict() }).strict(),
  z.object({ action: z.literal('edit_media'), input: mediaEditSchema }).strict(),
  z.object({ action: z.literal('replace_canva_page'), input: canvaReplaceSchema }).strict(),
  z.object({ action: z.literal('edit_canva_layout'), input: canvaLayoutSchema }).strict(),
  z.object({ action: z.literal('edit_native_photos'), input: canvaNativeEditSchema }).strict(),
  z.object({ action: z.literal('generate'), input: customSiteGenerateSchema, acceptedCreditLimitMicroCad: z.literal(AI_REQUEST_CREDIT_LIMIT).optional() }).strict(),
  z.object({ action: z.literal('resume'), operationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('save'), input: z.object({ ...edit, source: customSiteSourceSchema, assetIds: z.array(z.string().uuid()).max(12) }).strict() }).strict(),
  z.object({ action: z.literal('restore'), input: z.object({ ...edit, artifactId: z.string().uuid() }).strict() }).strict(),
]);
function errorResponse(error: unknown, operation: 'load' | 'save' = 'save') {
  if (error instanceof AiCreditError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.code === 'INSUFFICIENT_CREDITS' ? 402 : error.code === 'NOT_CONFIGURED' ? 503 : error.code === 'INVALID' ? 400 : 409, headers });
  }
  const status = error instanceof SetupError ? error.code === 'FORBIDDEN' ? 403 : error.code === 'INVALID' ? 400 : 409 : error instanceof z.ZodError ? 400 : 503;
  const fallback = operation === 'load' ? 'Your saved design could not be loaded. Try again.' : 'The design could not be saved. Your previous version is safe.';
  return Response.json({ error: error instanceof SetupError ? error.message : fallback }, { status, headers });
}
export async function GET(request: Request) {
  const access = await requireSetupOwner(new URL(request.url).searchParams.get('salonSlug') ?? '');
  if (access.response) {
    return access.response;
  }
  try {
    const query = new URL(request.url).searchParams;
    const generation = query.get('generation');
    const assetId = query.get('asset');
    if (generation || assetId) {
      await db.transaction(async (tx) => {
        await lockSetupSalon(tx, access.actor);
      });
      if (generation) {
        z.string().uuid().parse(generation);
        const evidence = await db.select().from(calls).where(and(eq(calls.operationId, generation), eq(calls.salonId, access.actor.salonId))).orderBy(calls.ordinal);
        // Private source evidence is text data, never rendered or executable.
        return Response.json({ evidence: evidence.map(({ rawOutput, model, provider, inputTokens, outputTokens, costMicroUsd, elapsedMs, validation, ordinal }) => ({ rawOutput, model, provider, inputTokens, outputTokens, costMicroUsd, elapsedMs, validation, ordinal })) }, { headers });
      }
      z.string().uuid().parse(assetId);
      const [asset] = await ownedAssets(db, access.actor.salonId, [assetId!]);
      const data = await assetDataUrl(asset!);
      return new Response(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'), { headers: { ...headers, 'Content-Type': asset!.mimeType, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': asset!.mimeType === 'application/pdf' ? 'attachment; filename="reference.pdf"' : 'inline', 'Content-Security-Policy': 'default-src \'none\'; sandbox' } });
    }
    const head = await db.transaction(async (tx) => {
      const salon = await lockSetupSalon(tx, access.actor);
      const head = await loadSetupHead(tx, salon.id);
      if (head.workspace.status === 'editing' && (await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
        throw new SetupError('STALE', 'Your business changed elsewhere. Reload before previewing.');
      }
      return head;
    });
    const document = head.revision.document;
    const history = await db.select({ id: artifacts.id, source: artifacts.source, createdAt: artifacts.createdAt, assetIds: artifacts.assetIds }).from(artifacts).where(eq(artifacts.salonId, access.actor.salonId)).orderBy(desc(artifacts.createdAt)).limit(30);
    const media = await db.select({ id: assets.id, name: assets.name, role: assets.role, mimeType: assets.mimeType }).from(assets).where(eq(assets.salonId, access.actor.salonId)).orderBy(desc(assets.createdAt));
    const attempts = await db.select({ id: jobs.id, status: jobs.status, phase: jobs.phase, message: jobs.message, artifactId: jobs.artifactId, inputTokens: jobs.inputTokens, outputTokens: jobs.outputTokens, costMicroUsd: jobs.costMicroUsd, createdAt: jobs.createdAt }).from(jobs).where(and(eq(jobs.salonId, access.actor.salonId), gte(jobs.expectedRevision, document.sessionStartRevision ?? 1))).orderBy(desc(jobs.createdAt)).limit(30);
    const recoverable = new Set((await db.select({ operationId: calls.operationId }).from(calls).where(and(eq(calls.salonId, access.actor.salonId), eq(calls.status, 'completed')))).map(call => call.operationId));
    const payload = await setupCustomSitePayload(access.actor.salonId, document);
    const nativePhotos = await canvaNativePhotoChoices(access.actor.salonId, payload?.source.canva);
    return Response.json({ head, payload, nativePhotos, preferences: document.designBrief ?? null, configured: setupAiConfigured(), rendererOrigin: customSiteRendererOrigin(), history: history.map(item => ({ id: item.id, title: item.source.title, createdAt: item.createdAt, assetIds: item.assetIds })), assets: media, attempts: attempts.map(attempt => ({ ...attempt, recoverable: Boolean(attempt.artifactId) || recoverable.has(attempt.id) })) }, { headers });
  } catch (e) {
    return errorResponse(e, 'load');
  }
}
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }
  const access = await requireSetupOwner(new URL(request.url).searchParams.get('salonSlug') ?? '');
  if (access.response) {
    return access.response;
  }
  const multipart = request.headers.get('content-type')?.startsWith('multipart/form-data');
  const limit = multipart ? 3100000 : 160000;
  if (Number(request.headers.get('content-length') ?? 0) > limit) {
    return new Response(null, { status: 413 });
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) {
      return new Response(null, { status: 400 });
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    if (multipart) {
      const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
      const file = form.get('file');
      if (!(file instanceof File) || form.get('rightsConfirmed') !== 'true') {
        throw new SetupError('INVALID', 'Confirm you have permission to use these files.');
      }
      const purpose = z.literal('canva_artwork').optional().parse(form.get('purpose') ?? undefined);
      if (purpose && form.get('role') !== 'reference') {
        throw new SetupError('INVALID', 'Choose a Canva design image for this upload.');
      }
      const asset = purpose
        ? await uploadCustomAsset(access.actor, file, 'reference', { artwork: true })
        : await uploadCustomAsset(access.actor, file, form.get('role'));
      return Response.json({ asset }, { headers });
    }
    const parsed = requestSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (parsed.action === 'review_canva') {
      return Response.json(await reviewCanvaArtwork(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'share') {
      return Response.json(await shareCustomPreview(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'revoke_share') {
      await revokeCustomPreview(access.actor, parsed.token);
      return Response.json({ revoked: true }, { headers });
    }
    if (parsed.action === 'preferences') {
      return Response.json({ head: await editSetup(access.actor, { expectedRevision: parsed.input.expectedRevision, operationId: parsed.input.operationId, operations: [{ type: 'design_brief', values: parsed.input.values }] }) }, { headers });
    }
    if (parsed.action === 'edit_media') {
      return Response.json(await editCustomMedia(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'replace_canva_page') {
      return Response.json(await replaceCanvaPage(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'edit_canva_layout') {
      return Response.json(await editCanvaLayout(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'edit_native_photos') {
      return Response.json(await editCanvaNativeContent(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'generate') {
      if (!access.aiEnabled) {
        return Response.json({ error: 'AI is unavailable. Your saved website remains editable.' }, { status: 503, headers });
      }
      const result = await runWithAiCredits(access.actor, 'design', parsed.input, parsed.acceptedCreditLimitMicroCad, async () => isExplicitServicePriceEdit(parsed.input.message)
        ? await runSetupConversation(access.actor, { message: parsed.input.message, operationId: parsed.input.operationId, expectedRevision: parsed.input.expectedRevision, scope: 'service_price' })
        : await generateCustomSite(access.actor, parsed.input));
      return Response.json(result, { headers });
    }
    if (parsed.action === 'save') {
      return Response.json(await saveCustomSource(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'resume') {
      return Response.json(await resumeCustomSite(access.actor, parsed.operationId), { headers });
    }
    return Response.json({ head: await editSetup(access.actor, { expectedRevision: parsed.input.expectedRevision, operationId: parsed.input.operationId, operations: [{ type: 'custom_frontend', artifactId: parsed.input.artifactId }] }) }, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
