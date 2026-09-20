import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerConversation } from './conversation.server';

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), complete: vi.fn(), proposal: vi.fn(), context: vi.fn(), lookup: vi.fn(), record: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./access.server', () => ({ getCustomerAssistantConfig: () => ({ apiKey: 'customer-only', signingSecret: 'x'.repeat(32) }) }));
vi.mock('./budget.server', () => ({ reserveCustomerAssistantTurn: mocks.reserve }));
vi.mock('./readiness.server', () => ({ assessReadyCustomerProposal: async (...args: unknown[]) => ({ proposal: await mocks.proposal(...args) }) }));
vi.mock('./revision.server', () => ({ completeCustomerRevision: mocks.complete }));
vi.mock('./slots.server', () => ({ getCustomerAvailabilityContext: mocks.context, lookupCustomerSlots: mocks.lookup, hasOfferedCustomerSlot: (slots: Array<{ startTime: string }>, startTime: string) => slots.find(slot => slot.startTime === startTime) ?? null }));
vi.mock('./ledger.server', () => ({ recordCustomerAssistantUsage: mocks.record }));

const { createCustomerConversation, signCustomerConversation, verifyCustomerConversation } = await import('./conversation.server');
const { runCustomerAssistantAction } = await import('./action.server');

const secret = 'x'.repeat(32);
const fingerprint = 'a'.repeat(64);
const selection = { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] };
const proposal = { selection, fingerprint, service: { id: 'gelx', name: 'Gel-X', priceCents: 6000 }, addOns: [], subtotalCents: 6000, durationMinutes: 60, currency: 'CAD', expiresAt: '2026-09-18T00:00:00Z' };
const slot = { time: '15:00', startTime: '2026-09-20T19:00:00.000Z' };
const state = (booking?: CustomerConversation['booking']) => signCustomerConversation({
  ...createCustomerConversation('salon-a', secret, Date.parse('2026-09-18T12:00:00Z')),
  context: { question: null, options: [], selection },
  ...(booking ? { booking } : {}),
}, secret);
const input = (conversation: string, action: Parameters<typeof runCustomerAssistantAction>[0]['action']) => ({
  salon: { id: 'salon-a', slug: 'isla-nail-studio' },
  features: null,
  clientIp: '192.0.2.4',
  conversation,
  action,
  now: new Date('2026-09-18T12:00:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ ok: true });
  mocks.complete.mockResolvedValue(true);
  mocks.proposal.mockResolvedValue(proposal);
  mocks.context.mockResolvedValue({ today: '2026-09-18', timeZone: 'America/Toronto' });
  mocks.lookup.mockResolvedValue({ proposal, today: '2026-09-18', timeZone: 'America/Toronto', slots: [slot] });
  mocks.record.mockResolvedValue(undefined);
});

describe('customer assistant deterministic availability actions', () => {
  it('rejects incomplete drafts without offering dates, and fails closed if completion cannot commit', async () => {
    mocks.proposal.mockResolvedValueOnce(null);
    const incomplete = await runCustomerAssistantAction(input(state(), { action: 'accept_selection', fingerprint }));

    expect(incomplete.result).toEqual({ kind: 'unavailable', reason: 'selection_changed' });
    expect(mocks.context).not.toHaveBeenCalled();

    mocks.complete.mockResolvedValue(false);
    const unavailable = await runCustomerAssistantAction(input(state(), { action: 'accept_selection', fingerprint }));

    expect(unavailable.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
  });

  it('requires a current, clicked proposal fingerprint before dates', async () => {
    const response = await runCustomerAssistantAction(input(state(), { action: 'accept_selection', fingerprint }));

    expect(response.result).toMatchObject({ kind: 'date_prompt', proposal: { fingerprint } });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking).toMatchObject({ acceptedFingerprint: fingerprint, offeredSlots: [] });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('rejects a forged fingerprint by showing the fresh authoritative proposal', async () => {
    const response = await runCustomerAssistantAction(input(state(), { action: 'accept_selection', fingerprint: 'b'.repeat(64) }));

    expect(response.result).toEqual({ kind: 'proposal', proposal });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking).toBeUndefined();
  });

  it('revalidates a chosen day and signs only whitelisted available slots', async () => {
    const accepted = state({ acceptedFingerprint: fingerprint, datePreference: null, offeredSlots: [], selectedSlot: null });
    const response = await runCustomerAssistantAction(input(accepted, { action: 'choose_date', date: '2026-09-20' }));

    expect(mocks.lookup).toHaveBeenCalledWith(expect.objectContaining({ salon: { id: 'salon-a', slug: 'isla-nail-studio' }, selection }));
    expect(response.result).toMatchObject({ kind: 'slots', slots: [slot] });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking?.offeredSlots).toEqual([slot]);
  });

  it('never accepts a forged slot and refreshes alternatives when a slot disappears', async () => {
    const accepted = state({ acceptedFingerprint: fingerprint, datePreference: { date: '2026-09-20', earliest: '00:00', latest: '23:59' }, offeredSlots: [slot], selectedSlot: null });
    const forged = await runCustomerAssistantAction(input(accepted, { action: 'select_slot', startTime: '2026-09-20T20:00:00.000Z' }));

    expect(forged.result).toEqual({ kind: 'unavailable', reason: 'selection_changed' });

    mocks.lookup.mockResolvedValueOnce({ proposal, today: '2026-09-18', timeZone: 'America/Toronto', slots: [{ time: '16:00', startTime: '2026-09-20T20:00:00.000Z' }] });
    const stale = await runCustomerAssistantAction(input(accepted, { action: 'select_slot', startTime: slot.startTime }));

    expect(stale.result).toMatchObject({ kind: 'slots', slotDisappeared: true, slots: [{ time: '16:00' }] });
  });

  it('selects a still-valid offered slot even when the refreshed display list is capped', async () => {
    const accepted = state({ acceptedFingerprint: fingerprint, datePreference: { date: '2026-09-20', earliest: '00:00', latest: '23:59' }, offeredSlots: [slot], selectedSlot: null });
    mocks.lookup.mockResolvedValueOnce({ proposal, today: '2026-09-18', timeZone: 'America/Toronto', slots: [{ time: '09:00', startTime: '2026-09-20T13:00:00.000Z' }], selected: slot, quoteChanged: false });

    const response = await runCustomerAssistantAction(input(accepted, { action: 'select_slot', startTime: slot.startTime }));

    expect(response.result).toMatchObject({ kind: 'slot_selected', slot });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking?.selectedSlot).toEqual(slot);
  });

  it('signs an unavailable next state after an availability dependency failure', async () => {
    const accepted = state({ acceptedFingerprint: fingerprint, datePreference: null, offeredSlots: [], selectedSlot: null });
    mocks.lookup.mockRejectedValueOnce(new Error('unavailable'));

    const response = await runCustomerAssistantAction(input(accepted, { action: 'choose_date', date: '2026-09-20' }));

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'unavailable' });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).turnIndex).toBe(1);
  });

  it('clears acceptance when the post-read authority reports a same-fingerprint context change', async () => {
    const accepted = state({ acceptedFingerprint: fingerprint, datePreference: null, offeredSlots: [], selectedSlot: null });
    mocks.lookup.mockResolvedValueOnce({ proposal, today: '2026-09-18', timeZone: 'America/Vancouver', slots: [slot], selected: null, quoteChanged: true });

    const response = await runCustomerAssistantAction(input(accepted, { action: 'choose_date', date: '2026-09-20' }));

    expect(response.result).toEqual({ kind: 'proposal', proposal });
    expect(verifyCustomerConversation(response.conversation, 'salon-a', secret, Date.parse('2026-09-18T12:00:00Z')).booking).toBeUndefined();
  });

  it('rejects a cross-tenant signed state before it uses the shared quota', async () => {
    const response = await runCustomerAssistantAction({ ...input(state(), { action: 'accept_selection', fingerprint }), salon: { id: 'salon-b', slug: 'isla-nail-studio' } });

    expect(response.result).toEqual({ kind: 'unavailable', reason: 'invalid_conversation' });
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
