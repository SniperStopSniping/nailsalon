import { normalizePhone } from './policy';

export type CallerContext = {
  match: 'matched' | 'not_found' | 'ambiguous' | 'unavailable';
  name: string | null;
  nextAppointment: { startTime: Date; status: string; services: string[] } | null;
};

export type OwnerAlertEvent = {
  kind: string;
  phone: string | null;
  body: string | null;
  receivedAt: Date;
};

const localTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Toronto',
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});
const field = (value: string, max = 120) => value.replace(/\s+/gu, ' ').trim().slice(0, max);
const dateTime = (date: Date) => Number.isFinite(date.getTime()) ? localTime.format(date) : 'Unavailable';

/** Plain text: client messages cannot supply Telegram markup or change links. */
export function formatOwnerAlert(event: OwnerAlertEvent, context: CallerContext): string {
  const phone = event.phone && normalizePhone(event.phone);
  const displayedPhone = phone
    ? `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`
    : 'Unavailable / withheld';
  const name = context.match === 'matched' && context.name && field(context.name);
  const next = context.match === 'matched' ? context.nextAppointment : null;
  const unknown = context.match === 'unavailable'
    ? 'Temporarily unavailable'
    : context.match === 'ambiguous' ? 'Client match unclear' : 'Not found in client list';
  const lines = [
    event.kind === 'call' ? '📞 Incoming call — Isla Nail Studio' : '💬 Incoming text — Isla Nail Studio',
    `Phone: ${displayedPhone}`,
    `Date/time (Toronto): ${dateTime(event.receivedAt)}`,
    `Name: ${name || (context.match === 'matched' ? 'Not saved' : unknown)}`,
    `Next appointment: ${next
      ? `${dateTime(next.startTime)}${next.status === 'pending' ? ' (pending confirmation)' : ''}`
      : context.match === 'matched' ? 'None scheduled' : context.match === 'unavailable' ? 'Could not verify' : 'Not linked'}`,
  ];
  if (next?.services.length) {
    lines.push(`Services: ${next.services.slice(0, 4).map(name => field(name, 80)).join(', ')}`);
  }
  if (event.kind === 'call') {
    lines.push('Message: Phone call — no written message.');
    return lines.join('\n');
  }
  lines.push('Message:');
  const prefix = `${lines.join('\n')}\n`;
  const body = event.body?.trim() || '(Empty text message)';
  const shortened = '\n[Message shortened]';
  const available = 4000 - prefix.length;
  return prefix + (body.length > available ? body.slice(0, available - shortened.length) + shortened : body);
}
