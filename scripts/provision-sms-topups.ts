#!/usr/bin/env tsx
/**
 * Scoped, repeatable provisioning; never creates or changes subscription prices.
 * NODE_OPTIONS=--conditions=react-server tsx scripts/provision-sms-topups.ts --env test --plan
 * --apply --carrier-out /private/path.json writes a 0600 environment carrier.
 * Supply STRIPE_TOPUP_PROVISIONING_KEY and optionally --carrier-in to retain historical mappings.
 */
import fs from 'node:fs';
import path from 'node:path';

import Stripe from 'stripe';

import { extractExpectedStripeApiVersion, isConfiguredStripeId, loadCatalogue } from './billing-stripe-test-provision';

class ProvisioningError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const env = value('--env');
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const output = value('--carrier-out');
  const input = value('--carrier-in');
  if ((env !== 'test' && env !== 'prod') || (apply && verify)) {
    throw new ProvisioningError('Choose --env test|prod and one of --plan, --apply, --verify.');
  }
  const secret = process.env.STRIPE_TOPUP_PROVISIONING_KEY;
  if (!secret?.startsWith(env === 'prod' ? 'sk_live_' : 'sk_test_') || secret !== secret.trim()) {
    throw new ProvisioningError('Provisioning key must match the selected environment.');
  }
  if (apply && (!output || path.resolve(output).startsWith(`${process.cwd()}${path.sep}`))) {
    throw new ProvisioningError('--apply requires a carrier output outside the repository.');
  }
  const apiVersion = extractExpectedStripeApiVersion(fs.readFileSync('src/libs/stripe.ts', 'utf8'));
  if (!apiVersion) {
    throw new ProvisioningError('Cannot read the pinned Stripe API version.');
  }
  const stripe = new Stripe(secret, { apiVersion: apiVersion as Stripe.LatestApiVersion });
  const { topups, offers, promotions } = await loadCatalogue();
  const carrier = input ? JSON.parse(fs.readFileSync(input, 'utf8')) : { env, offers: {}, topups: {}, coupons: {} };
  if (carrier.env !== env || !carrier.offers || !carrier.topups || !carrier.coupons) {
    throw new ProvisioningError('Existing carrier does not match this environment.');
  }
  const knownSections = { offers, topups, coupons: promotions };
  const existingIds = new Set<string>();
  for (const section of ['offers', 'topups', 'coupons'] as const) {
    if (typeof carrier[section] !== 'object' || Array.isArray(carrier[section])) {
      throw new ProvisioningError('Existing carrier section is invalid.');
    }
    for (const [key, id] of Object.entries(carrier[section])) {
      if (!Object.hasOwn(knownSections[section], key) || typeof id !== 'string' || !isConfiguredStripeId(id) || existingIds.has(id)) {
        throw new ProvisioningError('Existing carrier contains unknown, invalid, or duplicate mappings.');
      }
      existingIds.add(id);
    }
  }
  const active = Object.values(topups).filter(offer => offer.active);
  for (const offer of active) {
    const lookupKey: string = `luster_${env}_${offer.key}`;
    const listed: Stripe.ApiList<Stripe.Price> = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 2, expand: ['data.product'] });
    if (listed.data.length > 1) {
      throw new ProvisioningError('Ambiguous existing price; refusing to select one.');
    }
    let price: Stripe.Price | undefined = listed.data[0];
    if (!price && apply) {
      const marker = { luster_offer_key: offer.key, luster_plan_env: env, luster_catalog: 'free_sms_topups_2026_10' };
      // Repeated attempts recover the same product and immutable price.
      const product = await stripe.products.create({ name: `${offer.credits} Luster texts`, metadata: marker }, { idempotencyKey: `${lookupKey}:product` });
      if (product.livemode !== (env === 'prod')) {
        throw new ProvisioningError('Provider product mode mismatch.');
      }
      price = await stripe.prices.create({ product: product.id, currency: offer.currency, unit_amount: offer.priceCents, lookup_key: lookupKey, metadata: marker }, { idempotencyKey: `${lookupKey}:price` });
    }
    if (price) {
      if (price.livemode !== (env === 'prod') || !price.active || price.recurring !== null || price.currency !== offer.currency
        || price.unit_amount !== offer.priceCents || price.metadata.luster_offer_key !== offer.key || price.metadata.luster_plan_env !== env) {
        throw new ProvisioningError('Existing provider price does not match the approved package.');
      }
      if (verify && input && carrier.topups[offer.key] !== price.id) {
        throw new ProvisioningError('Existing mapping does not match the verified provider package.');
      }
      carrier.topups[offer.key] = price.id;
      process.stdout.write(`${offer.credits} texts CAD $${offer.priceCents / 100}: verified\n`);
    } else if (verify) {
      throw new ProvisioningError('A required package is not provisioned.');
    } else {
      process.stdout.write(`${offer.credits} texts CAD $${offer.priceCents / 100}: would create\n`);
    }
  }
  if (apply) {
    // Write atomically; a retry recovers provider evidence and retains the other catalog keys.
    const temporary = `${output}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(carrier)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, output!);
    process.stdout.write('Verified environment carrier saved privately. Subscription prices unchanged.\n');
  }
}
main().catch((error: unknown) => {
  // Provider errors can contain request identifiers and secrets; never echo their raw payload.
  const status = error instanceof Stripe.errors.StripeError ? ` Provider HTTP status: ${error.statusCode ?? 'unknown'}.` : error instanceof ProvisioningError ? ` ${error.message}` : '';
  process.stderr.write(`Top-up provisioning failed.${status} Check environment, access, and exact provider package evidence. No activation performed.\n`);
  process.exitCode = 1;
});
