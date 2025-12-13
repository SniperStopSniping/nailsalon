/**
 * Feature Flags & Global Kill Switches
 *
 * These flags provide instant control over production behavior
 * without requiring code changes or redeployments.
 *
 * Usage:
 *   import { FEATURE_FLAGS } from '@/core/config/flags';
 *   if (!FEATURE_FLAGS.ENABLE_AUTOPOST_GLOBAL) return;
 *
 * To disable autopost globally:
 *   Set ENABLE_AUTOPOST_GLOBAL=false in environment
 *
 * To adjust rate limits:
 *   Set MAX_PRESIGNS_PER_HOUR=100 in environment
 */

// =============================================================================
// FEATURE FLAGS
// =============================================================================

export const FEATURE_FLAGS = {
  /**
   * Global kill switch for autopost worker.
   * Set to 'false' to stop all autopost processing.
   * Default: true (enabled)
   */
  ENABLE_AUTOPOST_GLOBAL: process.env.ENABLE_AUTOPOST_GLOBAL !== 'false',

  /**
   * Enable dev tools and demo routes.
   * Automatically disabled in production.
   */
  ENABLE_DEV_TOOLS: process.env.NODE_ENV !== 'production',

  /**
   * Maximum presign requests per tech per hour.
   * Protects against Cloudinary cost abuse and queue spam.
   * Default: 50
   */
  MAX_PRESIGNS_PER_HOUR: Number(process.env.MAX_PRESIGNS_PER_HOUR ?? 50),

  /**
   * Maximum autopost queue rows to process per cron run.
   * Prevents runaway processing.
   * Default: 20
   */
  MAX_AUTOPOST_PER_RUN: Number(process.env.MAX_AUTOPOST_PER_RUN ?? 20),
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type FeatureFlags = typeof FEATURE_FLAGS;
