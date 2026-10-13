export function getSavedOnboardingSitePreviewUrl(input: {
  embedded?: boolean;
  locale: string;
  siteId: string;
}): string {
  const locale = input.locale === 'fr' ? 'fr' : 'en';
  const base = `/${locale}/admin/website/preview/${encodeURIComponent(input.siteId)}`;
  return input.embedded ? `${base}?embed=1` : base;
}

/** Preserve the verified saved-site handoff after an explicit successful publish. */
export function getOnboardingDashboardHandoffUrl(input: {
  locale: string;
  salonSlug: string;
  siteId: string;
  planIntent: string;
}): string {
  const locale = input.locale === 'fr' ? 'fr' : 'en';
  const query = new URLSearchParams({
    onboarding: 'complete',
    salon: input.salonSlug,
    site: input.siteId,
    planIntent: input.planIntent,
  });
  return `/${locale}/admin?${query}`;
}
