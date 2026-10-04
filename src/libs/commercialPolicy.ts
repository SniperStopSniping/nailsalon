/** Current commercial policy. Historical plan and credit records stay immutable. */
export const COMMERCIAL_POLICY = Object.freeze({
  key: 'free_sms_topups_2026_10',
  allFeaturesIncluded: true,
  subscriptionsForSale: false,
  starterCredits: 50,
  lowBalanceThreshold: 20,
});

export const SMS_BALANCE_CHANGED_EVENT = 'luster:sms-balance-changed';
export const OPEN_USAGE_TOPUPS_EVENT = 'luster:open-usage-topups';

export function textBalanceState(available: number): 'empty' | 'low' | 'healthy' {
  return available <= 0 ? 'empty' : available <= COMMERCIAL_POLICY.lowBalanceThreshold ? 'low' : 'healthy';
}

export function textBalanceSubtitle(available: number): string {
  return `${available} text${available === 1 ? '' : 's'} remaining · ${textBalanceState(available) === 'healthy' ? 'Buy more' : 'Top up now'}`;
}

/** Navigate to the existing workspace usage destination. */
export function openUsageTopups() {
  window.dispatchEvent(new Event(OPEN_USAGE_TOPUPS_EVENT));
}
