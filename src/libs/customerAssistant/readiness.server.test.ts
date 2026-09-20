import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SEMANTIC_L1_MENU, SEMANTIC_L1_SNAPSHOT } from './__evals__/semanticCases';
import { createCustomerConversation } from './conversation.server';
import { emptyFacts } from './semanticFacts';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ menu: vi.fn(), snapshot: vi.fn(), quote: vi.fn() }));
vi.mock('./catalogue.server', () => ({ loadCustomerMenu: mocks.menu, loadCustomerClarificationSnapshot: mocks.snapshot, buildCustomerProposal: mocks.quote }));

const { assessReadyCustomerProposal, buildReadyCustomerProposal } = await import('./readiness.server');
const selection = { baseServiceId: 'svc_semantic_gelx', selectedAddOns: [{ addOnId: 'addon_semantic_short', quantity: 1 }] };
const facts = { ...emptyFacts(), treatment: 'gel_x' as const, desiredApplication: 'extensions' as const, length: 'short' as const, existingProduct: 'none' as const, removal: 'no' as const, designPreference: 'plain' as const };
const state = { ...createCustomerConversation('salon-a', 'test-signing-secret-which-is-long-enough'), context: { selection, question: null, options: [] }, facts };
const proposal = { selection, service: { id: selection.baseServiceId }, addOns: [{ id: 'addon_semantic_short', quantity: 1 }] };
const args = { salonId: 'salon-a', features: null, state };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.menu.mockResolvedValue(SEMANTIC_L1_MENU);
  mocks.snapshot.mockResolvedValue(SEMANTIC_L1_SNAPSHOT);
  mocks.quote.mockResolvedValue(proposal);
});

describe('acceptance consults current deterministic readiness', () => {
  it('accepts the complete current selection and scopes every catalogue read to the salon', async () => {
    await expect(buildReadyCustomerProposal(args)).resolves.toMatchObject(proposal);
    expect(mocks.menu).toHaveBeenCalledWith('salon-a', null);
    expect(mocks.snapshot).toHaveBeenCalledWith('salon-a');
    expect(mocks.quote).toHaveBeenCalledWith('salon-a', null, selection);
  });

  it('rejects a historical draft lacking removal or optional design answers', async () => {
    await expect(buildReadyCustomerProposal({ ...args, state: { ...state, facts: emptyFacts() } })).resolves.toBeNull();
    await expect(buildReadyCustomerProposal({ ...args, state: { ...state, facts: { ...facts, designPreference: 'unknown' } } })).resolves.toBeNull();
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it('returns priced missing-choice clarification while preserving the signed facts for continuation', async () => {
    const result = await assessReadyCustomerProposal({ ...args, state: { ...state, facts: { ...facts, designPreference: 'unknown' } }, locale: 'fr' });

    expect(result).toMatchObject({ proposal: null, clarification: { kind: 'clarification', question: 'finish', choices: expect.arrayContaining([expect.objectContaining({ label: 'Sans décoration', subtotalCents: 7000 })]) } });
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it('rejects missing required L1 choices even when facts could resolve them', async () => {
    await expect(buildReadyCustomerProposal({ ...args, state: { ...state, context: { ...state.context!, selection: { ...selection, selectedAddOns: [] } } } })).resolves.toBeNull();
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it('rejects a quote that contradicts the explicit facts', async () => {
    mocks.quote.mockResolvedValue({ ...proposal, addOns: [{ id: 'addon_semantic_long', quantity: 1 }] });

    await expect(buildReadyCustomerProposal(args)).resolves.toBeNull();
  });
});
