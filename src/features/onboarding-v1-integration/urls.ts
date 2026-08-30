export function getSavedOnboardingSitePreviewUrl(input: {
  embedded?: boolean;
  locale: string;
  siteId: string;
}): string {
  const locale = input.locale === 'fr' ? 'fr' : 'en';
  const base = `/${locale}/admin/website/preview/${encodeURIComponent(input.siteId)}`;
  return input.embedded ? `${base}?embed=1` : base;
}
