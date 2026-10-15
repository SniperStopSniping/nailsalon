import 'server-only';

import { db } from '@/libs/DB';

import { assertCustomArtifact } from './artifacts.server';
import { assetDataUrl } from './assets.server';
import type { CustomSiteData, CustomSitePayload } from './contracts';
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
    if (!local && (render.protocol !== 'https:' || process.env.CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED !== 'true' || render.hostname.split('.').slice(-2).join('.') === parent.hostname.split('.').slice(-2).join('.'))) {
      return null;
    }
    return render.origin;
  } catch {
    return null;
  }
}
export async function customSitePayload(salonId: string, artifactId: string, data: CustomSiteData): Promise<CustomSitePayload> {
  const { artifact, media } = await assertCustomArtifact(db, salonId, artifactId);
  const images: Record<string, string> = {};
  const used = customSourceImageIds(artifact.source.html);
  for (const asset of media.filter(a => a.role !== 'reference' && used.has(a.id))) {
    images[asset.id] = await assetDataUrl(asset);
  }
  return { source: artifact.source, data, images };
}
