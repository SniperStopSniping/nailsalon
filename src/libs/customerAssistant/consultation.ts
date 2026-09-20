import type { PublicCatalogSnapshot } from '@/libs/catalogDomain';
import { resolveCatalogSelection } from '@/libs/catalogResolverCore';

import type { CustomerMenu } from './catalogue.server';
import { planCustomerClarification } from './clarification';
import type { CustomerAssistantLocale, CustomerConsultationChoice, CustomerProposal, CustomerSelection } from './contracts';
import { mergeCatalogChoices, transitionFailure } from './receptionist';
import type { Facts } from './semanticFacts';
import { resolveSemanticSelection, semanticCatalog as vocabulary, type SemanticSelectionResult } from './semanticSelection';

type ConsultationInput = {
  menu: CustomerMenu;
  snapshot: PublicCatalogSnapshot;
  facts: Facts;
  candidate: CustomerSelection | null;
};

/** Server-owned completeness, shared by chat and acceptance; model action cannot bypass it. */
export function assessCustomerConsultation(args: ConsultationInput): SemanticSelectionResult {
  const crossProductRefill = args.facts.maintenance === 'refill' && args.facts.existingProduct !== 'unknown' && args.facts.existingProduct !== 'none' && args.facts.treatment !== 'unknown' && args.facts.treatment !== args.facts.existingProduct;
  if (transitionFailure(args.menu, args.facts) || crossProductRefill) {
    return { kind: 'no_match' };
  }
  // The full model candidate is a hint, not evidence that a paid design was
  // requested. Explicit fact/delta provenance is retained by the server.
  if (args.candidate) {
    args = { ...args, candidate: { ...args.candidate, selectedAddOns: args.candidate.selectedAddOns.filter((line) => {
      const addOn = args.menu.addOns.find(item => item.id === line.addOnId);
      return !addOn || !vocabulary.isDesign(addOn) || (vocabulary.isFrench(addOn) && args.facts.french === 'yes') || args.facts.designChoiceIds?.includes(line.addOnId);
    }) } };
  }
  const plan = (question: Parameters<typeof planCustomerClarification>[0]['question'], candidate = args.candidate, optionIds: string[] = []) => planCustomerClarification({ ...args, candidate, question, optionIds, includeSelection: true, action: 'clarify' });
  const initial = planCustomerClarification({ ...args, question: 'details', optionIds: [], includeSelection: true, action: 'propose' });
  if (initial.kind !== 'selection') {
    // A requested physical length absent from the catalogue is not an
    // included base length. Offer the actual alternatives without pricing it.
    if (initial.kind === 'no_match' && args.facts.length !== 'unknown' && args.candidate) {
      const alternative = planCustomerClarification({ ...args, facts: { ...args.facts, length: 'unknown' }, question: 'length', optionIds: [], action: 'clarify', candidate: { ...args.candidate, selectedAddOns: args.candidate.selectedAddOns.filter(line => !args.menu.addOns.some(item => item.id === line.addOnId && vocabulary.lengthFor(item) !== 'unknown')) } });
      if (alternative.kind === 'clarification' && alternative.question === 'length') {
        return alternative;
      }
    }
    return initial;
  }
  const { facts, menu, snapshot } = args;
  const selection = initial.selection;
  const service = menu.services.find(item => item.id === selection.baseServiceId)!;
  const resolved = resolveCatalogSelection(snapshot, { serviceId: selection.baseServiceId, selectedAddOns: selection.selectedAddOns });
  if (!resolved.ok || resolved.selection.blocksContinue || facts.currentProductUncertain) {
    return { kind: 'no_match' };
  }
  if (facts.existingProduct === 'unknown' && vocabulary.serviceApplication(service) !== 'unknown') {
    return { kind: 'clarification', question: 'product', optionIds: [], selection };
  }
  if (facts.existingProduct !== 'unknown' && facts.existingProduct !== 'none' && facts.maintenance !== 'refill') {
    if (facts.origin === 'unknown' && facts.removal !== 'no') {
      return { kind: 'clarification', question: 'origin', optionIds: [], selection };
    }
    if (facts.removal === 'unknown') {
      return { kind: 'clarification', question: 'removal', optionIds: [], selection };
    }
    if (facts.removal === 'no' && facts.treatment !== 'unknown' && facts.treatment !== facts.existingProduct) {
      return { kind: 'no_match' };
    }
  }
  if (facts.length === 'unknown' && facts.lengthChoice !== 'base' && vocabulary.serviceApplication(service) === 'extensions') {
    const family = menu.l1?.services.find(item => item.id === service.id)?.parentServiceId;
    const variants = family ? menu.services.filter(item => menu.l1?.services.some(variant => variant.id === item.id && variant.parentServiceId === family) && vocabulary.serviceVariantLength(menu, item) !== 'unknown') : [];
    if (variants.length > 1) {
      const viable = variants.filter(variant => planCustomerClarification({ ...args, candidate: { ...selection, baseServiceId: variant.id }, facts: { ...facts, length: vocabulary.serviceVariantLength(menu, variant) }, question: 'details', optionIds: [], action: 'propose' }).kind !== 'no_match');
      if (viable.length > 1) {
        return { kind: 'clarification', question: 'length', optionIds: viable.map(item => item.id).slice(0, 8), selection };
      }
    }
  }
  const hasLength = facts.length !== 'unknown' || facts.lengthChoice === 'base' || vocabulary.serviceVariantLength(menu, service) !== 'unknown';
  if (!hasLength && vocabulary.serviceApplication(service) === 'extensions') {
    const length = plan('length', { ...selection, selectedAddOns: selection.selectedAddOns.filter(line => !menu.addOns.some(item => item.id === line.addOnId && vocabulary.lengthFor(item) !== 'unknown')) });
    if (length.kind !== 'selection') {
      return length;
    }
  }
  // No French says nothing about chrome/art. A selected design or an explicit
  // plain/skip choice settles this optional question without repeatedly upselling.
  const designSettled = facts.designPreference === 'plain' || facts.designPreference === 'skip' || (facts.designPreference === 'selected' && facts.designChoiceIds !== undefined)
    || facts.french === 'yes'
    || resolved.selection.addOns.some(line => line.autoAdded && menu.addOns.some(item => item.id === line.addOnId && vocabulary.isDesign(item)));
  if (!designSettled) {
    const designs = menu.addOns.filter(item => vocabulary.isDesign(item)
      && !(facts.french === 'no' && vocabulary.isFrench(item))).map(item => item.id);
    if (designs.length) {
      const design = plan('finish', selection, designs);
      if (design.kind !== 'selection') {
        return design;
      }
    }
  }
  return initial;
}

/** Prices are complete valid L1 outcomes; incomplete witnesses never become quoted totals. */
export function customerConsultationChoices(args: ConsultationInput & {
  result: Extract<SemanticSelectionResult, { kind: 'clarification' }>;
  locale: CustomerAssistantLocale;
}): CustomerConsultationChoice[] {
  const { menu, snapshot, result, locale } = args;
  const candidate = result.selection ?? args.candidate;
  const resolve = (selection: CustomerSelection | null) => {
    if (!selection) {
      return null;
    }
    const outcome = resolveCatalogSelection(snapshot, { serviceId: selection.baseServiceId, selectedAddOns: selection.selectedAddOns });
    return outcome.ok && !outcome.selection.blocksContinue ? outcome.selection : null;
  };
  const baseline = resolve(candidate);
  const priced = (label: string, message: string, selection: CustomerSelection | null): CustomerConsultationChoice => {
    const quote = resolve(selection);
    return { label, message, ...(quote
      ? {
          subtotalCents: quote.subtotalCents,
          durationMinutes: quote.totalDurationMinutes,
          currency: snapshot.currency,
          ...(baseline ? { deltaCents: quote.subtotalCents - baseline.subtotalCents } : {}),
        }
      : {}) };
  };
  const choices = result.optionIds.flatMap((id) => {
    const service = menu.services.find(item => item.id === id);
    const addOn = menu.addOns.find(item => item.id === id);
    if (service) {
      const draft = mergeCatalogChoices({ menu, previous: candidate, serviceId: id, addOns: [], updates: { add: [], remove: [] } });
      const length = vocabulary.serviceVariantLength(menu, service);
      const semantic = resolveSemanticSelection({ menu, facts: { ...args.facts, ...(length !== 'unknown' ? { length, lengthChoice: undefined } : {}) }, candidate: draft });
      return [priced(service.name, service.name, semantic.kind === 'selection' ? semantic.selection : null)];
    }
    if (!addOn || !candidate) {
      return addOn ? [{ label: addOn.name, message: addOn.name }] : [];
    }
    const groupId = snapshot.addOns.find(item => item.id === id)?.groupId;
    const singleSelect = groupId && snapshot.addOnGroups.some(item => item.id === groupId && (item.isSingleSelect || item.maxSelections === 1));
    const choicesToKeep = candidate.selectedAddOns.filter((choice) => {
      if (choice.addOnId === id) {
        return false;
      }
      const existing = menu.addOns.find(item => item.id === choice.addOnId);
      if (result.question === 'length' && existing && vocabulary.lengthFor(existing) !== 'unknown') {
        return false;
      }
      return !singleSelect || snapshot.addOns.find(item => item.id === choice.addOnId)?.groupId !== groupId;
    });
    return [priced(addOn.name, addOn.name, { ...candidate, selectedAddOns: [...choicesToKeep, { addOnId: id, quantity: 1 }] })];
  });
  if (result.question === 'length' && candidate && menu.services.some(item => item.id === candidate.baseServiceId && vocabulary.serviceVariantLength(menu, item) === 'unknown')) {
    const base = { ...candidate, selectedAddOns: candidate.selectedAddOns.filter(item => !menu.addOns.some(addOn => addOn.id === item.addOnId && vocabulary.lengthFor(addOn) !== 'unknown')) };
    if (resolve(base)) {
      const label = locale === 'fr' ? 'Service de base / sans supplément de longueur' : 'Base service / no length upgrade';
      choices.splice(7);
      choices.unshift(priced(label, label, base));
    }
  }
  if (result.question === 'finish') {
    const plain = locale === 'fr' ? 'Sans décoration' : 'Plain / no extras';
    const skip = locale === 'fr' ? 'Passer' : 'Skip for now';
    const withoutDesign = candidate && { ...candidate, selectedAddOns: candidate.selectedAddOns.filter(item => !menu.addOns.some(addOn => addOn.id === item.addOnId && vocabulary.isDesign(addOn))) };
    // A required design group may not offer a plain choice. The valid quote is
    // the authority, not the presence of a generic optional UI label.
    if (resolve(withoutDesign)) {
      choices.splice(6);
      choices.push(priced(plain, plain, withoutDesign), priced(skip, skip, candidate));
    }
  }
  return choices;
}

/** Display-only decisions, attached only after the shared readiness assessment succeeds. */
export function withConsultationConfiguration(proposal: CustomerProposal, facts: Facts, locale: CustomerAssistantLocale, menu: CustomerMenu): CustomerProposal {
  const configuration: string[] = [];
  if (facts.lengthChoice === 'base') {
    configuration.push(locale === 'fr' ? 'Service de base / sans supplément de longueur' : 'Base service / no length upgrade');
  }
  const hasDesign = proposal.addOns.some(item => menu.addOns.some(addOn => addOn.id === item.id && vocabulary.isDesign(addOn)));
  if (!hasDesign && facts.designPreference === 'plain') {
    configuration.push(locale === 'fr' ? 'Couleur unie / sans décoration' : 'Plain colour / no nail art');
  } else if (!hasDesign && facts.designPreference === 'skip') {
    configuration.push(locale === 'fr' ? 'Aucune décoration supplémentaire choisie' : 'No additional design selected');
  }
  return configuration.length ? { ...proposal, configuration } : proposal;
}

/** A read-only configured quote is safe when only the optional design offer remains. */
export function customerPartialQuoteSelection(args: ConsultationInput): CustomerSelection | null {
  const assessment = assessCustomerConsultation(args);
  return assessment.kind === 'clarification' && assessment.question === 'finish'
    ? assessment.selection ?? null
    : null;
}
