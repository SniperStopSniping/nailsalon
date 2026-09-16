/**
 * D19c §2.3 item 1 — the two-way classification the billing webhook applies
 * to a failed OWNERSHIP fetch. The pin that matters is negative: only a
 * decoded invalid-request about the object may be read as "not mine".
 * Everything else — including the configuration faults deposits classes
 * 'permanent' — stays retryable, so a wrong key can never silently classify
 * an estate's real subscriptions as foreign.
 */
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import { classifyStripeFetchFailure, fetchOrForeign } from './stripeFetchFailure';
/* eslint-enable import/first */

describe('classifyStripeFetchFailure (§2.3 item 1)', () => {
  const cases: [string, unknown, 'foreign' | 'retryable'][] = [
    [
      'StripeInvalidRequestError / resource_missing (the classification answer)',
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: 'No such subscription: sub_not_ours',
      }),
      'foreign',
    ],
    [
      'StripeInvalidRequestError (generic bad param)',
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'bad param' }),
      'foreign',
    ],
    [
      'StripeInvalidRequestError / account_invalid — a CONFIGURATION fault, never evidence',
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        code: 'account_invalid',
        message: 'account invalid',
      }),
      'retryable',
    ],
    [
      'StripeInvalidRequestError / deauthorized key',
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'The provided key does not have access to account acct_x (deauthorized).',
      }),
      'retryable',
    ],
    [
      'StripeAuthenticationError — must surface, not be swallowed as foreign',
      new Stripe.errors.StripeAuthenticationError({ type: 'authentication_error', message: 'bad key' }),
      'retryable',
    ],
    [
      'StripePermissionError',
      new Stripe.errors.StripePermissionError({ type: 'invalid_request_error', message: 'no access' }),
      'retryable',
    ],
    [
      'StripeRateLimitError (429)',
      new Stripe.errors.StripeRateLimitError({ type: 'rate_limit_error', message: '429' }),
      'retryable',
    ],
    [
      'StripeAPIError (5xx)',
      new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'boom' }),
      'retryable',
    ],
    [
      'StripeIdempotencyError',
      new Stripe.errors.StripeIdempotencyError({ type: 'idempotency_error', message: 'concurrent' }),
      'retryable',
    ],
    [
      'StripeConnectionError (the request may never have reached Stripe)',
      new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'reset' }),
      'retryable',
    ],
    ['a plain Error', new Error('something else entirely'), 'retryable'],
    ['an AbortError', Object.assign(new Error('aborted'), { name: 'AbortError' }), 'retryable'],
    ['a bare 503 from a proxy', Object.assign(new Error('gateway'), { statusCode: 503 }), 'retryable'],
    ['null', null, 'retryable'],
  ];

  it.each(cases)('%s → %s', (_label, error, expected) => {
    expect(classifyStripeFetchFailure(error)).toBe(expected);
  });
});

describe('fetchOrForeign', () => {
  it('returns the value when the fetch succeeds', async () => {
    expect(await fetchOrForeign(async () => ({ id: 'sub_1' }))).toEqual({ id: 'sub_1' });
  });

  it('returns null — never throws — on a definite resource_missing', async () => {
    const missing = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'resource_missing',
      message: 'No such invoice: in_not_ours',
    });

    expect(await fetchOrForeign(async () => {
      throw missing;
    })).toBeNull();
  });

  it('RETHROWS everything else, so the poison ladder owns it', async () => {
    const transient = new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'stripe is down' });

    await expect(fetchOrForeign(async () => {
      throw transient;
    })).rejects.toBe(transient);

    const misconfigured = new Stripe.errors.StripeAuthenticationError({
      type: 'authentication_error',
      message: 'Invalid API Key provided',
    });

    await expect(fetchOrForeign(async () => {
      throw misconfigured;
    })).rejects.toBe(misconfigured);
  });
});
