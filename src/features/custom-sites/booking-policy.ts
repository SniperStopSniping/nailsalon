export type CustomSiteBookingPolicy = { title: string; text: string };

/** Only policy copy explicitly selected for the service page belongs on the site. */
export function publicCustomSiteBookingPolicy(value: unknown): CustomSiteBookingPolicy | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const policy = value as Record<string, unknown>;
  if (policy.enabled !== true || policy.showOnServicePage !== true || typeof policy.text !== 'string' || !policy.text.trim()) {
    return null;
  }
  return { title: typeof policy.title === 'string' && policy.title.trim() ? policy.title : 'Booking policies', text: policy.text };
}
