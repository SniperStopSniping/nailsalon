'use client';

/**
 * ModuleDisabledState Component
 *
 * Reusable empty state shown when a module-gated feature is disabled.
 * Use this consistently across all staff pages when a feature returns MODULE_DISABLED.
 *
 * Example usage:
 * ```tsx
 * if (overridesDisabled) {
 *   return <ModuleDisabledState featureName="Schedule Overrides" />;
 * }
 * ```
 */

import { themeVars } from '@/theme';

// =============================================================================
// PROPS
// =============================================================================

type ModuleDisabledStateProps = {
  /** Optional feature name for more specific messaging */
  featureName?: string;
  /** Optional custom message */
  message?: string;
  /** Optional className for the container */
  className?: string;
};

// =============================================================================
// COMPONENT
// =============================================================================

export function ModuleDisabledState({
  featureName,
  message,
  className = '',
}: ModuleDisabledStateProps) {
  const displayMessage
    = message || 'This feature is disabled by your salon admin.';

  return (
    <div
      className={`rounded-2xl p-8 text-center ${className}`}
      style={{
        backgroundColor: themeVars.surfaceAlt,
        borderColor: themeVars.cardBorder,
        borderWidth: 1,
      }}
    >
      <div className="mb-3 text-4xl">🔒</div>
      <h3
        className="mb-2 text-lg font-semibold"
        style={{ color: themeVars.titleText }}
      >
        {featureName ? `${featureName} Disabled` : 'Feature Disabled'}
      </h3>
      <p className="text-sm text-neutral-500">{displayMessage}</p>
    </div>
  );
}

// =============================================================================
// SKELETON (for loading state)
// =============================================================================

type ModuleSkeletonProps = {
  /** Optional className for the container */
  className?: string;
};

/**
 * Skeleton placeholder shown while capabilities are loading.
 * Prevents flash of content that may be hidden.
 */
export function ModuleSkeleton({ className = '' }: ModuleSkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-2xl p-8 ${className}`}
      style={{
        backgroundColor: themeVars.surfaceAlt,
        borderColor: themeVars.cardBorder,
        borderWidth: 1,
      }}
    >
      <div className="mx-auto mb-4 size-10 rounded-full bg-neutral-200" />
      <div className="mx-auto mb-2 h-5 w-32 rounded bg-neutral-200" />
      <div className="mx-auto h-4 w-48 rounded bg-neutral-200" />
    </div>
  );
}
