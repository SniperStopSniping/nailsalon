/** Pure, dark-by-default resolver shared by server route guards. */
export const resolveOnboardingV1IntegrationEnabled = (
  configuredValue: string | undefined,
): boolean => configuredValue === 'true';
