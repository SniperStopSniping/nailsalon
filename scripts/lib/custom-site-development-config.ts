import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';

import { parse } from 'dotenv';

import { APPROVED_TRIAL_CAP_CAD, DESIGN_AI_MODEL, SETUP_AI_MODEL } from '../../src/features/business-setup/ai-models';

export function readPrivateDevelopmentConfig(file: string) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new Error('The local configuration must be a private regular file.');
    }
    return parse(readFileSync(descriptor));
  } finally {
    closeSync(descriptor);
  }
}

const looksConfigured = (value: string | undefined) => Boolean(value) && !/placeholder|replace|fixture|synthetic|example/iu.test(value!);

function developmentClerkHost(value: string | undefined) {
  if (!value?.startsWith('pk_test_')) {
    return false;
  }
  try {
    const hostname = Buffer.from(value.slice(8), 'base64').toString('utf8').replace(/\$$/u, '');
    return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu.test(hostname)
      && !/\.(?:invalid|example|test|localhost)$/iu.test(hostname)
      && looksConfigured(hostname);
  } catch {
    return false;
  }
}

/** Presence/shape only. Never a claim that signup/payment/provider calls work. */
export function inspectDevelopmentConfig(env: Record<string, string | undefined>) {
  let isolatedLocalDatabase = false;
  try {
    const database = new URL(env.DATABASE_URL ?? 'file:///missing');
    isolatedLocalDatabase = ['postgres:', 'postgresql:'].includes(database.protocol)
    && database.hostname === '127.0.0.1' && database.port === '55432'
    && database.pathname === '/luster_ai_setup_development';
  } catch { /* Report a boolean, never the secret-bearing parse error. */ }
  const environmentConsistent = env.APP_ENV === 'development'
    && (!env.VERCEL_ENV || env.VERCEL_ENV === 'development')
    && (!env.NODE_ENV || env.NODE_ENV === 'development')
    && (!env.BILLING_PLAN_ENV || env.BILLING_PLAN_ENV === 'dev');
  const cap = Number(env.CUSTOM_SITE_TRIAL_BUDGET_CAD ?? 0);
  const budgetConfigured = Number.isFinite(cap) && cap > 0 && cap <= APPROVED_TRIAL_CAP_CAD;
  const dedicatedKeyConfigured = looksConfigured(env.OPENAI_API_KEY_CUSTOM_SITES);
  const clerkDevelopmentCredentialsConfigured = Boolean(env.CLERK_SECRET_KEY?.startsWith('sk_test_'))
    && looksConfigured(env.CLERK_SECRET_KEY) && developmentClerkHost(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const stripeSandboxCredentialsConfigured = Boolean(env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
    && Boolean(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_'))
    && Boolean(env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))
    && [env.STRIPE_SECRET_KEY, env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, env.STRIPE_WEBHOOK_SECRET].every(looksConfigured);
  return {
    verification: 'offline-presence-and-shape-only',
    isolatedLocalDatabase,
    environmentConsistent,
    dedicatedKeyConfigured,
    models: { intakeAndSmallEdits: SETUP_AI_MODEL, generationAndVisualExtraction: DESIGN_AI_MODEL },
    approvedCombinedTestingCapCad: APPROVED_TRIAL_CAP_CAD,
    configuredLocalCapCad: budgetConfigured ? cap : null,
    aiConfigured: isolatedLocalDatabase && environmentConsistent && dedicatedKeyConfigured && budgetConfigured,
    clerkDevelopmentCredentialsConfigured,
    stripeSandboxCredentialsConfigured,
    ownerSignupVerified: false,
    paymentAcceptanceVerified: false,
  } as const;
}
