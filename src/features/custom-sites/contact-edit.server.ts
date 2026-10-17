import 'server-only';

import type { SetupOperation } from '@/features/business-setup/contracts';
import { applySetupOperations, SetupError } from '@/features/business-setup/contracts';
import type { SetupActor } from '@/features/business-setup/drafts.server';
import { editSetup, loadSetupHead, lockSetupSalon } from '@/features/business-setup/drafts.server';
import { db } from '@/libs/DB';

import { assertCustomArtifact, storeCustomArtifact } from './artifacts.server';
import { bindWebsiteContacts, recoverSavedContacts } from './contacts.server';
import { assertWebsiteDetailsCoverage } from './website-coverage.server';

/**
 * Uses the normal authorization, immutable source and shared draft revision path.
 * No provider calls, public writes or publication authority.
 */
export async function repairDraftContacts(actor: SetupActor, input: { expectedRevision: number; operationId: string; required?: string }, operations: SetupOperation[] = []) {
  const head = await db.transaction(async (tx) => {
    await lockSetupSalon(tx, actor);
    return loadSetupHead(tx, actor.salonId);
  });
  const id = head.revision.document.website.config.customFrontendId;
  if (!id) {
    throw new SetupError('NOT_READY', 'First create a website draft so I can connect its contact links.');
  }
  const { artifact } = await assertCustomArtifact(db, actor.salonId, id);
  const proposed = applySetupOperations(head.revision.document, operations, 'assistant');
  const details = recoverSavedContacts(artifact.source.html, proposed.website.content.websiteDetails, true);
  const required = input.required?.toLowerCase();
  const missing = required?.includes('instagram') && !details.instagram ? 'Instagram handle' : required?.includes('email') && !details.email ? 'email address' : required?.includes('phone') && !details.phone ? 'phone number' : null;
  if (missing) {
    throw new SetupError('INVALID', `What ${missing} should customers use? I could not find one clearly in your saved design.`);
  }
  if (!details.instagram && !details.email && !details.phone) {
    throw new SetupError('INVALID', 'What Instagram handle, email address or phone number should I connect?');
  }
  const source = bindWebsiteContacts(artifact.source, details);
  assertWebsiteDetailsCoverage(source.html, details);
  const saved = await storeCustomArtifact(actor, { source, assetIds: artifact.assetIds, expectedRevision: input.expectedRevision, operationId: input.operationId });
  return editSetup(actor, { expectedRevision: input.expectedRevision, operationId: input.operationId, operations: [...operations, { type: 'website_details', values: details }, { type: 'custom_frontend', artifactId: saved.id }] });
}
