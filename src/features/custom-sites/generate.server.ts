import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon, setupHash } from '@/features/business-setup/drafts.server';
import { createOpenAiResponsesProvider } from '@/libs/ai/openaiResponses.server';
import type { ModelProviderInputItem, ModelProviderRequest, OwnerAssistantModelProvider } from '@/libs/ai/provider';
import { db } from '@/libs/DB';
import { customSiteArtifactSchema as artifacts, customSiteGenerationSchema as jobs } from '@/models/Schema';

import { storeCustomArtifact } from './artifacts.server';
import { assetDataUrl, ownedAssets } from './assets.server';
import { customSiteGenerateSchema, customSiteSourceSchema } from './contracts';
import { CUSTOM_SITE_OUTPUT_SCHEMA, CUSTOM_SITE_PROMPT } from './prompt';

// Each paid generation is admitted only after exact multimodal token counting.
const MAX_OUTPUT = 14000;
export async function generateCustomSite(actor: SetupActor, raw: unknown, providerOverride?: OwnerAssistantModelProvider) {
  const input = customSiteGenerateSchema.parse(raw);
  const key = process.env.OPENAI_API_KEY_CUSTOM_SITES;
  const limit = Number(process.env.CUSTOM_SITE_TRIAL_BUDGET_USD ?? '0');
  if (!providerOverride && (!key || !Number.isFinite(limit) || limit <= 0 || limit > 100)) {
    throw new SetupError('NOT_READY', 'AI website design is not available yet. Your draft is saved, and you can keep editing.');
  }
  const admitted = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    const head = await loadSetupHead(tx, actor.salonId);
    const [previous] = await tx.select().from(jobs).where(eq(jobs.id, input.operationId));
    if (previous) {
      if (previous.salonId !== actor.salonId || previous.actorId !== actor.adminId || previous.requestHash !== setupHash(input)) {
        throw new SetupError('INVALID', 'This request was already used.');
      }
      return { job: previous, head, isNew: false };
    }
    if (head.workspace.status !== 'editing' || head.revision.revision !== input.expectedRevision) {
      throw new SetupError('STALE', 'Reload the latest saved changes before generating.');
    }
    const history = await tx.select().from(jobs).where(eq(jobs.salonId, actor.salonId)).orderBy(desc(jobs.createdAt));
    if (history.some(j => j.status === 'pending' && j.createdAt.getTime() > Date.now() - 180000)) {
      throw new SetupError('NOT_READY', 'Your design is still being generated. Reload to see the result.');
    }
    if (history.length >= 30) {
      throw new SetupError('NOT_READY', 'This design trial has reached its usage limit. Saved designs remain editable.');
    }
    await ownedAssets(tx, actor.salonId, input.referenceIds);
    const [job] = await tx.insert(jobs).values({ id: input.operationId, salonId: actor.salonId, actorId: actor.adminId, expectedRevision: input.expectedRevision, requestHash: setupHash(input), message: input.message, status: 'pending', reservedMicroUsd: 0 }).returning();
    return { job: job!, head, isNew: true };
  });
  if (!admitted.isNew && !admitted.job.artifactId) {
    throw new SetupError('NOT_READY', admitted.job.status === 'failed' || admitted.job.createdAt.getTime() < Date.now() - 180000 ? 'That generation was interrupted. Your saved design is safe. Start a new attempt.' : 'That design is still being generated. Reload to see the result.');
  }
  let artifactId = admitted.job.artifactId;
  if (!artifactId) {
    try {
      const document = admitted.head.revision.document;
      const priorId = document.website.config.customFrontendId;
      const [prior] = priorId && !input.startOver ? await db.select().from(artifacts).where(and(eq(artifacts.salonId, actor.salonId), eq(artifacts.id, priorId))) : [];
      const assetIds = [...new Set([...input.referenceIds, ...(prior?.assetIds ?? [])])];
      if (assetIds.length > 12) {
        throw new SetupError('INVALID', 'Choose fewer references for this design.');
      }
      const media = await ownedAssets(db, actor.salonId, assetIds);
      const context = JSON.stringify({ business: { name: document.business.name, city: document.business.city, address: document.business.locationDisplayMode === 'full_address' ? document.business.exactAddress : null, bio: document.website.content.bio }, services: document.services.map(s => ({ name: s.name, description: s.description })), previousSource: prior?.source ?? null, assets: media.map(a => ({ id: a.id, role: a.role, name: a.name })), startOver: input.startOver });
      if (Buffer.byteLength(context + CUSTOM_SITE_PROMPT + input.message) > 140000) {
        throw new SetupError('INVALID', 'This design is too large for one generation. Simplify the saved source first.');
      }
      const parts: Extract<ModelProviderInputItem, { role: 'user'; content: unknown[] }>['content'] = [{ type: 'input_text', text: input.message }];
      // Send selected references only. Inherited website images retain identity
      // without resending every binary on each small source modification.
      for (const asset of media.filter(a => input.referenceIds.includes(a.id))) {
        const url = await assetDataUrl(asset);
        parts.push({ type: 'input_text', text: `Untrusted ${asset.role} asset ${asset.id}: ${asset.name}. ${asset.role === 'reference' ? 'Visual inspiration only; do not reuse its protected content.' : 'Owner-authorized website asset.'}` });
        parts.push(asset.mimeType === 'application/pdf' ? { type: 'input_file', filename: 'reference.pdf', file_data: url } : { type: 'input_image', image_url: url, detail: 'high' });
      }
      const provider = providerOverride ?? createOpenAiResponsesProvider({ apiKey: key! });
      const request: ModelProviderRequest = { model: 'gpt-6-astra', input: [{ role: 'system', content: CUSTOM_SITE_PROMPT }, { role: 'developer', content: context }, { role: 'user', content: parts }], tools: [], toolChoice: 'none', maxOutputTokens: MAX_OUTPUT, timeoutMs: 120000, jsonMode: 'schema', jsonSchema: CUSTOM_SITE_OUTPUT_SCHEMA, reasoningEffort: 'medium' };
      const counted = provider.countInputTokens ? await provider.countInputTokens(request) : providerOverride ? 10000 : null;
      if (counted === null || !Number.isSafeInteger(counted) || counted < 0 || counted > 150000) {
        throw new SetupError('NOT_READY', 'These references are too large or could not be measured. Try fewer pages or images.');
      }
      // Astra cache writes cost more than uncached input. Reserve the higher
      // rate plus maximum output, with 10% margin. Requests stay below long-context pricing.
      const reservation = Math.ceil((counted * 12.5 + MAX_OUTPUT * 50) * 1.1);
      await db.transaction(async (tx) => {
        await lockSetupSalon(tx, actor);
        const latest = await loadSetupHead(tx, actor.salonId);
        if (latest.workspace.status !== 'editing' || latest.revision.revision !== input.expectedRevision) {
          throw new SetupError('STALE', 'Your design changed while the references were being checked. Reload before generating.');
        }
        const history = await tx.select().from(jobs).where(eq(jobs.salonId, actor.salonId));
        if (history.reduce((sum, job) => sum + (job.id === input.operationId ? 0 : job.costMicroUsd ?? job.reservedMicroUsd), 0) + reservation > (providerOverride ? 100 : limit) * 1000000) {
          throw new SetupError('NOT_READY', 'This request would exceed the authorized AI trial budget. Your saved design is unchanged.');
        }
        await tx.update(jobs).set({ reservedMicroUsd: reservation }).where(and(eq(jobs.id, input.operationId), eq(jobs.salonId, actor.salonId)));
      });
      const result = await provider.createResponse(request);
      const usage = result.usage;
      const cost = usage ? Math.ceil(((usage.inputTokens - usage.cachedInputTokens - (usage.cacheWriteInputTokens ?? 0)) * 10 + usage.cachedInputTokens + (usage.cacheWriteInputTokens ?? 0) * 12.5) * (usage.inputTokens > 272000 ? 2 : 1) + usage.outputTokens * 50 * (usage.inputTokens > 272000 ? 1.5 : 1)) : null;
      await db.update(jobs).set({ inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, costMicroUsd: cost }).where(and(eq(jobs.id, input.operationId), eq(jobs.salonId, actor.salonId)));
      if (result.status !== 'completed') {
        throw new SetupError('NOT_READY', 'AI did not finish the design. Your previous version is safe.');
      }
      const source = customSiteSourceSchema.parse(JSON.parse(result.items.filter(i => i.type === 'message').map(i => i.type === 'message' ? i.text : '').join('')));
      const artifact = await storeCustomArtifact(actor, { source, assetIds, expectedRevision: input.expectedRevision, operationId: input.operationId });
      artifactId = artifact.id;
      await db.update(jobs).set({ status: 'generated', artifactId }).where(and(eq(jobs.id, input.operationId), eq(jobs.salonId, actor.salonId)));
    } catch (e) {
      await db.update(jobs).set({ status: 'failed' }).where(and(eq(jobs.id, input.operationId), eq(jobs.salonId, actor.salonId)));
      if (e instanceof SetupError) {
        throw e;
      }
      throw new SetupError('NOT_READY', 'The design could not be generated or validated. Your saved website is unchanged. Try again with a smaller request.');
    }
  }
  const head = await editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: [{ type: 'custom_frontend', artifactId }] }, 'assistant');
  await db.update(jobs).set({ status: 'completed' }).where(and(eq(jobs.id, input.operationId), eq(jobs.salonId, actor.salonId)));
  return { head, artifactId };
}
