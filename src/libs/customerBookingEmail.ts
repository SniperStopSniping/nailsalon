import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

export async function sendCustomerBookingConfirmationEmail(input: {
  to: string;
  salonName: string;
  clientName: string;
  serviceNames: string[];
  startTime: string;
  timeZone: string;
  manageUrl: string;
}) {
  const { sendTransactionalEmail } = await import('@/libs/email');
  const date = formatDateInTimeZone(input.startTime, { weekday: 'long', month: 'long', day: 'numeric' }, input.timeZone);
  const time = formatTimeInTimeZone(input.startTime, {}, input.timeZone);
  const subject = `${input.salonName} booking confirmed`;
  const text = [
    `Hi ${input.clientName},`,
    `Your ${input.serviceNames.join(', ')} appointment with ${input.salonName} is confirmed for ${date} at ${time}.`,
    `View, reschedule, or cancel: ${input.manageUrl}`,
  ].join('\n\n');
  const html = `<p>Hi ${escapeHtml(input.clientName)},</p><p>Your <strong>${escapeHtml(input.serviceNames.join(', '))}</strong> appointment with ${escapeHtml(input.salonName)} is confirmed for <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(input.manageUrl)}">View, reschedule, or cancel your appointment</a></p>`;
  return sendTransactionalEmail({ to: input.to, subject, text, html });
}
