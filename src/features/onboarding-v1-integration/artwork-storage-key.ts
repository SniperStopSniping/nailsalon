/** A media-row alias into the shared immutable website asset library. */
const KEY = /^custom_site_asset:([\w-]{1,160}):([\w-]{1,160}):([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/u;
export function onboardingArtworkStorageKey(owner: { salonId: string; siteId: string }, assetId: string) {
  const key = `custom_site_asset:${owner.salonId}:${owner.siteId}:${assetId}`;
  if (!KEY.test(key)) {
    throw new Error('Invalid artwork storage identity.');
  }
  return key;
}
export function onboardingArtworkAssetId(key: string, owner: { salonId: string; siteId?: string }) {
  const match = KEY.exec(key);
  return match && match[1] === owner.salonId && (!owner.siteId || match[2] === owner.siteId) ? match[3]! : null;
}
