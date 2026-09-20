import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  CUSTOMER_CONVERSATION_MAX_TOKEN_BYTES,
  advanceCustomerConversation,
  CustomerConversationInvalidError,
  createCustomerConversation,
  signCustomerConversation,
  verifyCustomerConversation,
} = await import('./conversation.server');

const SECRET = 'customer-assistant-signing-secret-which-is-long-enough';
const NOW = Date.parse('2026-09-18T12:00:00.000Z');

describe('customer conversation token', () => {
  it('round trips a narrow customer-only payload', () => {
    const conversation = createCustomerConversation('salon_a', SECRET, NOW);
    const token = signCustomerConversation(conversation, SECRET);

    expect(verifyCustomerConversation(token, 'salon_a', SECRET, NOW)).toEqual(conversation);
    expect(conversation.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(conversation.expiresAtMs - conversation.issuedAtMs).toBe(30 * 60 * 1000);
  });

  it('rejects forged, cross-tenant, and expired tokens', () => {
    const token = signCustomerConversation(createCustomerConversation('salon_a', SECRET, NOW), SECRET);
    const [encoded, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ salonId: 'salon_b' })).toString('base64url')}.${signature}`;

    expect(() => verifyCustomerConversation(forged, 'salon_a', SECRET, NOW)).toThrow(CustomerConversationInvalidError);
    expect(() => verifyCustomerConversation(token, 'salon_b', SECRET, NOW)).toThrow(CustomerConversationInvalidError);
    expect(() => verifyCustomerConversation(token, 'salon_a', SECRET, NOW + 30 * 60 * 1000)).toThrow(CustomerConversationInvalidError);
    expect(() => verifyCustomerConversation(token, 'salon_a', `${SECRET}different`, NOW)).toThrow(CustomerConversationInvalidError);
    expect(encoded).toBeTruthy();
  });

  it('rejects assistant fields, oversized messages, and oversized tokens even if signed', () => {
    const base = createCustomerConversation('salon_a', SECRET, NOW);
    const withAssistant = { ...base, assistantState: { secret: 'forbidden' } };
    const tooLong = { ...base, messages: ['x'.repeat(601)] };

    expect(() => signCustomerConversation(withAssistant, SECRET)).toThrow(CustomerConversationInvalidError);
    expect(() => signCustomerConversation(tooLong, SECRET)).toThrow(CustomerConversationInvalidError);

    const oversized = `${'a'.repeat(CUSTOMER_CONVERSATION_MAX_TOKEN_BYTES)}.b`;

    expect(() => verifyCustomerConversation(oversized, 'salon_a', SECRET, NOW)).toThrow(CustomerConversationInvalidError);
  });

  it('accepts only the bounded server-produced context shape', () => {
    const base = createCustomerConversation('salon_a', SECRET, NOW);
    const contextual = {
      ...base,
      context: {
        question: 'length' as const,
        options: ['Short', 'Medium'],
        selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] },
      },
    };
    const token = signCustomerConversation(contextual, SECRET);

    expect(verifyCustomerConversation(token, 'salon_a', SECRET, NOW).context).toEqual(contextual.context);

    expect(() => signCustomerConversation({
      ...contextual,
      // @ts-expect-error hostile caller bypasses the compile-time contract
      context: { ...contextual.context, privateAssistantState: 'forbidden' },
    }, SECRET)).toThrow(CustomerConversationInvalidError);
    expect(() => signCustomerConversation({
      ...contextual,
      context: { ...contextual.context, options: ['x'.repeat(161)] },
    }, SECRET)).toThrow(CustomerConversationInvalidError);
  });

  it('bounds encoded Unicode history by trimming old turns rather than expiring the conversation', () => {
    const oversizedUnicode = {
      ...createCustomerConversation('salon_a', SECRET, NOW),
      messages: Array.from({ length: 16 }, () => '🙂'.repeat(300)),
    };

    const token = signCustomerConversation(oversizedUnicode, SECRET);

    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(24576);

    const restored = verifyCustomerConversation(token, 'salon_a', SECRET, NOW);

    expect(restored.messages.length).toBeLessThan(16);
    expect(restored.messages.at(-1)).toBe('🙂'.repeat(300));
    expect(restored.sessionId).toBe(oversizedUnicode.sessionId);
  });

  it('signs and verifies the terminal twelfth-turn payload', () => {
    const terminal = { ...createCustomerConversation('salon_a', SECRET, NOW), turnIndex: 12 };
    const token = signCustomerConversation(terminal, SECRET);

    expect(verifyCustomerConversation(token, 'salon_a', SECRET, NOW)).toEqual(terminal);
  });
});

it('keeps active conversations alive past thirty minutes without extending the two-hour absolute cap', () => {
  let state = createCustomerConversation('salon_a', SECRET, NOW);
  state = advanceCustomerConversation(state, NOW + 25 * 60_000);
  const token = signCustomerConversation(state, SECRET);

  expect(verifyCustomerConversation(token, 'salon_a', SECRET, NOW + 40 * 60_000).sessionId).toBe(state.sessionId);

  state = advanceCustomerConversation(state, NOW + 110 * 60_000);

  expect(state.expiresAtMs).toBe(NOW + 120 * 60_000);
  expect(() => verifyCustomerConversation(signCustomerConversation(state, SECRET), 'salon_a', SECRET, NOW + 121 * 60_000)).toThrow();
});

it('accepts existing signed version-one conversations during the upgrade', () => {
  const current = createCustomerConversation('salon_a', SECRET, NOW);
  const { lastActivityAtMs: _activity, ...rest } = current;
  const legacy = { ...rest, version: 1 as const };

  expect(verifyCustomerConversation(signCustomerConversation(legacy, SECRET), 'salon_a', SECRET, NOW).version).toBe(1);
  expect(advanceCustomerConversation(legacy, NOW + 100).version).toBe(2);
});
