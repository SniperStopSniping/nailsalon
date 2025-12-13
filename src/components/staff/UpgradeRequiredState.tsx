'use client';

/**
 * UpgradeRequiredState Component
 *
 * Reusable empty state shown when a feature requires a plan upgrade.
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
  const displayMessage = message || 'This feature is not included in your current plan.';

  return (
    <div
      className={`rounded-2xl p-8 text-center ${className}`}
      style={{
        backgroundColor: themeVars.surfaceAlt,
        borderColor: themeVars.cardBorder,
        borderWidth: 1,
      }}
    >
      <div className="mb-3 text-4xl">⬆️</div>
      <h3
        className="mb-2 text-lg font-semibold"
        style={{ color: themeVars.titleText }}
      >
        {featureName ? `Upgrade to unlock ${featureName}` : 'Upgrade Required'}
      </h3>
      <p className="text-sm text-neutral-500">{displayMessage}</p>
    </div>
  );
}
