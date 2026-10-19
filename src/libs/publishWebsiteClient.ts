const UNCONFIRMED_PUBLICATION = 'We could not confirm that your website is live. Your saved setup is safe. Please try again.';
const READINESS_MESSAGES: Readonly<Record<string, string>> = {
  DESIGN_IMAGES_PENDING: 'Your design images have not finished saving. Return to your setup and retry the images before publishing.',
  DESIGN_PUBLICATION_UNAVAILABLE: 'Your Canva design is not ready to go live yet. Your saved draft is safe. Return to your setup.',
  SAVED_DESIGN_INVALID: 'Your saved website could not be checked. Return to your setup and save it again before publishing.',
  SETUP_REVIEW_REQUIRED: 'Review your website and business setup together before publishing.',
};

/** Use the existing owner-authorized endpoint for every first-publish entry. */
export async function publishSalon(salonSlug: string): Promise<{ publicationStatus: string; hasDraftChanges?: boolean }> {
  const response = await fetch(`/api/admin/salon/publish?salonSlug=${encodeURIComponent(salonSlug)}`, {
    method: 'POST',
  }).catch(() => {
    // A lost response may follow a committed publication. Never claim a
    // rollback, and never expose a raw network/provider diagnostic.
    throw new Error(UNCONFIRMED_PUBLICATION);
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.data?.publicationStatus !== 'published') {
    const code = payload?.error?.code;
    throw new Error(response.status === 409 && typeof code === 'string' && Object.hasOwn(READINESS_MESSAGES, code)
      ? READINESS_MESSAGES[code]
      : UNCONFIRMED_PUBLICATION);
  }
  return payload.data;
}
