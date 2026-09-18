import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  CUSTOMER_CONVERSATION_MAX_TOKEN_BYTES,
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

  it('checks encoded token bytes when signing Unicode transcript text', () => {
    const oversizedUnicode = {
      ...createCustomerConversation('salon_a', SECRET, NOW),
      messages: Array.from({ length: 16 }, () => '🙂'.repeat(300)),
    };

    expect(() => signCustomerConversation(oversizedUnicode, SECRET)).toThrow(CustomerConversationInvalidError);
  });

  it('signs and verifies the terminal twelfth-turn payload', () => {
    const terminal = { ...createCustomerConversation('salon_a', SECRET, NOW), turnIndex: 12 };
    const token = signCustomerConversation(terminal, SECRET);

    expect(verifyCustomerConversation(token, 'salon_a', SECRET, NOW)).toEqual(terminal);
  });
});
