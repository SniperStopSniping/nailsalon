import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { sendTransactionalEmail } from '@/libs/email';
import type { GoogleFailureClassification } from '@/libs/googleCalendarFailure';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import { salonSchema } from '@/models/Schema';

/**
 * Tell the salon their calendar connection died.
 *
 * Until this existed, a dropped connection took the salon off online booking
 * silently — nobody was told, and the first sign was a customer unable to pick
 * a time. The caller only invokes this on the transition into
 * `reconnect_required`, so one outage produces one email.
 */
export async function sendGoogleCalendarDisconnectedEmail(args: {
  salonId: string;
  classification: GoogleFailureClassification;
}): Promise<boolean> {
  const [salon] = await db
    .select({
      name: salonSchema.name,
      slug: salonSchema.slug,
      ownerEmail: salonSchema.ownerEmail,
      email: salonSchema.email,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, args.salonId))
    .limit(1);

  const recipient = salon?.ownerEmail?.trim() || salon?.email?.trim();
  if (!salon || !recipient) {
    return false;
  }

  const reconnectUrl = `${getCanonicalAppOrigin()}/admin/integrations`;
  const salonName = salon.name || 'your salon';

  const text = [
    `Online booking is paused for ${salonName}.`,
    '',
    'Google Calendar disconnected, so we can no longer check your calendar for conflicts. To avoid double-booking you, we have paused online booking until the connection is restored.',
    '',
    `What happened: ${args.classification.message}`,
    '',
    `Reconnect Google Calendar: ${reconnectUrl}`,
    '',
    'Existing appointments are unaffected, and you can still book clients in manually.',
  ].join('\n');

  const html = [
    `<p><strong>Online booking is paused for ${escapeHtml(salonName)}.</strong></p>`,
    '<p>Google Calendar disconnected, so we can no longer check your calendar for conflicts. To avoid double-booking you, we have paused online booking until the connection is restored.</p>',
    `<p><em>What happened:</em> ${escapeHtml(args.classification.message)}</p>`,
    `<p><a href="${escapeHtml(reconnectUrl)}" style="display:inline-block;padding:12px 20px;border-radius:9999px;background:#9f1239;color:#ffffff;font-weight:600;text-decoration:none">Reconnect Google Calendar</a></p>`,
    '<p>Existing appointments are unaffected, and you can still book clients in manually.</p>',
  ].join('');

  return sendTransactionalEmail({
    to: recipient,
    subject: `Action needed: Google Calendar disconnected for ${salonName}`,
    text,
    html,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}
