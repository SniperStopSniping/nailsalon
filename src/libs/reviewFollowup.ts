/**
 * Post-appointment review follow-up.
 *
 * Pure helpers for the message templates the tech can copy/send (or route
 * through n8n later) and for the action enum stored on the appointment.
 * No SMS/email is sent from here — the tech copies the text for now.
 */

export const REVIEW_FOLLOWUP_ACTIONS = [
  'satisfaction_question',
  'google_review_link',
  'skipped',
  'already_reviewed',
] as const;

export type ReviewFollowupAction = (typeof REVIEW_FOLLOWUP_ACTIONS)[number];

export function isReviewFollowupAction(value: unknown): value is ReviewFollowupAction {
  return typeof value === 'string' && (REVIEW_FOLLOWUP_ACTIONS as readonly string[]).includes(value);
}

/**
 * Take the client's first name for a friendly greeting.
 * Falls back to "there" when no usable name is stored.
 */
export function firstNameFor(clientName?: string | null): string {
  const trimmed = clientName?.trim();
  if (!trimmed) {
    return 'there';
  }
  return trimmed.split(/\s+/)[0] ?? 'there';
}

/**
 * "Were you happy?" message — sent first when the tech wants to gauge
 * satisfaction before asking for a public review.
 */
export function buildSatisfactionMessage(args: {
  salonName: string;
  clientName?: string | null;
}): string {
  const name = firstNameFor(args.clientName);
  return `Hi ${name} 😊 thank you for coming to ${args.salonName} today. Were you happy with your nails?`;
}

/**
 * Direct Google review ask, including the salon's review link.
 * Returns null when no review URL is configured (caller should disable the option).
 */
export function buildGoogleReviewMessage(args: {
  salonName: string;
  clientName?: string | null;
  googleReviewUrl?: string | null;
}): string | null {
  const url = args.googleReviewUrl?.trim();
  if (!url) {
    return null;
  }
  const name = firstNameFor(args.clientName);
  return `Hi ${name} 😊 thank you for coming to ${args.salonName} today. I would really appreciate it if you could leave us a Google review: ${url}`;
}

/**
 * Whether the post-appointment review prompt should be shown at all.
 * Suppressed once the client is marked as already reviewed.
 */
export function shouldPromptForReview(client: { hasGoogleReview?: boolean | null }): boolean {
  return !client.hasGoogleReview;
}
