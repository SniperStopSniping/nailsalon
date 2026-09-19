import type { CatalogResolutionResult, PublicCatalogSnapshot } from '@/libs/catalogDomain';
import { resolveCatalogSelection } from '@/libs/catalogResolverCore';

import type { CustomerMenu } from './catalogue.server';
import type { CustomerSelection } from './contracts';
import { type Facts, hasKnownClarificationAnswer } from './semanticFacts';
import { resolveSemanticSelection, selectionConflictsWithExplicitFacts, semanticCatalog as vocabulary, type SemanticClarificationQuestion, type SemanticSelectionResult } from './semanticSelection';

type AddOn = CustomerMenu['addOns'][number];
type Requirement = { ids: string[]; quantity: number; question: SemanticClarificationQuestion };
type Seed = { selection: CustomerSelection; questions: SemanticClarificationQuestion[]; requirements: Requirement[] };

function dimension(addOn: AddOn, question: SemanticClarificationQuestion): boolean {
  switch (question) {
    case 'length': return vocabulary.lengthFor(addOn) !== 'unknown';
    case 'removal':
    case 'product':
    case 'origin': return vocabulary.isRemoval(addOn);
    case 'quantity': return vocabulary.isRepair(addOn) && addOn.pricingType === 'per_unit';
    case 'finish': return vocabulary.isFrench(addOn) || /\b(?:chrome|art|design|finish)\b/i.test(addOn.name);
    default: return false;
  }
}

/**
 * Clarification planning uses the same L1 resolver as manual booking. A search
 * witness proves only that a choice can be completed, never that the customer
 * chose the witness's required/optional additions. No totals are computed here.
 * Snapshot is server-only call data and must never be included in model input.
 */
export function planCustomerClarification(args: {
  menu: CustomerMenu;
  snapshot: PublicCatalogSnapshot;
  facts: Facts;
  candidate: CustomerSelection | null;
  question: SemanticClarificationQuestion;
  optionIds: string[];
  maxVisits?: number;
  action?: 'propose' | 'clarify';
}): SemanticSelectionResult {
  const { menu, snapshot, facts, candidate, question, optionIds } = args;
  const candidateService = candidate && menu.services.find(item => item.id === candidate.baseServiceId);
  // Preserve the semantic mapper's out-of-vocabulary boundary: a named combo
  // must never become a hand-only service merely because one fact matches it.
  if (candidateService && facts.treatment !== 'unknown' && vocabulary.serviceFamily(candidateService) === 'unknown') {
    return { kind: 'no_match' };
  }
  const publicIds = new Set([...menu.services, ...menu.addOns].map(item => item.id));
  if ((candidate && !menu.services.some(item => item.id === candidate.baseServiceId))
    || candidate?.selectedAddOns.some(item => !menu.addOns.some(addOn => addOn.id === item.addOnId))
    || optionIds.some(id => !publicIds.has(id))) {
    return { kind: 'no_match' };
  }
  const serviceIds = new Set(menu.services.map(item => item.id));
  const addOnIds = new Set(menu.addOns.map(item => item.id));
  let visits = 0;
  let exhausted = false;
  const limit = Math.min(512, Math.max(0, args.maxVisits ?? 512));
  const resolvedCache = new Map<string, CatalogResolutionResult>();
  const keyFor = (selection: CustomerSelection) => JSON.stringify([selection.baseServiceId, [...selection.selectedAddOns].sort((a, b) => a.addOnId.localeCompare(b.addOnId))]);
  const inspect = (selection: CustomerSelection): CatalogResolutionResult | null => {
    const key = keyFor(selection);
    const cached = resolvedCache.get(key);
    if (cached) {
      return cached;
    }
    if (visits >= limit) {
      exhausted = true;
      return null;
    }
    visits += 1;
    const result = resolveCatalogSelection(snapshot, { serviceId: selection.baseServiceId, selectedAddOns: selection.selectedAddOns });
    resolvedCache.set(key, result);
    return result;
  };
  const withChoice = (selection: CustomerSelection, id: string, quantity = 1): CustomerSelection => ({
    ...selection,
    selectedAddOns: [...selection.selectedAddOns.filter(item => item.addOnId !== id), { addOnId: id, quantity }],
  });

  const witness = (seed: CustomerSelection, requirements: Requirement[], seen = new Set<string>()): boolean => {
    const key = keyFor(seed);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    const result = inspect(seed);
    if (!result?.ok || result.selection.violations.some(item => !['group_selection_below_minimum', 'required_dependency_unmet'].includes(item.code))) {
      return false;
    }
    const missing = result.selection.violations[0];
    let choices: string[] = [];
    let quantity = 1;
    if (missing?.anchor.kind === 'group') {
      const groupId = missing.anchor.groupId;
      choices = snapshot.addOns.filter(item => item.groupId === groupId && addOnIds.has(item.id)).map(item => item.id);
    } else if (missing?.anchor.kind === 'addOn') {
      choices = addOnIds.has(missing.anchor.addOnId) ? [missing.anchor.addOnId] : [];
    } else if (!missing) {
      const unmet = requirements.find(required => !result.selection.addOns.some(item => required.ids.includes(item.addOnId) && item.quantity === required.quantity));
      if (!unmet) {
        return !selectionConflictsWithExplicitFacts(menu, facts, seed, result.selection.addOns.map(item => ({ id: item.addOnId, quantity: item.quantity })));
      }
      choices = unmet.ids;
      quantity = unmet.quantity;
    }
    return choices.some(id => !seed.selectedAddOns.some(item => item.addOnId === id) && witness(withChoice(seed, id, quantity), requirements, seen));
  };

  const compatibleServices = menu.services.filter(service => serviceIds.has(service.id)
    && snapshot.services.some(item => item.id === service.id && item.effectiveConfirmationMode !== 'consultation')
    && (facts.treatment === 'unknown' || vocabulary.serviceFamily(service) === facts.treatment)
    && (facts.desiredApplication === 'unknown' || vocabulary.serviceApplication(service) === facts.desiredApplication)
    && (facts.maintenance === 'unknown' || vocabulary.isRefill(service) === (facts.maintenance === 'refill'))
    && !(facts.maintenance === 'unknown' && facts.existingProduct === 'none' && vocabulary.isRefill(service))
    && (facts.length === 'unknown' || vocabulary.serviceVariantLength(menu, service) === 'unknown' || vocabulary.serviceVariantLength(menu, service) === facts.length));

  const selectedHint = args.action === 'propose' && candidate ? compatibleServices.find(item => item.id === candidate.baseServiceId) : undefined;
  const services = selectedHint ? [selectedHint] : compatibleServices;

  const seedFor = (serviceId: string): Seed | null => {
    const questions: SemanticClarificationQuestion[] = [];
    let mappingFacts = facts;
    let proposed: CustomerSelection = { baseServiceId: serviceId, selectedAddOns: candidate?.selectedAddOns ?? [] };
    // Relax an unanswered dimension only while constructing a partial seed.
    // The original facts still constrain EVERY completed witness below.
    for (let step = 0; step < 6; step += 1) {
      const semantic = resolveSemanticSelection({ menu, facts: mappingFacts, candidate: proposed });
      if (semantic.kind === 'no_match') {
        return null;
      }
      if (semantic.kind === 'selection') {
        proposed = semantic.selection;
        break;
      }
      if (semantic.question === 'service' || semantic.question === 'details' || questions.includes(semantic.question)) {
        return null;
      }
      questions.push(semantic.question);
      proposed = { ...proposed, selectedAddOns: proposed.selectedAddOns.filter(item => !menu.addOns.some(addOn => addOn.id === item.addOnId && (semantic.question === 'finish' ? vocabulary.isFrench(addOn) : dimension(addOn, semantic.question)))) };
      switch (semantic.question) {
        case 'length': mappingFacts = { ...mappingFacts, length: 'unknown' };
          break;
        case 'finish': mappingFacts = { ...mappingFacts, french: 'unknown' };
          break;
        case 'quantity': mappingFacts = { ...mappingFacts, repairCount: 'unknown' };
          break;
        default: mappingFacts = { ...mappingFacts, removal: 'unknown' };
      }
    }
    const requirements: Requirement[] = [];
    const requireChoice = (items: AddOn[], requiredQuestion: SemanticClarificationQuestion, quantity = 1) => requirements.push({ ids: items.map(item => item.id), quantity, question: requiredQuestion });
    if (facts.french === 'yes') {
      requireChoice(menu.addOns.filter(vocabulary.isFrench), 'finish');
    }
    if (facts.length !== 'unknown' && vocabulary.serviceVariantLength(menu, menu.services.find(item => item.id === serviceId)!) !== facts.length) {
      const offered = menu.addOns.filter(item => menu.bindings.some(binding => binding.serviceId === serviceId && binding.addOnId === item.id));
      const lengths = offered.filter(item => vocabulary.lengthFor(item) === facts.length);
      if (lengths.length || facts.length !== 'short') {
        requireChoice(lengths, 'length');
      }
    }
    if (typeof facts.repairCount === 'number' && facts.repairCount > 0) {
      requireChoice(menu.addOns.filter(item => dimension(item, 'quantity')), 'quantity', facts.repairCount);
    } else if (questions.includes('quantity')) {
      requireChoice(menu.addOns.filter(item => dimension(item, 'quantity')), 'quantity');
    }
    if (facts.removal === 'yes') {
      const removals = menu.addOns.filter(item => vocabulary.isRemoval(item)
        && (facts.existingProduct === 'unknown'
          ? ['gel_polish', 'builder_gel', 'gel_x', 'acrylic'].some(product => vocabulary.productMatches(item, product as Facts['existingProduct']))
          : vocabulary.productMatches(item, facts.existingProduct))
          && (facts.origin === 'unknown' || vocabulary.isForeignRemoval(item) === (facts.origin === 'other_salon')));
      requireChoice(removals, facts.existingProduct === 'unknown' ? 'product' : facts.origin === 'unknown' ? 'origin' : 'removal');
    }
    if (requirements.some(item => item.ids.length === 0)) {
      return null;
    }
    return { selection: proposed, questions, requirements };
  };

  const viable = services.flatMap((service) => {
    const seed = seedFor(service.id);
    return seed && witness(seed.selection, seed.requirements) ? [{ service, seed }] : [];
  });
  if (exhausted || viable.length === 0) {
    return { kind: 'no_match' };
  }
  if (viable.length > 1) {
    return { kind: 'clarification', question: 'service', optionIds: viable.map(item => item.service.id).slice(0, 8) };
  }
  const { seed } = viable[0]!;
  const compatible = (ids: string[], quantity = 1) => ids.filter(id => addOnIds.has(id) && witness(withChoice(seed.selection, id, quantity), seed.requirements));
  const clarify = (needed: SemanticClarificationQuestion, ids: string[], quantity = 1): SemanticSelectionResult => {
    const values = compatible(ids, quantity);
    return exhausted || values.length === 0
      ? { kind: 'no_match' }
      : { kind: 'clarification', question: needed, optionIds: ['product', 'origin', 'quantity'].includes(needed) ? [] : values.slice(0, 8) };
  };
  // Semantic missing facts (e.g. which product needs removal) precede catalog
  // choices. These questions cannot be erased by a complete base-service quote.
  for (const semanticQuestion of seed.questions) {
    const requirement = seed.requirements.find(item => item.question === semanticQuestion)
      ?? (['product', 'origin', 'removal'].includes(semanticQuestion) ? seed.requirements.find(item => ['product', 'origin', 'removal'].includes(item.question)) : undefined);
    if (!requirement) {
      return { kind: 'no_match' };
    }
    const values = compatible(requirement.ids, requirement.quantity);
    const alreadyRequested = semanticQuestion === 'finish' ? facts.french === 'yes' : hasKnownClarificationAnswer(semanticQuestion, facts);
    if (!exhausted && alreadyRequested && values.length === 1) {
      // This is a uniquely resolved customer fact, not an arbitrary witness
      // choice from an unanswered required catalog group.
      seed.selection = withChoice(seed.selection, values[0]!, requirement.quantity);
    } else {
      return clarify(semanticQuestion, requirement.ids, requirement.quantity);
    }
  }
  const resolved = inspect(seed.selection);
  if (!resolved?.ok || exhausted) {
    return { kind: 'no_match' };
  }
  const missing = resolved.selection.violations[0];
  if (missing?.anchor.kind === 'group') {
    const groupId = missing.anchor.groupId;
    const ids = snapshot.addOns.filter(item => item.groupId === groupId).map(item => item.id);
    const values = menu.addOns.filter(item => ids.includes(item.id));
    const needed = values.every(item => dimension(item, 'length')) ? 'length' : 'details';
    return clarify(needed, ids);
  }
  if (missing?.anchor.kind === 'addOn') {
    return clarify('details', [missing.anchor.addOnId]);
  }
  if (missing) {
    return { kind: 'no_match' };
  }
  // Optional model questions are advisory. Only compatible values for an
  // unanswered dimension can survive; unrelated-service values are discarded.
  if (args.action !== 'propose' && !hasKnownClarificationAnswer(question, facts) && question !== 'service'
    && !(['removal', 'origin', 'product'].includes(question) && facts.existingProduct === 'none')
    && !(question === 'removal' && facts.maintenance === 'refill')) {
    const ids = menu.addOns.filter(item => (dimension(item, question) || (question === 'details' && optionIds.includes(item.id)))
      && !(question === 'finish' && vocabulary.isFrench(item) && facts.french !== 'unknown')
      && !(question === 'finish' && optionIds.length > 0 && !optionIds.includes(item.id))).map(item => item.id);
    const material = (result: CatalogResolutionResult | null) => result?.ok
      ? JSON.stringify(result.selection.addOns.map(item => [item.addOnId, item.quantity]).sort())
      : null;
    const values = compatible(ids).filter(id => material(inspect(withChoice(seed.selection, id))) !== material(resolved));
    if (exhausted) {
      return { kind: 'no_match' };
    }
    if (values.length) {
      return { kind: 'clarification', question, optionIds: ['product', 'origin', 'quantity'].includes(question) ? [] : values.slice(0, 8) };
    }
  }
  return { kind: 'selection', selection: seed.selection };
}
