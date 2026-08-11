/**
 * Stripe SDK Initialization
 *
 * Server-only Stripe client - NEVER import on the client side.
 * Uses STRIPE_SECRET_KEY from environment.
 *
 * NOTE: Billing mode constants and enforcement helpers are in featureGating.ts
 * to keep a single source of truth.
 */
import 'server-only';

import Stripe from 'stripe';

import { Env } from '@/libs/Env';

/**
 * The pinned Stripe API version, and the SINGLE SOURCE OF TRUTH for it across
 * this programme — not merely this module's own constant.
 *
 * A Stripe webhook endpoint's `api_version` is fixed at creation and is NOT
 * updatable, so the version this client sends must be a deliberate, written-down
 * literal rather than whatever the installed SDK happens to default to. It is
 * hardcoded on purpose: computing it from the SDK at runtime would make the
 * "pin" track the SDK while the endpoint's immutable `api_version` silently
 * diverged from it.
 *
 * This value equals the installed `stripe@16.12.0` default API version, so
 * adding the `apiVersion` option is behaviour-neutral for the SaaS billing paths
 * that share this client. That equality is a fact about today, not a rule: when
 * an SDK upgrade moves the default, the usual correct response is to KEEP this
 * pin and update the drift-canary test deliberately, never to follow the SDK.
 *
 * A later PR in this programme imports this symbol BY NAME AND PATH. Do not
 * rename it, do not re-home it, and do not alias it.
 */
export const EXPECTED_STRIPE_API_VERSION = '2024-06-20' as const;

// NOTE: this client is shared with SaaS subscription billing. The `timeout`
// option is deliberately NOT set — that decision is an owner sign-off that was
// unsigned at build time, and it changes behaviour on the billing path (a
// previously-hanging call would begin aborting). `maxNetworkRetries` is left at
// the SDK default (1).
export const stripe = new Stripe(Env.STRIPE_SECRET_KEY, {
  apiVersion: EXPECTED_STRIPE_API_VERSION,
  typescript: true,
});
