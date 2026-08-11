import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rows } = vi.hoisted(() => ({ rows: { current: [] as unknown[] } }));

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => rows.current,
          }),
        }),
      }),
    }),
  },
}));

// eslint-disable-next-line import/first
import { GET } from './route';

const HOLD_EXPIRES_AT = new Date('2099-03-13T15:35:00.000Z');

function seed(row: {
  depositStatus: string;
  appointmentStatus: string;
  checkoutUrl?: string | null;
}) {
  rows.current = [{
    depositStatus: row.depositStatus,
    appointmentStatus: row.appointmentStatus,
    checkoutUrl: row.checkoutUrl ?? 'https://checkout.stripe.com/c/pay/cs_1',
    holdExpiresAt: HOLD_EXPIRES_AT,
  }];
}

async function call(sessionId = 'cs_1') {
  const response = await GET(
    new Request(`http://localhost/api/public/deposits/session-status?session_id=${sessionId}`),
  );
  return { status: response.status, body: await response.json() };
}

/**
 * §14 test 24 — response shape, PER STATE.
 *
 * `checkoutUrl` must be present while the hold is live and ABSENT (not
 * null-valued) in every other state. Returning it unconditionally keeps
 * offering a payment link for a booking that is already settled or gone;
 * dropping it from the live state costs the cancel page its only data source
 * for the resume link.
 */
describe('GET /api/public/deposits/session-status (§14 test 24)', () => {
  beforeEach(() => {
    rows.current = [];
  });

  it('a live hold returns exactly { state, holdExpiresAt, checkoutUrl }', async () => {
    seed({ depositStatus: 'checkout_created', appointmentStatus: 'awaiting_payment' });

    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body).toEqual({
      state: 'awaiting_payment',
      holdExpiresAt: HOLD_EXPIRES_AT.toISOString(),
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1',
    });
  });

  it.each([
    ['confirmed', { depositStatus: 'paid', appointmentStatus: 'confirmed' }],
    ['expired', { depositStatus: 'expired', appointmentStatus: 'cancelled' }],
    ['cancelled', { depositStatus: 'canceled', appointmentStatus: 'cancelled' }],
  ])('state %s omits checkoutUrl entirely', async (expectedState, row) => {
    seed(row);

    const { status, body } = await call();

    expect(status).toBe(200);
    expect(body.state).toBe(expectedState);
    // ABSENT, not null-valued.
    expect('checkoutUrl' in body).toBe(false);
  });

  it('an unknown session id is a flat 404', async () => {
    rows.current = [];

    expect((await call('cs_unknown')).status).toBe(404);
  });

  it('a missing session_id is a flat 404', async () => {
    const response = await GET(new Request('http://localhost/api/public/deposits/session-status'));

    expect(response.status).toBe(404);
  });

  it('leaks no PII and no tenant identifiers in any state', async () => {
    const states = [
      { depositStatus: 'checkout_created', appointmentStatus: 'awaiting_payment' },
      { depositStatus: 'paid', appointmentStatus: 'confirmed' },
      { depositStatus: 'expired', appointmentStatus: 'cancelled' },
      { depositStatus: 'canceled', appointmentStatus: 'cancelled' },
    ];

    for (const row of states) {
      seed(row);
      const { body } = await call();
      const keys = Object.keys(body).sort();

      // The endpoint is public and unauthenticated: nothing but these three
      // keys may ever appear.
      expect(keys.every(key => ['state', 'holdExpiresAt', 'checkoutUrl'].includes(key))).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/salon|appointment_id|clientName|phone|email/i);
    }
  });
});
