#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Production Launch Verification
 *
 * Run this before deploying to production to verify the environment required
 * for the multi-tenant nail salon SaaS. The script separates blocking launch
 * requirements from recommended integrations so ops can tell the difference
 * between "deploy will break" and "feature will be degraded".
 *
 * Usage:
 *   npm run ops:verify:launch
 *
 * Exit codes:
 *   0 - Blocking checks passed
 *   1 - One or more blocking checks failed
 */

type EnvCheck = {
  name: string;
  required: boolean;
  validate: (value: string | undefined) => boolean;
  message: string;
};

type CheckGroup = {
  title: string;
  checks: EnvCheck[];
};

const isPostgresUrl = (value: string | undefined) =>
  !!value && (value.startsWith('postgres://') || value.startsWith('postgresql://'));

const isHttpsUrl = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
};

const nonEmpty = (value: string | undefined) => !!value && value.length > 0;

const groups: CheckGroup[] = [
  {
    title: 'Blocking launch requirements',
    checks: [
      {
        name: 'NODE_ENV',
        required: true,
        validate: value => value === 'production',
        message: 'Must be "production" for launch verification.',
      },
      {
        name: 'DATABASE_URL',
        required: true,
        validate: isPostgresUrl,
        message: 'Must point to the production PostgreSQL database.',
      },
      {
        name: 'NEXT_PUBLIC_APP_URL',
        required: true,
        validate: isHttpsUrl,
        message: 'Must be a valid https:// app URL for production redirects and links.',
      },
      {
        name: 'CRON_SECRET',
        required: true,
        validate: value => !!value && value.length >= 32,
        message: 'Must be at least 32 characters for cron authentication.',
      },
      {
        name: 'LUSTER_ROOT_DOMAIN',
        required: true,
        validate: nonEmpty,
        message: 'Required to generate canonical wildcard salon links.',
      },
      {
        name: 'INTEGRATION_ENCRYPTION_KEY',
        required: true,
        validate: value => !!value && value.length >= 32,
        message: 'Must be at least 32 characters to encrypt salon refresh tokens.',
      },
      {
        name: 'OAUTH_STATE_SECRET',
        required: true,
        validate: value => !!value && value.length >= 32,
        message: 'Must be at least 32 characters to sign integration callbacks.',
      },
      {
        name: 'REDIS_URL',
        required: true,
        validate: nonEmpty,
        message: 'Required for distributed password throttling and account lockout.',
      },
      {
        name: 'CLERK_SECRET_KEY',
        required: true,
        validate: nonEmpty,
        message: 'Required for owner email/password sessions and verified-email linking.',
      },
      {
        name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
        required: true,
        validate: nonEmpty,
        message: 'Required for Clerk owner signup, login, verification, and password reset.',
      },
      {
        name: 'SUPER_ADMIN_AUTH_MODE',
        required: true,
        validate: value => value === 'password',
        message: 'Must be "password" because Twilio OTP authentication is retired.',
      },
      {
        name: 'SUPER_ADMIN_TEST_LOGIN_ENABLED',
        required: true,
        validate: value => value === 'true',
        message: 'Must explicitly enable the server-only password login.',
      },
      {
        name: 'SUPER_ADMIN_TEST_PHONE',
        required: true,
        validate: nonEmpty,
        message: 'Must identify the existing database super-admin account.',
      },
      {
        name: 'SUPER_ADMIN_TEST_PASSWORD',
        required: true,
        validate: nonEmpty,
        message: 'Must be supplied from the deployment secret store.',
      },
      {
        name: 'LEGACY_OTP_AUTH_ENABLED',
        required: true,
        validate: value => value === 'false',
        message: 'Must be "false" so retired OTP endpoints fail before Twilio.',
      },
      {
        name: 'RESEND_API_KEY',
        required: true,
        validate: nonEmpty,
        message: 'Required for customer confirmations and management links.',
      },
      {
        name: 'RESEND_FROM_EMAIL',
        required: true,
        validate: nonEmpty,
        message: 'Required for customer confirmations and management links.',
      },
      {
        name: 'STRIPE_SECRET_KEY',
        required: true,
        validate: nonEmpty,
        message: 'Required for salon subscription billing checkout.',
      },
      {
        name: 'STRIPE_WEBHOOK_SECRET',
        required: true,
        validate: nonEmpty,
        message: 'Required for Stripe subscription sync and billing enforcement.',
      },
      {
        name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
        required: true,
        validate: nonEmpty,
        message: 'Required for billing client flows.',
      },
      {
        name: 'NEXT_PUBLIC_SENTRY_DSN',
        required: true,
        validate: nonEmpty,
        message: 'Required by the strict production build guard.',
      },
      {
        name: 'SENTRY_ORG',
        required: true,
        validate: nonEmpty,
        message: 'Required by the strict production build guard.',
      },
      {
        name: 'SENTRY_PROJECT',
        required: true,
        validate: nonEmpty,
        message: 'Required by the strict production build guard.',
      },
      {
        name: 'SENTRY_AUTH_TOKEN',
        required: true,
        validate: nonEmpty,
        message: 'Required by the strict production build guard.',
      },
    ],
  },
  {
    title: 'Recommended for a polished managed launch',
    checks: [
      {
        name: 'TWILIO_CONNECT_APP_SID',
        required: false,
        validate: nonEmpty,
        message: 'Optional: required only for salon-funded transactional messaging.',
      },
      {
        name: 'CLOUDINARY_CLOUD_NAME',
        required: false,
        validate: nonEmpty,
        message: 'Recommended for durable public photo and avatar storage.',
      },
      {
        name: 'CLOUDINARY_API_KEY',
        required: false,
        validate: nonEmpty,
        message: 'Recommended for durable public photo and avatar storage.',
      },
      {
        name: 'CLOUDINARY_API_SECRET',
        required: false,
        validate: nonEmpty,
        message: 'Recommended for durable public photo and avatar storage.',
      },
      {
        name: 'GOOGLE_OAUTH_CLIENT_ID',
        required: false,
        validate: nonEmpty,
        message: 'Required to offer per-salon Google Calendar connections.',
      },
      {
        name: 'GOOGLE_OAUTH_CLIENT_SECRET',
        required: false,
        validate: nonEmpty,
        message: 'Required to offer per-salon Google Calendar connections.',
      },
      {
        name: 'GOOGLE_OAUTH_REDIRECT_URI',
        required: false,
        validate: isHttpsUrl,
        message: 'Required to offer per-salon Google Calendar connections.',
      },
      {
        name: 'TWILIO_CONNECT_REDIRECT_URI',
        required: false,
        validate: isHttpsUrl,
        message: 'Required to offer salon-funded Twilio connections.',
      },
      {
        name: 'META_SYSTEM_USER_TOKEN',
        required: false,
        validate: nonEmpty,
        message: 'Only required if you want auto-posting enabled.',
      },
      {
        name: 'META_FACEBOOK_PAGE_ID',
        required: false,
        validate: value => !!value && /^\d+$/.test(value),
        message: 'Only required if you want Facebook auto-posting enabled.',
      },
      {
        name: 'META_INSTAGRAM_ACCOUNT_ID',
        required: false,
        validate: nonEmpty,
        message: 'Only required if you want Instagram auto-posting enabled.',
      },
    ],
  },
];

console.log('🔍 Verifying production launch environment...\n');

let hasBlockingErrors = false;

for (const group of groups) {
  console.log(`${group.title}`);
  console.log('-'.repeat(group.title.length));

  for (const check of group.checks) {
    const value = process.env[check.name];
    const passed = check.validate(value);

    if (passed) {
      console.log(`✅ ${check.name}`);
      continue;
    }

    const marker = check.required ? '❌' : '⚠️';
    console.log(`${marker} ${check.name}: ${check.message}`);
    if (check.required) {
      hasBlockingErrors = true;
    }
  }

  console.log('');
}

if (hasBlockingErrors) {
  console.log('❌ Launch verification FAILED');
  console.log('   Fix the blocking items above before treating this deployment as SaaS-ready.\n');
  process.exit(1);
}

console.log('✅ Blocking launch verification PASSED');
console.log('   Optional warnings above will not block deploy, but they do affect feature completeness.\n');
