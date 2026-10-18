import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectDevelopmentConfig, readPrivateDevelopmentConfig } from './custom-site-development-config';

const env = () => ({ APP_ENV: 'development', BILLING_PLAN_ENV: 'dev', DATABASE_URL: 'postgresql://127.0.0.1:55432/luster_ai_setup_development', OPENAI_API_KEY_CUSTOM_SITES: 'unit-test-value', CUSTOM_SITE_TRIAL_BUDGET_CAD: '11.384406' });
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('isolated development configuration report', () => {
  it('accepts the existing local allocation and reports current API models without claiming signup/payment acceptance', () => {
    expect(inspectDevelopmentConfig(env())).toMatchObject({ aiConfigured: true, configuredLocalCapCad: 11.384406, approvedCombinedTestingCapCad: 80, models: { intakeAndSmallEdits: 'gpt-6-luna', generationAndVisualExtraction: 'gpt-6.1-sol' }, ownerSignupVerified: false, paymentAcceptanceVerified: false, clerkDevelopmentCredentialsConfigured: false, stripeSandboxCredentialsConfigured: false });
  });

  it.each(['50', '80'])('accepts an approved cap beyond the superseded CAD40 check: %s', (value) => {
    expect(inspectDevelopmentConfig({ ...env(), CUSTOM_SITE_TRIAL_BUDGET_CAD: value }).aiConfigured).toBe(true);
  });

  it.each(['0', '80.000001', '-1', 'Infinity', 'NaN', ''])('fails closed for invalid/unapproved cap: %s', (value) => {
    expect(inspectDevelopmentConfig({ ...env(), CUSTOM_SITE_TRIAL_BUDGET_CAD: value }).aiConfigured).toBe(false);
  });

  it.each(['postgresql://127.0.0.1.attacker.test:55432/luster_ai_setup_development', 'postgresql://127.0.0.1:5432/luster_ai_setup_development', 'postgresql://127.0.0.1:55432/luster_production', 'not a database URL'])('never treats a non-attested target as local: %s', (value) => {
    expect(inspectDevelopmentConfig({ ...env(), DATABASE_URL: value }).aiConfigured).toBe(false);
  });

  it.each([{ APP_ENV: 'production' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }, { BILLING_PLAN_ENV: 'prod' }])('rejects conflicting deployment/billing markers: %j', (change) => {
    expect(inspectDevelopmentConfig({ ...env(), ...change }).aiConfigured).toBe(false);
  });

  it('does not confuse placeholder/live credentials with configured Development credentials', () => {
    const publicKey = (host: string) => `pk_test_${Buffer.from(`${host}$`).toString('base64')}`;

    expect(inspectDevelopmentConfig({ ...env(), CLERK_SECRET_KEY: 'sk_test_local-development-value', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicKey('clerk-dev.invalid') }).clerkDevelopmentCredentialsConfigured).toBe(false);
    expect(inspectDevelopmentConfig({ ...env(), CLERK_SECRET_KEY: 'sk_live_local-value', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicKey('studio.clerk.accounts.dev') }).clerkDevelopmentCredentialsConfigured).toBe(false);

    const configured = inspectDevelopmentConfig({ ...env(), CLERK_SECRET_KEY: 'sk_test_local-development-value', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publicKey('studio.clerk.accounts.dev'), STRIPE_SECRET_KEY: 'sk_test_replace', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_replace', STRIPE_WEBHOOK_SECRET: 'whsec_replace' });

    expect(configured).toMatchObject({ clerkDevelopmentCredentialsConfigured: true, stripeSandboxCredentialsConfigured: false, ownerSignupVerified: false, paymentAcceptanceVerified: false });
  });

  it('does not serialize credentials or secret-bearing database input in diagnostics', () => {
    const credential = 'private-value-that-must-not-appear';
    const report = JSON.stringify(inspectDevelopmentConfig({ ...env(), OPENAI_API_KEY_CUSTOM_SITES: credential, DATABASE_URL: credential }));

    expect(report).not.toContain(credential);
  });

  it('reads only a private regular file and rejects public permissions and symlinks before parsing', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'luster-config-test-'));
    directories.push(directory);
    const file = path.join(directory, '.env.development.local');
    writeFileSync(file, 'OPENAI_API_KEY_CUSTOM_SITES=unit-test-value\n', { mode: 0o600 });

    expect(readPrivateDevelopmentConfig(file)).toEqual({ OPENAI_API_KEY_CUSTOM_SITES: 'unit-test-value' });

    chmodSync(file, 0o644);

    expect(() => readPrivateDevelopmentConfig(file)).toThrow('private regular file');

    chmodSync(file, 0o600);
    const link = path.join(directory, 'unsafe-link');
    symlinkSync(file, link);

    expect(() => readPrivateDevelopmentConfig(link)).toThrow();
  });
});
