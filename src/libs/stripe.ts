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

export const stripe = new Stripe(Env.STRIPE_SECRET_KEY, {
  // TypeScript will infer the latest API version from the SDK
  typescript: true,
});
