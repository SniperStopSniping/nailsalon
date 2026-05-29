#!/usr/bin/env tsx
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
        name: 'TWILIO_ACCOUNT_SID',
        required: true,
        validate: nonEmpty,
        message: 'Required for phone-first OTP auth and SMS notifications.',
      },
      {
        name: 'TWILIO_AUTH_TOKEN',
        required: true,
        validate: nonEmpty,
        message: 'Required for phone-first OTP auth and SMS notifications.',
      },
      {
        name: 'TWILIO_VERIFY_SERVICE_SID',
        required: true,
        validate: nonEmpty,
        message: 'Required for customer/staff/admin OTP verification.',
      },
      {
        name: 'TWILIO_PHONE_NUMBER',
        required: true,
        validate: nonEmpty,
        message: 'Required for SMS reminders and booking alerts.',
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
        name: 'REDIS_URL',
        required: false,
        validate: nonEmpty,
        message: 'Recommended for stronger rate limiting, idempotency, and replay protection.',
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
        name: 'RESEND_API_KEY',
        required: false,
        validate: nonEmpty,
        message: 'Recommended for owner/technician transactional email notifications.',
      },
      {
        name: 'RESEND_FROM_EMAIL',
        required: false,
        validate: nonEmpty,
        message: 'Recommended for owner/technician transactional email notifications.',
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
