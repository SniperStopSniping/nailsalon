import { buildSalonTenantPublicUrl } from './publicUrl';

export type AppointmentManageUrlSalon = {
  slug: string;
  customDomain?: string | null;
};

/**
 * The single canonical builder for customer appointment-management links.
 *
 * Every customer-facing email (booking confirmation, recovery/"booking
 * access", reminders, reschedule confirmation) and the booking API response
 * must go through here so the route shape can never drift between senders.
 *
 * The capability token is opaque and URL-safe (base64url), but it is still
 * encoded defensively: a link that silently loses its last characters to a
 * stray character is indistinguishable from an expired one for the customer.
 */
export function buildAppointmentManageUrl(
  salon: AppointmentManageUrlSalon,
  token: string,
  locale?: string,
): string {
  return buildSalonTenantPublicUrl(
    `/manage/${encodeURIComponent(token)}`,
    { slug: salon.slug, customDomain: salon.customDomain ?? null },
    locale,
  );
}

/**
 * Reschedule deep-link for the same capability. Kept next to the builder above
 * so the `/manage/<token>/…` sub-route shape lives in exactly one place.
 */
export function buildAppointmentRescheduleUrl(
  salon: AppointmentManageUrlSalon,
  token: string,
  locale?: string,
): string {
  return `${buildAppointmentManageUrl(salon, token, locale)}/reschedule`;
}
