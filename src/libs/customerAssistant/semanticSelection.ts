import type { CustomerMenu } from './catalogue.server';
import type { CustomerSelection } from './contracts';
import type { Facts } from './semanticFacts';

export type SemanticClarificationQuestion = 'service' | 'removal' | 'product' | 'origin' | 'length' | 'finish' | 'quantity' | 'details';

export type SemanticSelectionResult =
  | { kind: 'selection'; selection: CustomerSelection }
  | { kind: 'clarification'; question: SemanticClarificationQuestion; optionIds: string[] }
  | { kind: 'no_match' };

type PublicAddOn = CustomerMenu['addOns'][number];
type PublicService = CustomerMenu['services'][number];

const normalize = (value: string) => value.toLocaleLowerCase('en-CA').replace(/[^a-z0-9]+/g, ' ').trim();
// This mapper is deliberately name-only. Public descriptions can mention
// exclusions or other products, so treating them as catalogue identities can
// turn prose such as "not French" into an unwanted selection.
const textFor = (item: { name: string }) => normalize(item.name);
const hasWord = (text: string, word: string) => new RegExp(`\\b${word}\\b`).test(text);

function serviceFamily(service: PublicService): Facts['treatment'] {
  const text = textFor(service);
  if (/\bpedicure\b/.test(text)) {
    return 'unknown';
  }
  if (/\bgel x\b|\bgelx\b/.test(text)) {
    return 'gel_x';
  }
  if (/\bbiab\b|\bbuilder\b/.test(text)) {
    return 'builder_gel';
  }
  if (/\bacrylic\b/.test(text)) {
    return 'acrylic';
  }
  if ((/\bgel manicure\b|\bgel polish\b/.test(text)) && !/\bpedicure\b/.test(text)) {
    return 'gel_polish';
  }
  return 'unknown';
}

function serviceApplication(service: PublicService): Facts['desiredApplication'] {
  const text = textFor(service);
  if (/\bpedicure\b/.test(text)) {
    return 'unknown';
  }
  if (/\bgel x\b|\bgelx\b|\bextension/.test(text)) {
    return 'extensions';
  }
  if (/\bgel manicure\b|\bgel polish\b|\bbiab\b|\bbuilder\b/.test(text)) {
    return 'natural_nails';
  }
  return 'unknown';
}

function serviceVariantLength(menu: CustomerMenu, service: PublicService): Facts['length'] {
  const l1Service = menu.l1?.services.find(item => item.id === service.id);
  if (!l1Service?.variantLabel) {
    return 'unknown';
  }
  const text = normalize(l1Service.variantLabel);
  if (/\bextra long\b/.test(text)) {
    return 'extra_long';
  }
  if (hasWord(text, 'short')) {
    return 'short';
  }
  if (hasWord(text, 'medium')) {
    return 'medium';
  }
  if (hasWord(text, 'long')) {
    return 'long';
  }
  return 'unknown';
}

function isRefill(service: PublicService): boolean {
  const text = textFor(service);
  return /\brefill\b|\bfill\b|\bmaintenance\b/.test(text);
}

function isFrench(addOn: PublicAddOn): boolean {
  return /\bfrench\b/.test(textFor(addOn));
}

function lengthFor(addOn: PublicAddOn): Facts['length'] {
  const text = textFor(addOn);
  if (/\bextra long\b/.test(text)) {
    return 'extra_long';
  }
  if (hasWord(text, 'short')) {
    return 'short';
  }
  if (hasWord(text, 'medium')) {
    return 'medium';
  }
  if (hasWord(text, 'long')) {
    return 'long';
  }
  return 'unknown';
}

function isRepair(addOn: PublicAddOn): boolean {
  return /\brepair\b/.test(textFor(addOn));
}

function isRemoval(addOn: PublicAddOn): boolean {
  return /\bremoval\b|\bremove\b/.test(textFor(addOn));
}

function isForeignRemoval(addOn: PublicAddOn): boolean {
  return /\banother salon\b|\bother salon\b|\bforeign\b|\boutside\b/.test(textFor(addOn));
}

function productMatches(addOn: PublicAddOn, product: Facts['existingProduct']): boolean {
  const text = textFor(addOn);
  switch (product) {
    case 'gel_x': return /\bgel x\b|\bgelx\b/.test(text);
    case 'builder_gel': return /\bbiab\b|\bbuilder\b/.test(text);
    case 'gel_polish': return /\bgel polish\b|\bgel removal\b/.test(text) && !/\bextension/.test(text);
    case 'acrylic': return /\bacrylic\b/.test(text);
    default: return false;
  }
}

/** Shared vocabulary mapping only; catalog rules remain with the L1 resolver. */
export const semanticCatalog = {
  serviceFamily,
  serviceApplication,
  serviceVariantLength,
  isRefill,
  isFrench,
  lengthFor,
  isRepair,
  isRemoval,
  isForeignRemoval,
  productMatches,
};

function unique<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] ?? null : null;
}

function compatibleAddOns(menu: CustomerMenu, serviceId: string): PublicAddOn[] {
  const allowed = new Set(menu.bindings.filter(binding => binding.serviceId === serviceId).map(binding => binding.addOnId));
  return menu.addOns.filter(addOn => allowed.has(addOn.id));
}

function replaceSemanticChoice(
  choices: Map<string, number>,
  remove: (addOn: PublicAddOn) => boolean,
  replacement: PublicAddOn | null,
  menu: CustomerMenu,
  quantity = 1,
): void {
  for (const addOnId of choices.keys()) {
    const addOn = menu.addOns.find(item => item.id === addOnId);
    if (addOn && remove(addOn)) {
      choices.delete(addOnId);
    }
  }
  if (replacement) {
    choices.set(replacement.id, quantity);
  }
}

function clarification(question: SemanticClarificationQuestion, options: PublicAddOn[] | PublicService[] = []): SemanticSelectionResult {
  return { kind: 'clarification', question, optionIds: options.map(item => item.id).slice(0, 8) };
}

/**
 * Maps bounded customer facts to a public menu candidate. It deliberately
 * resolves labels and bindings only: bookingQuote remains the authority for
 * L1 rules, automatic selections, price, duration and technician eligibility.
 */
export function resolveSemanticSelection(args: {
  menu: CustomerMenu;
  facts: Facts;
  candidate: CustomerSelection | null;
}): SemanticSelectionResult {
  const { menu, facts, candidate } = args;
  const candidateService = candidate && menu.services.find(service => service.id === candidate.baseServiceId);
  const treatmentServices = facts.treatment === 'unknown'
    ? menu.services
    : menu.services.filter(service => serviceFamily(service) === facts.treatment);
  const applicationServices = facts.desiredApplication === 'unknown'
    ? treatmentServices
    : treatmentServices.filter(service => serviceApplication(service) === facts.desiredApplication);
  const maintenanceServices = facts.maintenance === 'unknown'
    ? applicationServices
    : applicationServices.filter(service => isRefill(service) === (facts.maintenance === 'refill'));
  const lengthServices = facts.length === 'unknown'
    ? maintenanceServices
    : maintenanceServices.filter(item => serviceVariantLength(menu, item) === 'unknown' || serviceVariantLength(menu, item) === facts.length);

  // A recognized public service outside this bounded hand-nail mapping (for
  // example a manicure/pedicure combo) must not be silently replaced with a
  // hand-only service based on a shared word such as "gel".
  if (candidateService && facts.treatment !== 'unknown' && serviceFamily(candidateService) === 'unknown') {
    return clarification('service');
  }

  const service = candidateService
    && (facts.treatment === 'unknown' || serviceFamily(candidateService) === facts.treatment)
    && (facts.desiredApplication === 'unknown' || serviceApplication(candidateService) === facts.desiredApplication)
    && (facts.maintenance === 'unknown' || isRefill(candidateService) === (facts.maintenance === 'refill'))
    && (facts.length === 'unknown' || serviceVariantLength(menu, candidateService) === 'unknown' || serviceVariantLength(menu, candidateService) === facts.length)
    ? candidateService
    : unique(lengthServices);
  if (!service) {
    return clarification('service', lengthServices.length ? lengthServices : maintenanceServices.length ? maintenanceServices : treatmentServices);
  }

  const allowed = compatibleAddOns(menu, service.id);
  const allowedById = new Map(allowed.map(item => [item.id, item]));
  const choices = new Map<string, number>();
  for (const choice of candidate?.selectedAddOns ?? []) {
    const addOn = allowedById.get(choice.addOnId);
    if (!addOn || choices.has(choice.addOnId) || choice.quantity < 1 || choice.quantity > addOn.maxQuantity) {
      return clarification('details');
    }
    choices.set(choice.addOnId, choice.quantity);
  }

  if (facts.french === 'yes') {
    const french = allowed.filter(isFrench);
    const selected = unique(french);
    if (!selected) {
      return clarification('finish', french);
    }
    replaceSemanticChoice(choices, isFrench, selected, menu);
  } else if (facts.french === 'no') {
    replaceSemanticChoice(choices, isFrench, null, menu);
  }

  if (facts.length !== 'unknown' && serviceVariantLength(menu, service) !== facts.length) {
    const exactLength = allowed.filter(addOn => lengthFor(addOn) === facts.length);
    if (facts.length === 'short' && exactLength.length === 0) {
      // Short is a real customer request, not permission to select a paid
      // upgrade. Leave L1 required-group enforcement to the quote authority.
      replaceSemanticChoice(choices, addOn => lengthFor(addOn) !== 'unknown', null, menu);
    } else {
      const selected = unique(exactLength);
      if (!selected) {
        return clarification('length', exactLength.length ? exactLength : allowed.filter(addOn => lengthFor(addOn) !== 'unknown'));
      }
      replaceSemanticChoice(choices, addOn => lengthFor(addOn) !== 'unknown', selected, menu);
    }
  }

  if (facts.repairCount !== 'unknown') {
    const repairs = allowed.filter(isRepair).filter(addOn => addOn.pricingType === 'per_unit');
    if (facts.repairCount === 0) {
      replaceSemanticChoice(choices, isRepair, null, menu);
    } else {
      const repair = unique(repairs);
      if (!repair || facts.repairCount > repair.maxQuantity) {
        return clarification('quantity', repairs);
      }
      replaceSemanticChoice(choices, isRepair, repair, menu, facts.repairCount);
    }
  }
  if (facts.repairCount === 'unknown') {
    const repairs = allowed.filter(isRepair).filter(addOn => addOn.pricingType === 'per_unit');
    if ([...choices.keys()].some((addOnId) => {
      const addOn = allowedById.get(addOnId);
      return addOn !== undefined && isRepair(addOn);
    })) {
      return clarification('quantity', repairs);
    }
  }

  if (facts.removal === 'no') {
    replaceSemanticChoice(choices, isRemoval, null, menu);
  } else if (facts.removal === 'yes') {
    if (facts.existingProduct === 'unknown' || facts.existingProduct === 'none') {
      return clarification('product');
    }
    if (facts.origin === 'unknown') {
      return clarification('origin');
    }
    const removalCandidates = allowed.filter(isRemoval).filter(addOn => productMatches(addOn, facts.existingProduct));
    const originCandidates = facts.origin === 'this_salon'
      ? removalCandidates.filter(addOn => !isForeignRemoval(addOn))
      : removalCandidates.filter(isForeignRemoval);
    const removal = unique(originCandidates);
    if (!removal) {
      return clarification('removal', originCandidates.length ? originCandidates : removalCandidates);
    }
    replaceSemanticChoice(choices, isRemoval, removal, menu);
  } else if (facts.origin === 'this_salon') {
    // Do not retain a provider-specific, another-salon removal when the
    // customer stated that the existing work was done here.
    replaceSemanticChoice(choices, isForeignRemoval, null, menu);
  }

  return {
    kind: 'selection',
    selection: { baseServiceId: service.id, selectedAddOns: [...choices].map(([addOnId, quantity]) => ({ addOnId, quantity })) },
  };
}

/**
 * Detects post-quote L1 automatic/required selections that contradict facts.
 * Pass `authoritativeAddOns` from the resolved quote (rather than the model
 * selection) so automatic additions are checked without stripping them.
 */
export function selectionConflictsWithExplicitFacts(
  menu: CustomerMenu,
  facts: Facts,
  selection: CustomerSelection,
  authoritativeAddOns?: Array<{ id: string; quantity: number }>,
): boolean {
  const service = menu.services.find(item => item.id === selection.baseServiceId);
  if (!service || (facts.treatment !== 'unknown' && serviceFamily(service) !== facts.treatment)) {
    return true;
  }
  if (facts.desiredApplication !== 'unknown' && serviceApplication(service) !== facts.desiredApplication) {
    return true;
  }
  if (facts.maintenance !== 'unknown' && isRefill(service) !== (facts.maintenance === 'refill')) {
    return true;
  }
  if (facts.length !== 'unknown' && serviceVariantLength(menu, service) !== 'unknown' && serviceVariantLength(menu, service) !== facts.length) {
    return true;
  }
  const choices = authoritativeAddOns ?? selection.selectedAddOns.map(choice => ({ id: choice.addOnId, quantity: choice.quantity }));
  const selected = choices.map(choice => ({ addOn: menu.addOns.find(item => item.id === choice.id), quantity: choice.quantity })).filter((item): item is { addOn: PublicAddOn; quantity: number } => Boolean(item.addOn));
  if (facts.french === 'no' && selected.some(item => isFrench(item.addOn))) {
    return true;
  }
  if (facts.french === 'yes' && !selected.some(item => isFrench(item.addOn))) {
    return true;
  }
  if (facts.length !== 'unknown' && selected.some(item => lengthFor(item.addOn) !== 'unknown' && lengthFor(item.addOn) !== facts.length)) {
    return true;
  }
  if (typeof facts.repairCount === 'number') {
    const totalRepairs = selected.filter(item => isRepair(item.addOn)).reduce((total, item) => total + item.quantity, 0);
    if ((facts.repairCount === 0 && totalRepairs > 0) || (facts.repairCount > 0 && totalRepairs !== facts.repairCount)) {
      return true;
    }
  }
  if (facts.removal === 'no' && selected.some(item => isRemoval(item.addOn))) {
    return true;
  }
  if (facts.origin === 'this_salon' && selected.some(item => isForeignRemoval(item.addOn))) {
    return true;
  }
  if (facts.removal === 'yes' && facts.existingProduct !== 'unknown' && facts.existingProduct !== 'none' && facts.origin !== 'unknown') {
    const matchingRemoval = selected.some(item => isRemoval(item.addOn)
      && productMatches(item.addOn, facts.existingProduct)
      && (facts.origin === 'this_salon' ? !isForeignRemoval(item.addOn) : isForeignRemoval(item.addOn)));
    if (!matchingRemoval) {
      return true;
    }
  }
  return false;
}
