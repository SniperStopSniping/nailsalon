import 'server-only';

import { sendTransactionalEmailDetailed } from '@/libs/email';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\'': '&#39;',
    '"': '&quot;',
  })[character]!);
}

export async function sendSalonSignupInviteEmail(input: {
  to: string;
  joinUrl: string;
  expiresAt: Date;
  salonName?: string | null;
}) {
  const isClaim = Boolean(input.salonName);
  const subject = isClaim
    ? `Finish setting up ${input.salonName} on Luster`
    : 'Your Luster booking page invitation';
  const expiry = input.expiresAt.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Toronto',
  });
  const intro = isClaim
    ? `You have been invited to claim ${input.salonName} and finish its booking setup.`
    : 'You have been invited to create your free Luster booking page.';
  const text = `${intro}\n\nCreate or sign in to your owner account: ${input.joinUrl}\n\nThis private invitation expires ${expiry}.`;
  const html = `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(input.joinUrl)}">Continue to Luster</a></p><p>This private invitation expires ${escapeHtml(expiry)}.</p>`;

  return sendTransactionalEmailDetailed({
    to: input.to,
    subject,
    text,
    html,
  });
}
