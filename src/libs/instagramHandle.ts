/**
 * The ONE Instagram interpretation shared by every owner-facing editor.
 *
 * One value, one stored form, one thing the owner sees:
 *   - input   — a bare handle, `@handle`, or a profile URL (all accepted)
 *   - stored  — `https://www.instagram.com/<handle>/` in
 *               `settings.bookingExperience.socialLinks.instagram`
 *   - shown   — the bare handle in the field, `@handle` next to it (what the
 *               public page renders)
 *
 * Parsing is delegated to the onboarding resolver so the dashboard can never
 * disagree with the flow that first collected the value; this module only adds
 * the canonical URL/handle projections the editors need.
 *
 * Callers: `PATCH /api/admin/salon/information` (Your Information → Contact)
 * and Settings → Branding. Do not add a third interpretation.
 */

import { resolveInstagramUsername } from '../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/contact';

/** Field label and helper text, so both editors read identically. */
export const INSTAGRAM_FIELD_LABEL = 'Instagram';
export const INSTAGRAM_FIELD_HELPER = 'Username or link';

export type InstagramInputResolution =
  | { status: 'empty'; username: null; url: null }
  | { status: 'invalid'; username: null; url: null; error: string }
  | { status: 'resolved'; username: string; url: string };

/** The canonical stored form for a resolved handle. */
export function buildInstagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

/**
 * Accepts `handle`, `@handle` or a profile URL and reports the canonical
 * handle plus the canonical stored URL. Anything else is `invalid` with the
 * onboarding wording, so both editors refuse the same inputs for the same
 * reason.
 */
export function resolveInstagramInput(value: unknown): InstagramInputResolution {
  const resolution = resolveInstagramUsername(value);
  if (resolution.status === 'empty') {
    return { status: 'empty', username: null, url: null };
  }
  if (resolution.status === 'invalid') {
    return { status: 'invalid', username: null, url: null, error: resolution.error };
  }
  return {
    status: 'resolved',
    username: resolution.username,
    url: buildInstagramProfileUrl(resolution.username),
  };
}

/**
 * The bare handle to pre-fill an editor with — never the stored URL. An
 * unparseable stored value is returned verbatim so the owner can see and
 * correct it instead of it silently disappearing from the field.
 */
export function toInstagramHandle(stored: string | null | undefined): string {
  if (typeof stored !== 'string' || stored.trim() === '') {
    return '';
  }
  const resolution = resolveInstagramInput(stored);
  return resolution.status === 'resolved' ? resolution.username : stored.trim();
}

/** What customers see: `@handle`, or null when nothing is configured. */
export function formatInstagramHandle(stored: string | null | undefined): string | null {
  const resolution = resolveInstagramInput(stored);
  return resolution.status === 'resolved' ? `@${resolution.username}` : null;
}
