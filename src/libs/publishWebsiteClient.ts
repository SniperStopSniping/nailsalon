/** Use the existing owner-authorized endpoint for every first-publish entry. */
export async function publishSalon(salonSlug: string): Promise<{ publicationStatus: string; hasDraftChanges?: boolean }> {
  const response = await fetch(`/api/admin/salon/publish?salonSlug=${encodeURIComponent(salonSlug)}`, {
    method: 'POST',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.data?.publicationStatus !== 'published') {
    throw new Error('Your website could not be published. Your saved setup is safe. Please try again.');
  }
  return payload.data;
}
