'use client';

/**
 * UpgradeRequiredState Component
 *
 * Compatibility empty state for operational feature restrictions.
 * Use this consistently across all pages when an API returns UPGRADE_REQUIRED.
 *
 * This is distinct from ModuleDisabledState which is shown when a feature
 * is entitled but disabled by the admin.
 *
 * Example usage:
 * ```tsx
 * if (error?.code === 'UPGRADE_REQUIRED') {
 *   return <UpgradeRequiredState featureName="SMS Reminders" />;
 * }
 * ```
 */

import { themeVars } from '@/theme';

// =============================================================================
// PROPS
// =============================================================================

type UpgradeRequiredStateProps = {
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

export function UpgradeRequiredState({
  featureName,
  message,
  className = '',
}: UpgradeRequiredStateProps) {
  const displayMessage = message || 'This feature is currently unavailable for this salon. Ask your salon owner to check its settings.';

  return (
    <div
      className={`rounded-2xl p-8 text-center ${className}`}
      style={{
        backgroundColor: themeVars.surfaceAlt,
        borderColor: themeVars.cardBorder,
        borderWidth: 1,
      }}
    >
      <h3
        className="mb-2 text-lg font-semibold"
        style={{ color: themeVars.titleText }}
      >
        {featureName ? `${featureName} unavailable` : 'Feature unavailable'}
      </h3>
      <p className="text-sm text-neutral-500">{displayMessage}</p>
    </div>
  );
}
