/**
 * The conversation token is the ONLY thing standing between a client-held
 * transcript and a cross-tenant replay: nothing is stored server-side, so a
 * token that verifies IS the conversation. These are the vectors that matter —
 * tamper, another salon, another admin, expiry — plus the two truncation caps
 * that keep a long conversation from growing the request without bound.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  CLERK_SECRET_KEY: 'sk_test_conversation',
  NODE_ENV: 'test' as string,
  OWNER_ASSISTANT_SIGNING_SECRET: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));
vi.mock('@/core/redis/redisClient', () => ({ redis: {} }));

const {
  appendTurns,
  ConversationInvalidError,
  createConversation,
  renewExpiry,
  signConversation,
  verifyConversation,
} = await import('./conversation.server');
const { OWNER_ASSISTANT_LIMITS } = await import('./contracts');

const BINDING = { salonId: 'salon_a', adminId: 'admin_1' };

beforeEach(() => {
  envHolder.NODE_ENV = 'test';
  envHolder.OWNER_ASSISTANT_SIGNING_SECRET = 'a-configured-signing-secret-value';
});

describe('sign and verify', () => {
  it('round-trips a fresh conversation', () => {
    const payload = createConversation(BINDING);
    const verified = verifyConversation(signConversation(payload), BINDING);

    expect(verified).toEqual(payload);
    expect(verified.turnCount).toBe(0);
    expect(verified.turns).toEqual([]);
    expect(verified.cid.length).toBeGreaterThanOrEqual(8);
  });

  it('issues a distinct conversation id each time', () => {
    expect(createConversation(BINDING).cid).not.toBe(createConversation(BINDING).cid);
  });

  it('sets the documented ttl', () => {
    const now = new Date('2026-09-16T00:00:00.000Z');
    const payload = createConversation({ ...BINDING, now });

    expect(payload.exp - payload.iat).toBe(OWNER_ASSISTANT_LIMITS.conversationTtlSeconds);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signConversation(createConversation(BINDING));
    envHolder.OWNER_ASSISTANT_SIGNING_SECRET = 'a-completely-different-secret';

    expect(() => verifyConversation(token, BINDING)).toThrow(ConversationInvalidError);
  });

  it.each([
    ['no separator', 'not-a-token'],
    ['empty signature', 'eyJhIjoxfQ.'],
    ['empty payload', '.c2ln'],
    ['garbage payload', `${Buffer.from('not json').toString('base64url')}.c2ln`],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(() => verifyConversation(token, BINDING)).toThrow(ConversationInvalidError);
  });

  it('rejects a tampered payload', () => {
    const token = signConversation(createConversation(BINDING));
    const [encoded, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(encoded as string, 'base64url').toString('utf8'));
    decoded.salonId = 'salon_b';
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;

    expect(() => verifyConversation(forged, BINDING)).toThrow(ConversationInvalidError);
  });

  // base64url encodes 32 raw bytes into 43 characters, so the final character
  // carries only 4 meaningful bits and the other 2 are slack: some character
  // substitutions at that position decode to the SAME bytes. Mutate at the
  // byte level instead of flipping a base64url character.
  it.each(Array.from({ length: 32 }, (_unused, index) => index))('rejects a tampered signature byte at index %i', (index) => {
    const token = signConversation(createConversation(BINDING));
    const [encoded, signature] = token.split('.');
    const original = Buffer.from(signature as string, 'base64url');

    expect(original).toHaveLength(32);

    const mutated = Buffer.from(original);
    mutated[index] = (mutated[index] ?? 0) ^ 0xFF;

    expect(mutated.equals(original)).toBe(false);

    const flipped = mutated.toString('base64url');

    expect(flipped).toHaveLength((signature as string).length);
    expect(() => verifyConversation(`${encoded}.${flipped}`, BINDING)).toThrow(ConversationInvalidError);
  });

  it('rejects a valid token presented for ANOTHER salon', () => {
    const token = signConversation(createConversation(BINDING));

    expect(() => verifyConversation(token, { salonId: 'salon_b', adminId: 'admin_1' }))
      .toThrow(ConversationInvalidError);
  });

  it('rejects a valid token presented by ANOTHER admin', () => {
    const token = signConversation(createConversation(BINDING));

    expect(() => verifyConversation(token, { salonId: 'salon_a', adminId: 'admin_2' }))
      .toThrow(ConversationInvalidError);
  });

  it('rejects an expired token', () => {
    const issued = new Date('2026-09-16T00:00:00.000Z');
    const token = signConversation(createConversation({ ...BINDING, now: issued }));
    const later = new Date(issued.getTime() + (OWNER_ASSISTANT_LIMITS.conversationTtlSeconds + 1) * 1000);

    expect(() => verifyConversation(token, { ...BINDING, now: later })).toThrow(ConversationInvalidError);
  });

  it('rejects a token older than the absolute age cap even when renewal kept it inside its ttl', () => {
    const issued = new Date('2026-09-16T00:00:00.000Z');
    const payload = createConversation({ ...BINDING, now: issued });
    const beyondCap = new Date(issued.getTime() + (OWNER_ASSISTANT_LIMITS.conversationMaxAgeSeconds + 60) * 1000);
    // Renewed just before the check, so `exp` is in the future and only the
    // absolute cap can reject it.
    const token = signConversation(renewExpiry(payload, new Date(beyondCap.getTime() - 1000)));

    expect(() => verifyConversation(token, { ...BINDING, now: beyondCap })).toThrow(ConversationInvalidError);
  });

  it('accepts a token that is still inside its window', () => {
    const issued = new Date('2026-09-16T00:00:00.000Z');
    const token = signConversation(createConversation({ ...BINDING, now: issued }));
    const later = new Date(issued.getTime() + 60_000);

    expect(verifyConversation(token, { ...BINDING, now: later }).salonId).toBe('salon_a');
  });

  it('renewExpiry slides the window forward without touching the binding', () => {
    const issued = new Date('2026-09-16T00:00:00.000Z');
    const payload = createConversation({ ...BINDING, now: issued });
    const later = new Date(issued.getTime() + 3_600_000);
    const renewed = renewExpiry(payload, later);

    expect(renewed.exp).toBeGreaterThan(payload.exp);
    expect(renewed.salonId).toBe(payload.salonId);
    expect(renewed.adminId).toBe(payload.adminId);
    expect(renewed.cid).toBe(payload.cid);
  });
});

describe('window truncation', () => {
  it('keeps the newest turns when the message count is exceeded', () => {
    const base = createConversation(BINDING);
    const turns = Array.from({ length: OWNER_ASSISTANT_LIMITS.conversationMaxMessages + 6 }, (_unused, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${index}`,
    }));
    const next = appendTurns(base, turns);

    expect(next.turns).toHaveLength(OWNER_ASSISTANT_LIMITS.conversationMaxMessages);
    expect(next.turns.at(-1)?.content).toBe(`turn ${turns.length - 1}`);
    expect(next.turns.at(0)?.content).toBe(`turn ${turns.length - OWNER_ASSISTANT_LIMITS.conversationMaxMessages}`);
  });

  it('drops the oldest turns when the byte cap is exceeded', () => {
    const base = createConversation(BINDING);
    const fat = 'x'.repeat(3_000);
    const next = appendTurns(base, Array.from({ length: 10 }, (_unused, index) => ({
      role: 'user' as const,
      content: `${index}-${fat}`,
    })));

    expect(Buffer.byteLength(JSON.stringify(next), 'utf8'))
      .toBeLessThanOrEqual(OWNER_ASSISTANT_LIMITS.conversationMaxBytes);
    expect(next.turns.length).toBeLessThan(10);
    expect(next.turns.at(-1)?.content.startsWith('9-')).toBe(true);
  });

  it('never drops the only turn, even if it alone exceeds the byte cap', () => {
    const base = createConversation(BINDING);
    const next = appendTurns(base, [{ role: 'user', content: 'y'.repeat(3_999) }]);

    expect(next.turns).toHaveLength(1);
  });

  it('still verifies after truncation', () => {
    const base = createConversation(BINDING);
    const next = appendTurns(base, Array.from({ length: 40 }, () => ({ role: 'user' as const, content: 'hi' })));

    expect(verifyConversation(signConversation(next), BINDING).turns)
      .toHaveLength(OWNER_ASSISTANT_LIMITS.conversationMaxMessages);
  });
});

describe('signing secret resolution', () => {
  it('falls back to a CLERK_SECRET_KEY-derived value outside production', () => {
    envHolder.OWNER_ASSISTANT_SIGNING_SECRET = undefined;

    const token = signConversation(createConversation(BINDING));

    expect(verifyConversation(token, BINDING).salonId).toBe('salon_a');
  });

  it('hard-fails in production when the secret is absent', () => {
    envHolder.OWNER_ASSISTANT_SIGNING_SECRET = undefined;
    envHolder.NODE_ENV = 'production';

    expect(() => signConversation(createConversation(BINDING)))
      .toThrow('OWNER_ASSISTANT_SIGNING_SECRET is required in production');
  });

  it('works in production once the secret is configured', () => {
    envHolder.NODE_ENV = 'production';
    envHolder.OWNER_ASSISTANT_SIGNING_SECRET = 'a-production-signing-secret-value';

    expect(verifyConversation(signConversation(createConversation(BINDING)), BINDING).adminId).toBe('admin_1');
  });
});
