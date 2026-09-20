import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ proposal: vi.fn(), clarification: vi.fn(), current: vi.fn(), readOperation: vi.fn(), reference: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'customer-only', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./readiness.server', () => ({ assessReadyCustomerProposal: async (...args: unknown[]) => ({ proposal: await mocks.proposal(...args), clarification: mocks.clarification() }) }));
vi.mock('./revision.server', () => ({ isCurrentCustomerRevision: mocks.current }));
vi.mock('./operationStore.server', () => ({
  readCustomerBookingOperation: mocks.readOperation,
  customerBookingOperationReference: mocks.reference,
}));

const { createCustomerConversation, signCustomerConversation, verifyCustomerConversation } = await import('./conversation.server');
const { runCustomerHandoff } = await import('./handoff.server');
const { issueNormalConfirmHandoff, verifyNormalConfirmHandoff } = await import('./normalConfirmHandoff.server');

const secret = 'x'.repeat(32);
const fingerprint = 'a'.repeat(64);
const selection = { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] };
const proposal = { selection, fingerprint, service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 }, addOns: [], subtotalCents: 6000, durationMinutes: 60, currency: 'CAD', expiresAt: '2030-01-01T01:00:00.000Z' };
const now = new Date('2030-01-01T00:00:00.000Z');

function conversation(salonId = 'salon-a') {
  return signCustomerConversation({
    ...createCustomerConversation(salonId, secret, now.getTime()),
    context: { question: null, options: [], selection },
  }, secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.proposal.mockResolvedValue(proposal);
  mocks.current.mockResolvedValue(true);
  mocks.clarification.mockReturnValue(undefined);
  mocks.readOperation.mockResolvedValue({ salonId: 'salon-a', sessionId: '123e4567-e89b-12d3-a456-426614174000', appointmentId: null });
  mocks.reference.mockReturnValue({ capability: 'server-derived-capability', revision: 1, fingerprint, expiresAt: '2030-01-01T00:05:00.000Z' });
});

describe('customer assistant normal-flow handoff', () => {
  it('rejects incomplete drafts and historical tokens, including edits during revalidation', async () => {
    mocks.proposal.mockResolvedValueOnce(null);
    const incomplete = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, now });

    expect(incomplete.result).toEqual({ kind: 'unavailable', reason: 'selection_changed' });
    expect(mocks.current).not.toHaveBeenCalled();

    mocks.proposal.mockImplementationOnce(async () => {
      mocks.current.mockResolvedValue(false);
      return proposal;
    });
    const stale = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, now });

    expect(stale.result).toEqual({ kind: 'unavailable', reason: 'selection_changed' });
  });

  it('returns missing choices with the same latest signed facts instead of accepting an incomplete draft', async () => {
    const token = conversation();
    const clarification = { kind: 'clarification', question: 'finish', options: ['Plain / no extras'] };
    mocks.proposal.mockResolvedValue(null);
    mocks.clarification.mockReturnValue(clarification);
    const response = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: token, fingerprint, now });

    expect(response).toEqual({ conversation: token, result: clarification });
    expect(mocks.current).toHaveBeenCalled();
  });

  it('revalidates the signed selection and emits only an opaque tenant-bound flow token', async () => {
    const response = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, now });

    expect(response.result).toMatchObject({ kind: 'handoff', handoff: { selection } });

    if (response.result.kind === 'handoff') {
      expect(Date.parse(response.result.handoff.flow.expiresAt)).toBeGreaterThan(now.getTime());
      expect(response.result.handoff.flow.flowToken).not.toContain('gelx');
      expect(response.result.handoff.flow.flowToken).not.toContain('french');
    }
  });

  it('keeps the same durable flow identity for repeated acceptance of one signed conversation', async () => {
    const token = conversation();
    const signed = verifyCustomerConversation(token, 'salon-a', secret, now.getTime());
    const first = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: token, fingerprint, now });
    const second = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: token, fingerprint, now });

    expect(first.result).toMatchObject({ kind: 'handoff' });
    expect(second.result).toMatchObject({ kind: 'handoff' });

    if (first.result.kind === 'handoff' && second.result.kind === 'handoff') {
      expect(first.result.handoff.flow.flowToken).toBe(second.result.handoff.flow.flowToken);
      expect(first.result.handoff.flow.flowToken).toContain(signed.sessionId);
    }
  });

  it('renews an expired signed flow only after the current proposal is revalidated', async () => {
    const oldFlow = issueNormalConfirmHandoff({ salonId: 'salon-a', secret, flowId: '123e4567-e89b-12d3-a456-426614174000', now: new Date('2029-12-31T20:00:00.000Z') });
    const response = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, flowToken: oldFlow.flowToken, now });

    expect(response.result).toMatchObject({ kind: 'handoff' });

    if (response.result.kind === 'handoff') {
      expect(verifyNormalConfirmHandoff({ salonId: 'salon-a', secret, flowToken: response.result.handoff.flow.flowToken, now }).flowId).toBe('123e4567-e89b-12d3-a456-426614174000');
    }
  });

  it('never accepts a stale fingerprint or a cross-tenant conversation', async () => {
    const stale = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint: 'b'.repeat(64), now });
    const wrongTenant = await runCustomerHandoff({ salon: { id: 'salon-b', slug: 'other' }, features: null, conversation: conversation(), fingerprint, now });

    expect(stale.result).toEqual({ kind: 'proposal', proposal });
    expect(wrongTenant.result).toEqual({ kind: 'unavailable', reason: 'invalid_conversation' });
  });

  it('adopts a server-verified operation capability into its normal-flow identity', async () => {
    const response = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, operationCapability: 'client-capability', now });

    expect(mocks.readOperation).toHaveBeenCalledWith({ salonId: 'salon-a', capability: 'client-capability', secret, now });
    expect(response.result).toMatchObject({ kind: 'handoff', handoff: { operation: { capability: 'server-derived-capability' } } });

    if (response.result.kind === 'handoff') {
      expect(verifyNormalConfirmHandoff({ salonId: 'salon-a', secret, flowToken: response.result.handoff.flow.flowToken, now }).flowId).toBe('123e4567-e89b-12d3-a456-426614174000');
    }
  });

  it('rejects an operation capability that the server cannot verify for this tenant', async () => {
    mocks.readOperation.mockRejectedValueOnce(new Error('invalid operation'));

    const response = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, operationCapability: 'foreign-capability', now });

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'invalid_handoff' });
  });

  it('rejects a verified operation and flow token with different server identities', async () => {
    const otherFlow = issueNormalConfirmHandoff({ salonId: 'salon-a', secret, flowId: '223e4567-e89b-12d3-a456-426614174000', now });

    const response = await runCustomerHandoff({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, features: null, conversation: conversation(), fingerprint, operationCapability: 'client-capability', flowToken: otherFlow.flowToken, now });

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'invalid_handoff' });
  });
});
