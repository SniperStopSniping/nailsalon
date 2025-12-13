#!/usr/bin/env tsx
/**
 * Environment Verification Script
 *
 * Run this before deploying to production to ensure all required
 * environment variables are configured correctly.
 *
 * Usage:
 *   npx tsx scripts/verify-env.ts
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed (deploy should be blocked)
 */

// =============================================================================
// VALIDATION RULES
// =============================================================================

type EnvCheck = {
  name: string;
  required: boolean;
  validate: (value: string | undefined) => boolean;
  message: string;
};

const checks: EnvCheck[] = [
  // Database
  {
    name: 'DATABASE_URL',
    required: true,
    validate: v => !!v && (v.startsWith('postgres://') || v.startsWith('postgresql://')),
    message: 'Must start with postgres:// or postgresql://',
  },

  // Redis
  {
    name: 'REDIS_URL',
    required: true,
    validate: v => !!v && v.length > 0,
    message: 'Required for rate limiting and idempotency',
  },

  // Cron
  {
    name: 'CRON_SECRET',
    required: true,
    validate: v => !!v && v.length >= 32,
    message: 'Must be at least 32 characters for security',
  },

  // Meta API
  {
    name: 'META_SYSTEM_USER_TOKEN',
    required: true,
    validate: v => !!v && v.length > 0,
    message: 'Required for Instagram/Facebook auto-posting',
  },
  {
    name: 'META_FACEBOOK_PAGE_ID',
    required: true,
    validate: v => !!v && /^\d+$/.test(v),
    message: 'Must be a numeric string (Facebook Page ID)',
  },
  {
    name: 'META_INSTAGRAM_ACCOUNT_ID',
    required: true,
    validate: v => !!v && v.length > 0,
    message: 'Required for Instagram posting',
  },

  // Cloudinary
  {
    name: 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    required: true,
    validate: v => !!v && v.length > 0,
    message: 'Required for photo uploads',
  },
  {
    name: 'CLOUDINARY_API_KEY',
    required: true,
    validate: v => !!v && v.length > 0,
    message: 'Required for photo uploads',
  },
  {
    name: 'CLOUDINARY_API_SECRET',
    required: true,
    validate: v => !!v && v.length > 0,
    message: 'Required for photo uploads',
  },

  // Node environment
  {
    name: 'NODE_ENV',
    required: true,
    validate: v => v === 'production',
    message: 'Must be "production" for production deploys',
  },
];

// =============================================================================
// RUN CHECKS
// =============================================================================

console.log('🔍 Verifying production environment...\n');

let hasErrors = false;

for (const check of checks) {
  const value = process.env[check.name];
  const passed = check.validate(value);

  if (passed) {
    console.log(`✅ ${check.name}`);
  } else {
    console.log(`❌ ${check.name}: ${check.message}`);
    hasErrors = true;
  }
}

console.log('');

// =============================================================================
// EXIT
// =============================================================================

if (hasErrors) {
  console.log('❌ Environment verification FAILED');
  console.log('   Fix the above issues before deploying to production.\n');
  process.exit(1);
} else {
  console.log('✅ Environment verification PASSED');
  console.log('   All required variables are configured correctly.\n');
  process.exit(0);
}
