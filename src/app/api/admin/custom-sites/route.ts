import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireSetupOwner } from '@/features/business-setup/access.server';
import { SetupError } from '@/features/business-setup/contracts';
import { editSetup, loadSetupHead, lockSetupSalon, readSetupSnapshot } from '@/features/business-setup/drafts.server';
import { saveCustomSource } from '@/features/custom-sites/artifacts.server';
import { uploadCustomAsset } from '@/features/custom-sites/assets.server';
import { customSiteGenerateSchema, customSiteSourceSchema } from '@/features/custom-sites/contracts';
import { generateCustomSite } from '@/features/custom-sites/generate.server';
import { customSitePayload, customSiteRendererOrigin } from '@/features/custom-sites/payload.server';
import { db } from '@/libs/DB';
import { customSiteArtifactSchema as artifacts, customSiteAssetSchema as assets, customSiteGenerationSchema as jobs } from '@/models/Schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;
const headers = { 'Cache-Control': 'private, no-store' };
const edit = { expectedRevision: z.number().int().positive(), operationId: z.string().uuid() };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), input: customSiteGenerateSchema }).strict(),
  z.object({ action: z.literal('save'), input: z.object({ ...edit, source: customSiteSourceSchema, assetIds: z.array(z.string().uuid()).max(12) }).strict() }).strict(),
  z.object({ action: z.literal('restore'), input: z.object({ ...edit, artifactId: z.string().uuid() }).strict() }).strict(),
]);
function errorResponse(error: unknown) {
  const status = error instanceof SetupError ? error.code === 'FORBIDDEN' ? 403 : error.code === 'INVALID' ? 400 : 409 : error instanceof z.ZodError ? 400 : 503;
  return Response.json({ error: error instanceof SetupError ? error.message : 'The design could not be saved. Your previous version is safe.' }, { status, headers });
}
export async function GET(request: Request) {
  const access = await requireSetupOwner(new URL(request.url).searchParams.get('salonSlug') ?? '');
  if (access.response) {
    return access.response;
  }
  try {
    const head = await db.transaction(async (tx) => {
      const salon = await lockSetupSalon(tx, access.actor);
      const head = await loadSetupHead(tx, salon.id);
      if (head.workspace.status === 'editing' && (await readSetupSnapshot(tx, salon)).hash !== head.workspace.baselineHash) {
        throw new SetupError('STALE', 'Your business changed elsewhere. Reload before previewing.');
      }
      return head;
    });
    const document = head.revision.document;
    const id = document.website.config.customFrontendId;
    const history = await db.select({ id: artifacts.id, source: artifacts.source, createdAt: artifacts.createdAt, assetIds: artifacts.assetIds }).from(artifacts).where(eq(artifacts.salonId, access.actor.salonId)).orderBy(desc(artifacts.createdAt)).limit(30);
    const media = await db.select({ id: assets.id, name: assets.name, role: assets.role, mimeType: assets.mimeType }).from(assets).where(eq(assets.salonId, access.actor.salonId)).orderBy(desc(assets.createdAt));
    const attempts = await db.select({ id: jobs.id, status: jobs.status, message: jobs.message, artifactId: jobs.artifactId, inputTokens: jobs.inputTokens, outputTokens: jobs.outputTokens, costMicroUsd: jobs.costMicroUsd }).from(jobs).where(eq(jobs.salonId, access.actor.salonId)).orderBy(desc(jobs.createdAt)).limit(30);
    const payload = id ? await customSitePayload(access.actor.salonId, id, { business: { name: document.business.name, city: document.business.city, address: document.business.locationDisplayMode === 'full_address' ? document.business.exactAddress : null, bio: document.website.content.bio ?? '', hours: document.hours }, services: document.services.filter(s => s.priceCents !== null && s.durationMinutes !== null).map(s => ({ id: `setup_preview_${s.id}`, name: s.name, description: s.description, priceCents: s.priceCents!, priceLabel: new Intl.NumberFormat('en-CA', { style: 'currency', currency: document.booking.currency }).format(s.priceCents! / 100), durationMinutes: s.durationMinutes! })), currency: document.booking.currency, preview: true }) : null;
    return Response.json({ head, payload, rendererOrigin: customSiteRendererOrigin(), history: history.map(item => ({ id: item.id, title: item.source.title, createdAt: item.createdAt, assetIds: item.assetIds })), assets: media, attempts }, { headers });
  } catch (e) {
    return errorResponse(e);
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
        throw new SetupError('INVALID', 'Confirm you may use these files. Reference content is used for inspiration only.');
      }
      return Response.json({ asset: await uploadCustomAsset(access.actor, file, form.get('role')) }, { headers });
    }
    const parsed = requestSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (parsed.action === 'generate') {
      if (!access.aiEnabled) {
        return Response.json({ error: 'AI is unavailable. Your saved website remains editable.' }, { status: 503, headers });
      }
      return Response.json(await generateCustomSite(access.actor, parsed.input), { headers });
    }
    if (parsed.action === 'save') {
      return Response.json(await saveCustomSource(access.actor, parsed.input), { headers });
    }
    return Response.json({ head: await editSetup(access.actor, { expectedRevision: parsed.input.expectedRevision, operationId: parsed.input.operationId, operations: [{ type: 'custom_frontend', artifactId: parsed.input.artifactId }] }) }, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
