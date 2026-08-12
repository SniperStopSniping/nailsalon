/**
 * THE TWO-GATE DARK LAUNCH.
 *
 * Gate 1 is the build-time constant this PR flips. Gate 2 is the per-salon
 * `features.money.deposits` entitlement, which is an owner action. Both are
 * required, and flipping gate 1 takes NOBODY live on its own.
 *
 * No other packet in the ladder exercises this flag being ON — which is exactly
 * how a two-gate dark launch ships dead. These legs read the SHIPPED constant
 * rather than a parameter, so reverting the flip fails the first one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import {
  DEPOSIT_COLLECTION_LIVE,
  resolveDepositPolicy,
} from '@/libs/depositPolicy';
/* eslint-enable import/first */

const CHARGE_READY_ACCOUNT = {
  revokedAt: null,
  chargesEnabled: true,
  livemode: false,
  lastSyncedAt: new Date(),
};

const ENTITLED_SETTINGS = {
  payments: { deposit: { enabled: true, amountCents: 2500 } },
};

const ENTITLED_FEATURES = { money: { deposits: true } };

describe('the dark-launch gate (BUILD H)', () => {
  it('gate 1 is FLIPPED in the shipped constant', () => {
    // Read from the module, not passed in. A revert of the one-line flip fails
    // exactly here, which is the point: without it the whole ladder merges and
    // deposits are silently dead.
    expect(DEPOSIT_COLLECTION_LIVE).toBe(true);
  });

  it('an entitled, configured, charge-ready salon resolves ACTIVE', () => {
    const resolved = resolveDepositPolicy({
      settings: ENTITLED_SETTINGS,
      features: ENTITLED_FEATURES,
      stripeAccount: CHARGE_READY_ACCOUNT,
      expectedLivemode: false,
    });

    expect(resolved.active).toBe(true);
  });

  it('the SAME salon resolves `collection_not_live` with gate 1 off', () => {
    const resolved = resolveDepositPolicy({
      settings: ENTITLED_SETTINGS,
      features: ENTITLED_FEATURES,
      stripeAccount: CHARGE_READY_ACCOUNT,
      expectedLivemode: false,
      collectionLive: false,
    });

    expect(resolved.active).toBe(false);
    expect(resolved.active === false && resolved.reason).toBe('collection_not_live');
  });

  it('gate 1 alone takes NOBODY live — an unentitled salon stays inactive', () => {
    // The leg that makes "flipping this is safe" a fact rather than a claim.
    const resolved = resolveDepositPolicy({
      settings: ENTITLED_SETTINGS,
      features: null,
      stripeAccount: CHARGE_READY_ACCOUNT,
      expectedLivemode: false,
    });

    expect(resolved.active).toBe(false);
    expect(resolved.active === false && resolved.reason).toBe('not_entitled');
  });

  it('gate 1 alone does not bypass configuration or account readiness either', () => {
    const unconfigured = resolveDepositPolicy({
      settings: {},
      features: ENTITLED_FEATURES,
      stripeAccount: CHARGE_READY_ACCOUNT,
      expectedLivemode: false,
    });

    expect(unconfigured.active === false && unconfigured.reason).toBe('not_configured');

    const notConnected = resolveDepositPolicy({
      settings: ENTITLED_SETTINGS,
      features: ENTITLED_FEATURES,
      stripeAccount: null,
      expectedLivemode: false,
    });

    expect(notConnected.active === false && notConnected.reason).toBe('account_not_connected');
  });
});
