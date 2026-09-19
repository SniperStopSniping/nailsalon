import { buildPublicCatalogSnapshot, resolveCatalogSelection } from '@/libs/catalogResolverCore';
import { makeFixtureAddOn, makeFixtureAddOnGroup, makeFixtureBinding, makeFixtureService } from '@/libs/catalogResolverFixtures';
import { projectPublicBookingCatalog } from '@/libs/publicBookingCatalog';

import type { CustomerMenu } from '../catalogue.server';
import type { CustomerSelection } from '../contracts';
import type { Facts } from '../semanticFacts';
import { resolveSemanticSelection } from '../semanticSelection';

type FactExpectation = Partial<Omit<Facts, 'schemaVersion'>>;

export type SemanticEvalTurn = {
  message: string;
  expectedFacts: FactExpectation;
  expectedAction: 'propose' | 'clarify' | 'no_match';
  /** A fact-driven resolver fixture key; never a production identifier. */
  expectedSelection?: 'gelx_short' | 'gelx_medium' | 'gelx_long' | 'gelx_fill' | 'biab_overlay' | 'gel_manicure' | 'clarify_length' | 'clarify_service' | 'clarify_existing_product';
  critical: boolean;
};

export type SemanticEvalCase = {
  id: string;
  trustedBookingSalon: { name: string; slug: string };
  turns: SemanticEvalTurn[];
};

const syntheticSalon = { name: 'Synthetic Nail Studio', slug: 'synthetic-nail-studio' } as const;
const syntheticIsla = { name: 'Synthetic Isla', slug: 'synthetic-isla' } as const;

const ids = {
  gelManicure: 'svc_semantic_gel_manicure',
  biab: 'svc_semantic_biab',
  gelx: 'svc_semantic_gelx',
  gelxFill: 'svc_semantic_gelx_fill',
  french: 'addon_semantic_french',
  short: 'addon_semantic_short',
  medium: 'addon_semantic_medium',
  long: 'addon_semantic_long',
  repair: 'addon_semantic_repair',
  ownRemoval: 'addon_semantic_gelx_removal',
  foreignRemoval: 'addon_semantic_other_salon_gelx_removal',
  builderForeignRemoval: 'addon_semantic_other_salon_builder_removal',
} as const;

const built = buildPublicCatalogSnapshot({
  salonSettings: null,
  services: [
    makeFixtureService({ id: ids.gelManicure, name: 'Gel Manicure', price: 4000, durationMinutes: 60 }),
    makeFixtureService({ id: ids.biab, name: 'BIAB Builder Gel', price: 5500, durationMinutes: 90 }),
    makeFixtureService({ id: ids.gelx, name: 'Gel-X Extensions', price: 7000, durationMinutes: 90 }),
    makeFixtureService({ id: ids.gelxFill, name: 'Gel-X Fill', price: 6000, durationMinutes: 90 }),
  ],
  addOnGroups: [makeFixtureAddOnGroup({ id: 'group_semantic_length', name: 'Length', slug: 'length', minSelections: 1, maxSelections: 1 })],
  addOns: [
    makeFixtureAddOn({ id: ids.french, name: 'French Tips', priceCents: 1000, durationMinutes: 15 }),
    makeFixtureAddOn({ id: ids.short, name: 'Short Length', groupId: 'group_semantic_length', priceCents: 0, durationMinutes: 0 }),
    makeFixtureAddOn({ id: ids.medium, name: 'Medium Length', groupId: 'group_semantic_length', priceCents: 1000, durationMinutes: 15 }),
    makeFixtureAddOn({ id: ids.long, name: 'Long Length', groupId: 'group_semantic_length', priceCents: 2000, durationMinutes: 30 }),
    makeFixtureAddOn({ id: ids.repair, name: 'Nail Repair', pricingType: 'per_unit', maxQuantity: 5, priceCents: 300, durationMinutes: 5 }),
    makeFixtureAddOn({ id: ids.ownRemoval, name: 'Gel-X Removal', priceCents: 1500, durationMinutes: 20 }),
    makeFixtureAddOn({ id: ids.foreignRemoval, name: 'Other Salon Gel-X Removal', priceCents: 2000, durationMinutes: 30 }),
    makeFixtureAddOn({ id: ids.builderForeignRemoval, name: 'Other Salon Builder Gel Removal', priceCents: 1800, durationMinutes: 25 }),
  ],
  serviceAddOnBindings: [
    ...[ids.gelManicure, ids.biab, ids.gelx, ids.gelxFill].flatMap(serviceId => [
      makeFixtureBinding({ id: `binding_${serviceId}_french`, serviceId, addOnId: ids.french }),
      makeFixtureBinding({ id: `binding_${serviceId}_repair`, serviceId, addOnId: ids.repair, maxQuantityOverride: 5 }),
    ]),
    ...[ids.short, ids.medium, ids.long, ids.ownRemoval, ids.foreignRemoval].map(addOnId => makeFixtureBinding({ id: `binding_${ids.gelx}_${addOnId}`, serviceId: ids.gelx, addOnId })),
    makeFixtureBinding({ id: `binding_${ids.biab}_${ids.builderForeignRemoval}`, serviceId: ids.biab, addOnId: ids.builderForeignRemoval }),
  ],
  rules: [],
});

if (!built.ok) {
  throw new Error('Synthetic semantic L1 catalog failed to build');
}

export const SEMANTIC_L1_SNAPSHOT = projectPublicBookingCatalog(built.snapshot, new Set([ids.gelManicure, ids.biab, ids.gelx, ids.gelxFill]));
export const SEMANTIC_L1_MENU: CustomerMenu = {
  l1: { services: SEMANTIC_L1_SNAPSHOT.services.map(({ id, kind, parentServiceId, variantLabel, selectionMode }) => ({ id, kind, parentServiceId, variantLabel, selectionMode })), addOns: SEMANTIC_L1_SNAPSHOT.addOns.map(({ id, groupId }) => ({ id, groupId })), addOnGroups: SEMANTIC_L1_SNAPSHOT.addOnGroups, ruleProjections: SEMANTIC_L1_SNAPSHOT.ruleProjections },
  services: SEMANTIC_L1_SNAPSHOT.services.map(item => ({ id: item.id, name: item.name, description: (item.descriptionItems ?? []).join('\n'), category: item.category })),
  addOns: SEMANTIC_L1_SNAPSHOT.addOns.map(item => ({ id: item.id, name: item.name, description: (item.descriptionItems ?? []).join('\n'), category: item.category, pricingType: item.pricingType, maxQuantity: item.baseMaxQuantity })),
  bindings: SEMANTIC_L1_SNAPSHOT.serviceAddOnBindings.map(item => ({ serviceId: item.serviceId, addOnId: item.addOnId, required: item.selectionMode === 'required', defaultQuantity: item.defaultQuantity ?? 1, maxQuantity: item.effectiveMaxQuantity })),
};

const selections = {
  gelx_short: { baseServiceId: ids.gelx, selectedAddOns: [{ addOnId: ids.short, quantity: 1 }] },
  gelx_medium: { baseServiceId: ids.gelx, selectedAddOns: [{ addOnId: ids.medium, quantity: 1 }] },
  gelx_long: { baseServiceId: ids.gelx, selectedAddOns: [{ addOnId: ids.long, quantity: 1 }] },
  gelx_fill: { baseServiceId: ids.gelxFill, selectedAddOns: [] },
  biab_overlay: { baseServiceId: ids.biab, selectedAddOns: [] },
  gel_manicure: { baseServiceId: ids.gelManicure, selectedAddOns: [] },
} as const satisfies Record<string, CustomerSelection>;

type ProposalSelectionKey = keyof typeof selections;

export function candidateForSemanticSelection(key: SemanticEvalTurn['expectedSelection']): CustomerSelection | null {
  return key && key in selections
    ? { baseServiceId: selections[key as ProposalSelectionKey].baseServiceId, selectedAddOns: [...selections[key as ProposalSelectionKey].selectedAddOns] }
    : null;
}

function sameAddOns(left: CustomerSelection['selectedAddOns'], right: CustomerSelection['selectedAddOns']): boolean {
  const canonical = (items: CustomerSelection['selectedAddOns']) => [...items]
    .sort((a, b) => a.addOnId.localeCompare(b.addOnId) || a.quantity - b.quantity);
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export type SemanticFixtureResolution =
  | { kind: 'proposal'; selection: CustomerSelection; subtotalCents: number; durationMinutes: number }
  | { kind: 'clarification'; question: string }
  | { kind: 'no_match' }
  | { kind: 'invalid' };

/**
 * Scores only through the production semantic mapper followed by the pure L1
 * resolver. This fixture deliberately has no database or production menu.
 */
export function resolveSyntheticSemanticFixture(args: { facts: Facts; candidate: CustomerSelection | null }): SemanticFixtureResolution {
  const semantic = resolveSemanticSelection({ menu: SEMANTIC_L1_MENU, facts: args.facts, candidate: args.candidate });
  if (semantic.kind === 'clarification') {
    return { kind: 'clarification', question: semantic.question };
  }
  if (semantic.kind === 'no_match') {
    return { kind: 'no_match' };
  }
  return resolveSyntheticCanonicalSelection(semantic.selection);
}

export function resolveSyntheticCanonicalSelection(selection: CustomerSelection): SemanticFixtureResolution {
  const resolved = resolveCatalogSelection(SEMANTIC_L1_SNAPSHOT, {
    serviceId: selection.baseServiceId,
    selectedAddOns: selection.selectedAddOns,
  });
  if (!resolved.ok) {
    return { kind: 'invalid' };
  }
  if (resolved.selection.blocksContinue) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'proposal',
    selection: {
      baseServiceId: resolved.selection.serviceId,
      selectedAddOns: resolved.selection.addOns.map(line => ({ addOnId: line.addOnId, quantity: line.quantity })),
    },
    subtotalCents: resolved.selection.subtotalCents,
    durationMinutes: resolved.selection.totalDurationMinutes,
  };
}

function expectedFixtureSelection(key: ProposalSelectionKey, facts: Facts): CustomerSelection {
  const base = selections[key];
  const selectedAddOns: CustomerSelection['selectedAddOns'] = [...base.selectedAddOns];
  if (facts.french === 'yes') {
    selectedAddOns.push({ addOnId: ids.french, quantity: 1 });
  }
  if (typeof facts.repairCount === 'number' && facts.repairCount > 0) {
    selectedAddOns.push({ addOnId: ids.repair, quantity: facts.repairCount });
  }
  if (facts.removal === 'yes') {
    if (key.startsWith('gelx_') && facts.existingProduct === 'gel_x') {
      selectedAddOns.push({ addOnId: facts.origin === 'this_salon' ? ids.ownRemoval : ids.foreignRemoval, quantity: 1 });
    }
    if (key === 'biab_overlay' && facts.existingProduct === 'builder_gel' && facts.origin === 'other_salon') {
      selectedAddOns.push({ addOnId: ids.builderForeignRemoval, quantity: 1 });
    }
  }
  return { baseServiceId: base.baseServiceId, selectedAddOns };
}

export function matchesExpectedSemanticSelection(
  result: SemanticFixtureResolution,
  expected: SemanticEvalTurn['expectedSelection'],
  facts: Facts,
): boolean {
  if (!expected) {
    return result.kind !== 'invalid';
  }
  if (expected.startsWith('clarify_')) {
    return result.kind === 'clarification';
  }
  const expectedSelection = expectedFixtureSelection(expected as ProposalSelectionKey, facts);
  return result.kind === 'proposal'
    && result.selection.baseServiceId === expectedSelection.baseServiceId
    && sameAddOns(result.selection.selectedAddOns, expectedSelection.selectedAddOns);
}

/**
 * Natural-language fact cases. They intentionally test semantic preservation,
 * not menu-wording recall; all service keys are resolved by a separate pure
 * synthetic L1 fixture before a case can be scored as a proposal.
 */
export const SEMANTIC_EVAL_CASES: SemanticEvalCase[] = [
  { id: 'gelx-combined-length-followup', trustedBookingSalon: syntheticIsla, turns: [{ message: 'New short Gel-X with French. Remove my existing Gel-X; you guys did them.', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', length: 'short', french: 'yes', existingProduct: 'gel_x', origin: 'this_salon', removal: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_short', critical: true }, { message: 'Actually make them medium.', expectedFacts: { length: 'medium' }, expectedAction: 'propose', expectedSelection: 'gelx_medium', critical: true }] },
  { id: 'gelx-from-here', trustedBookingSalon: syntheticIsla, turns: [{ message: 'Short Gel-X with French and removal of my old Gel-X from here.', expectedFacts: { treatment: 'gel_x', length: 'short', french: 'yes', existingProduct: 'gel_x', origin: 'this_salon', removal: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_short', critical: true }] },
  { id: 'gelx-someone-else', trustedBookingSalon: syntheticSalon, turns: [{ message: 'New long Gel-X and French. Remove my current Gel-X first, someone else did them.', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', length: 'long', french: 'yes', existingProduct: 'gel_x', origin: 'other_salon', removal: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_long', critical: true }] },
  { id: 'gelx-unknown-origin-removal', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Short Gel-X and French, remove my existing Gel-X too.', expectedFacts: { treatment: 'gel_x', length: 'short', french: 'yes', existingProduct: 'gel_x', removal: 'yes' }, expectedAction: 'clarify', expectedSelection: 'clarify_service', critical: false }] },

  { id: 'gelx-exact-pilot-regression', trustedBookingSalon: { name: 'Isla', slug: 'synthetic-isla-nail-studio' }, turns: [{ message: 'short Gel-X + French, removing existing Gel-X from Isla', expectedFacts: { treatment: 'gel_x', length: 'short', french: 'yes', existingProduct: 'gel_x', origin: 'this_salon', removal: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_short', critical: true }] },
  { id: 'gelx-short-natural', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I want a short Gel-X set on my natural nails.', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', desiredApplication: 'extensions', existingProduct: 'none', length: 'short' }, expectedAction: 'propose', expectedSelection: 'gelx_short', critical: true }] },
  { id: 'gelx-medium-natural', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Can I get medium Gel-X on natural nails?', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', desiredApplication: 'extensions', existingProduct: 'none', length: 'medium' }, expectedAction: 'propose', expectedSelection: 'gelx_medium', critical: true }] },
  { id: 'gelx-long-french', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Long Gel-X with French tips please, I have natural nails.', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', desiredApplication: 'extensions', existingProduct: 'none', length: 'long', french: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_long', critical: true }] },
  { id: 'gelx-length-clarification', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I want Gel-X with French.', expectedFacts: { treatment: 'gel_x', french: 'yes' }, expectedAction: 'clarify', expectedSelection: 'clarify_length', critical: false }] },
  { id: 'gelx-fill', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I need a fill on my existing Gel-X.', expectedFacts: { maintenance: 'refill', existingProduct: 'gel_x' }, expectedAction: 'propose', expectedSelection: 'gelx_fill', critical: true }] },
  { id: 'gelx-refill-french', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Can you refill my Gel-X with French tips?', expectedFacts: { maintenance: 'refill', existingProduct: 'gel_x', french: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_fill', critical: true }] },
  { id: 'gelx-fill-here', trustedBookingSalon: syntheticIsla, turns: [{ message: 'Can you guys fill the Gel-X I got at Synthetic Isla?', expectedFacts: { maintenance: 'refill', existingProduct: 'gel_x', origin: 'this_salon' }, expectedAction: 'propose', expectedSelection: 'gelx_fill', critical: true }] },
  { id: 'gelx-fill-other-salon', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I have Gel-X from another salon and need a fill.', expectedFacts: { maintenance: 'refill', existingProduct: 'gel_x', origin: 'other_salon' }, expectedAction: 'propose', expectedSelection: 'gelx_fill', critical: true }] },
  { id: 'gelx-removal-other-salon', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Remove the Gel-X extensions I got somewhere else and give me new short Gel-X with French.', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'gel_x', desiredApplication: 'extensions', origin: 'other_salon', removal: 'yes', length: 'short', french: 'yes' }, expectedAction: 'propose', expectedSelection: 'gelx_short', critical: true }] },
  { id: 'gelx-removal-here', trustedBookingSalon: syntheticIsla, turns: [{ message: 'I want to take off the Gel-X I got at Synthetic Isla and get a new medium set.', expectedFacts: { treatment: 'gel_x', maintenance: 'new_set', existingProduct: 'gel_x', desiredApplication: 'extensions', origin: 'this_salon', removal: 'yes', length: 'medium' }, expectedAction: 'propose', expectedSelection: 'gelx_medium', critical: true }] },
  { id: 'biab-natural', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I want BIAB on my natural nails.', expectedFacts: { treatment: 'builder_gel', desiredApplication: 'natural_nails', existingProduct: 'none' }, expectedAction: 'propose', expectedSelection: 'biab_overlay', critical: true }] },
  { id: 'builder-gel-french', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Builder gel overlay with French tips on natural nails.', expectedFacts: { treatment: 'builder_gel', desiredApplication: 'natural_nails', existingProduct: 'none', french: 'yes' }, expectedAction: 'propose', expectedSelection: 'biab_overlay', critical: true }] },
  { id: 'biab-removal-other-salon', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I have BIAB from another salon. Remove it and do a fresh builder gel overlay.', expectedFacts: { treatment: 'builder_gel', maintenance: 'new_set', existingProduct: 'builder_gel', origin: 'other_salon', removal: 'yes' }, expectedAction: 'propose', expectedSelection: 'biab_overlay', critical: true }] },
  { id: 'gel-manicure-french-original-smoke', trustedBookingSalon: syntheticIsla, turns: [{ message: 'I would like a Gel Manicure on natural nails with French Tips, no removal and no other extras, on Saturday September 19.', expectedFacts: { treatment: 'gel_polish', desiredApplication: 'natural_nails', existingProduct: 'none', french: 'yes', removal: 'no' }, expectedAction: 'propose', expectedSelection: 'gel_manicure', critical: true }] },
  { id: 'gel-manicure-french-repairs', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Gel manicure with French and three nail repairs.', expectedFacts: { treatment: 'gel_polish', french: 'yes', repairCount: 3 }, expectedAction: 'propose', expectedSelection: 'gel_manicure', critical: true }] },
  { id: 'couple-repairs', trustedBookingSalon: syntheticSalon, turns: [{ message: 'Gel manicure and a couple repairs.', expectedFacts: { treatment: 'gel_polish', repairCount: 2 }, expectedAction: 'propose', expectedSelection: 'gel_manicure', critical: true }] },
  { id: 'length-correction', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I want Gel-X with French.', expectedFacts: { treatment: 'gel_x', french: 'yes' }, expectedAction: 'clarify', expectedSelection: 'clarify_length', critical: false }, { message: 'Actually medium, not long.', expectedFacts: { length: 'medium' }, expectedAction: 'propose', expectedSelection: 'gelx_medium', critical: true }] },
  { id: 'service-correction', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I want a Gel-X fill.', expectedFacts: { treatment: 'gel_x', maintenance: 'refill' }, expectedAction: 'propose', expectedSelection: 'gelx_fill', critical: true }, { message: 'Sorry, I mean a new short Gel-X set.', expectedFacts: { maintenance: 'new_set', length: 'short' }, expectedAction: 'propose', expectedSelection: 'gelx_short', critical: true }] },
  { id: 'origin-correction', trustedBookingSalon: syntheticIsla, turns: [{ message: 'I have Gel-X from here.', expectedFacts: { existingProduct: 'gel_x', origin: 'this_salon' }, expectedAction: 'clarify', expectedSelection: 'clarify_service', critical: false }, { message: 'Actually it was done at another salon.', expectedFacts: { origin: 'other_salon' }, expectedAction: 'clarify', expectedSelection: 'clarify_service', critical: true }] },
  { id: 'generic-gel-ambiguity', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I have gel on right now and want something new.', expectedFacts: {}, expectedAction: 'clarify', expectedSelection: 'clarify_existing_product', critical: false }] },
  { id: 'unknown-origin-extensions', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I have extensions but I do not know where they were done.', expectedFacts: { existingProduct: 'unknown', origin: 'unknown' }, expectedAction: 'clarify', expectedSelection: 'clarify_service', critical: false }] },
  { id: 'natural-versus-existing-ambiguity', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I want French Gel-X. I might still have something on my nails.', expectedFacts: { treatment: 'gel_x', french: 'yes', existingProduct: 'unknown' }, expectedAction: 'clarify', expectedSelection: 'clarify_existing_product', critical: false }] },
  { id: 'unsupported-acrylic', trustedBookingSalon: syntheticSalon, turns: [{ message: 'I need an acrylic refill with ombré.', expectedFacts: { treatment: 'acrylic', maintenance: 'refill' }, expectedAction: 'no_match', critical: true }] },
];
