import 'server-only';

import type { SalonFeatures } from '@/types/salonPolicy';

import { buildCustomerProposal, loadCustomerClarificationSnapshot, loadCustomerMenu } from './catalogue.server';
import { assessCustomerConsultation, customerConsultationChoices, withConsultationConfiguration } from './consultation';
import type { CustomerAssistantLocale, CustomerAssistantResult, CustomerSelection } from './contracts';
import type { CustomerConversation } from './conversation.server';
import { emptyFacts } from './semanticFacts';
import { selectionConflictsWithExplicitFacts } from './semanticSelection';

function selectionIdentity(selection: CustomerSelection): string {
  return JSON.stringify([selection.baseServiceId, selection.selectedAddOns.map(item => [item.addOnId, item.quantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

/** Recompute readiness from current tenant authority; a signed draft is not acceptance authority. */
export async function assessReadyCustomerProposal(args: {
  salonId: string;
  features: SalonFeatures | null;
  state: CustomerConversation;
  locale?: CustomerAssistantLocale;
}): Promise<{ proposal: Awaited<ReturnType<typeof buildCustomerProposal>> | null; clarification?: Extract<CustomerAssistantResult, { kind: 'clarification' }> }> {
  const selection = args.state.context?.selection;
  if (!selection) {
    return { proposal: null };
  }
  const [menu, snapshot] = await Promise.all([
    loadCustomerMenu(args.salonId, args.features),
    loadCustomerClarificationSnapshot(args.salonId),
  ]);
  const facts = args.state.facts ?? emptyFacts();
  const assessment = assessCustomerConsultation({ menu, snapshot, facts, candidate: selection });
  if (assessment.kind === 'clarification') {
    const choices = customerConsultationChoices({ menu, snapshot, facts, candidate: selection, result: assessment, locale: args.locale ?? 'en' });
    const options = choices.length
      ? choices.map(choice => choice.label)
      : assessment.optionIds.flatMap((id) => {
        const item = [...menu.services, ...menu.addOns].find(item => item.id === id);
        return item ? [item.name] : [];
      });
    return { proposal: null, clarification: { kind: 'clarification', question: assessment.question, options, ...(choices.length ? { choices } : {}) } };
  }
  if (assessment.kind !== 'selection' || selectionIdentity(assessment.selection) !== selectionIdentity(selection)) {
    return { proposal: null };
  }
  const proposal = await buildCustomerProposal(args.salonId, args.features, selection);
  const quotedSelection = { baseServiceId: proposal.service.id, selectedAddOns: proposal.addOns.map(item => ({ addOnId: item.id, quantity: item.quantity })) };
  if (selectionConflictsWithExplicitFacts(menu, facts, quotedSelection)) {
    return { proposal: null };
  }
  return { proposal: withConsultationConfiguration(proposal, facts, args.locale ?? 'en', menu) };
}

export async function buildReadyCustomerProposal(args: Parameters<typeof assessReadyCustomerProposal>[0]): Promise<Awaited<ReturnType<typeof buildCustomerProposal>> | null> {
  return (await assessReadyCustomerProposal(args)).proposal;
}
