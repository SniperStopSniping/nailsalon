import 'server-only';

import { Env } from '@/libs/Env';

import { resolveSectionLibraryV1Enabled } from './feature-flag';

/**
 * Dark by default. Gates the owner Section Gallery route; presentation
 * hiding alone is not a security boundary, so the route also requires an
 * authenticated owner session.
 */
export function isSectionLibraryV1Enabled(): boolean {
  return resolveSectionLibraryV1Enabled(Env.LUSTER_SECTION_LIBRARY_V1_ENABLED);
}
