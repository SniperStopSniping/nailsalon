export const ONBOARDING_ACCOUNT_HISTORY_STATE = {
  lusterOnboardingAccountGate: true,
} as const;

export const getOnboardingIntegrationRoute = (locale: string): string =>
  `/${locale === 'fr' ? 'fr' : 'en'}/onboarding-v1`;

export const getAccountGateUrl = (locale: string): string =>
  `${getOnboardingIntegrationRoute(locale)}?account=1`;

export const hasAccountGateQuery = (search: string): boolean => {
  const query = new URLSearchParams(search);
  return query.has('account')
    || query.has('auth')
    || query.has('claim')
    || query.has('sso');
};

export const pushAccountGateHistory = (
  locale: string,
  history: Pick<History, 'pushState'> = window.history,
): void => {
  history.pushState(
    ONBOARDING_ACCOUNT_HISTORY_STATE,
    '',
    getAccountGateUrl(locale),
  );
};
