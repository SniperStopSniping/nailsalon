import 'server-only';

import { SetupError } from '@/features/business-setup/contracts';

import { customSiteRendererOrigin } from './payload.server';

/** Enrollment only. Disabling this must not break already published photo sections. */
export function canvaNativePhotosEnabled() {
  return process.env.CUSTOM_SITE_NATIVE_PHOTOS_ENABLED === 'true';
}

export async function assertNativePhotoRendererReady() {
  const origin = customSiteRendererOrigin();
  if (!origin) {
    throw new SetupError('NOT_READY', 'Your photo preview is unavailable. Try again before publishing.');
  }
  try {
    const response = await fetch(`${origin}/renderer`, { method: 'HEAD', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok || response.headers.get('x-luster-renderer-capabilities') !== 'native-images-v1') {
      throw new Error('Renderer is not ready');
    }
  } catch {
    throw new SetupError('NOT_READY', 'Your photo preview is unavailable. Your draft is saved; try publishing again shortly.');
  }
}
