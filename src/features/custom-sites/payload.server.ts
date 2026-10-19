import 'server-only';

import { getDomain } from 'tldts';

import type { SetupDocument } from '@/features/business-setup/contracts';
import { WEEKDAYS } from '@/features/business-setup/contracts';
import { db } from '@/libs/DB';

import { assertCustomArtifact } from './artifacts.server';
import { assetDataUrl } from './assets.server';
import { publicCustomSiteBookingPolicy } from './booking-policy';
import { canvaFactsMatch, canvaServiceKey } from './canva-data.server';
import type { CustomSiteData, CustomSitePayload, CustomSiteSource } from './contracts';
import { customSiteDataFromSetup } from './setup-data';
import { customSourceImageIds } from './validate.server';

/** No same-origin fallback: missing isolation leaves the existing booking flow available. */
export function customSiteRendererOrigin() {
  const raw = process.env.CUSTOM_SITE_RENDER_ORIGIN;
  const app = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw || !app) {
    return null;
  }
  try {
    const render = new URL(raw);
    const parent = new URL(app);
    if (render.pathname !== '/' || render.search || render.hash || render.username || render.password || render.hostname === parent.hostname) {
      return null;
    }
    const local = process.env.NODE_ENV !== 'production' && render.hostname === '127.0.0.1' && parent.hostname === 'localhost' && render.protocol === 'http:';
    // Pilot cannot be hosted until its separate site has been reviewed. A
    // subdomain on the administration cookie domain is explicitly insufficient.
    if (!local && (render.protocol !== 'https:' || process.env.CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED !== 'true' || !getDomain(render.hostname, { allowPrivateDomains: true }) || !getDomain(parent.hostname, { allowPrivateDomains: true }) || getDomain(render.hostname, { allowPrivateDomains: true }) === getDomain(parent.hostname, { allowPrivateDomains: true }))) {
      return null;
    }
    return render.origin;
  } catch {
    return null;
  }
}
export async function customSitePayload(salonId: string, artifactId: string, data: CustomSiteData, comparison?: { artworkPolicy: SetupDocument['bookingPolicy'] }): Promise<CustomSitePayload> {
  data = { ...data, bookingPolicy: publicCustomSiteBookingPolicy(data.bookingRules?.policy) };
  // Review fingerprints bind the server's complete policy contract. The
  // customer projection intentionally omits dormant acknowledgment settings;
  // compare those privately without adding them to the public frame payload.
  const facts = comparison ? { ...data, bookingRules: { ...data.bookingRules, policy: comparison.artworkPolicy } } : data;
  const { artifact, media } = await assertCustomArtifact(db, salonId, artifactId);
  if (artifact.source.canva && !data.preview && (!artifact.source.canva.ownerReviewed || !canvaFactsMatch(artifact.source, facts))) {
    // Never serialize stale raster text/bytes, including an address the owner
    // subsequently hid. The public page falls back to original live booking.
    return { source: { title: 'Booking', html: '<main></main>', css: '', javascript: '', analysis: '', limitations: [] }, data, images: {}, artworkUnavailable: true };
  }
  const images: Record<string, string> = {};
  const used = customSourceImageIds(artifact.source.html);
  for (const asset of media.filter(a => a.role !== 'reference' && used.has(a.id))) {
    images[asset.id] = await assetDataUrl(asset);
  }
  const hoursLabel = WEEKDAYS.map((day) => {
    const hours = data.business.hours[day];
    return `${day[0]!.toUpperCase()}${day.slice(1)}: ${hours ? `${hours.open}–${hours.close}` : 'Closed'}`;
  }).join(' · ');
  const serviceKeys: Record<string, string> = {};
  if (artifact.source.canva) {
    for (const service of data.services) {
      const key = canvaServiceKey(service);
      if (data.services.filter(item => canvaServiceKey(item) === key).length === 1) {
        serviceKeys[key] = service.id;
      }
    }
  }
  return { source: data.preview ? artifact.source : publicCustomSiteSource(artifact.source), data: { ...data, business: { ...data.business, hoursLabel } }, images, ...(artifact.source.canva ? { serviceKeys, canvaFactsChanged: !canvaFactsMatch(artifact.source, facts, true), canvaReviewRequired: !artifact.source.canva.ownerReviewed || !canvaFactsMatch(artifact.source, facts, true) } : {}) };
}

/** OCR and model critique are private editing evidence, not public site data. */
export function publicCustomSiteSource(source: CustomSiteSource): CustomSiteSource {
  return { ...source, analysis: '', limitations: [], ...(source.canva ? { canva: { ...source.canva, visibleText: '', notes: [] } } : {}) };
}

/** Shared by the owner studio and its full-page authenticated preview. */
export function setupCustomSitePayload(salonId: string, document: SetupDocument) {
  const id = document.website.config.customFrontendId;
  if (!id) {
    return null;
  }
  return customSitePayload(salonId, id, customSiteDataFromSetup(document));
}
