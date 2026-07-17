import {
  buildDirectionsDestination,
  buildGoogleMapsDirectionsUrl,
  type DirectionsLocation,
} from '@/libs/directions';
import { isValidPhone, normalizePhone } from '@/libs/phone';
import {
  buildGoogleReviewMessage,
  buildSatisfactionMessage,
  firstNameFor,
} from '@/libs/reviewFollowup';
import {
  DEFAULT_BOOKING_TIME_ZONE,
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from '@/libs/timeZone';

export const CLIENT_SMS_MESSAGE_KINDS = [
  'text',
  'rebook',
  'appointment_reminder',
  'appointment_details',
  'directions',
  'satisfaction',
  'google_review',
] as const;

export type ClientSmsMessageKind = (typeof CLIENT_SMS_MESSAGE_KINDS)[number];
export type NativeSmsPlatform = 'ios' | 'other';

export type ClientSmsLocation = DirectionsLocation & {
  parkingInstructions?: string | null;
  mapsUrl?: string | null;
};

export type ClientSmsAppointment = {
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  serviceNames?: Array<string | null | undefined> | null;
  artistName?: string | null;
  totalPriceCents?: number | null;
  manageUrl?: string | null;
};

export type ClientSmsContext = {
  client: {
    name?: string | null;
    phone?: string | null;
  };
  salon: {
    name?: string | null;
    bookingUrl?: string | null;
    googleReviewUrl?: string | null;
    timeZone?: string | null;
    currency?: string | null;
    location?: ClientSmsLocation | null;
  };
  appointment?: ClientSmsAppointment | null;
};

export type ClientSmsDraft = {
  body: string;
  href: string;
  recipient: string;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function salonNameFor(value: string | null | undefined): string {
  return clean(value) ?? 'the salon';
}

function validDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function safeTimeZone(value: string | null | undefined): string {
  const candidate = clean(value) ?? DEFAULT_BOOKING_TIME_ZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return DEFAULT_BOOKING_TIME_ZONE;
  }
}

function appointmentDate(context: ClientSmsContext): string | null {
  const startTime = validDate(context.appointment?.startTime);
  if (!startTime) {
    return null;
  }

  return formatDateInTimeZone(
    startTime,
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
    safeTimeZone(context.salon.timeZone),
  );
}

function appointmentTimeRange(context: ClientSmsContext): string | null {
  const startTime = validDate(context.appointment?.startTime);
  if (!startTime) {
    return null;
  }

  const timeZone = safeTimeZone(context.salon.timeZone);
  const start = formatTimeInTimeZone(startTime, {}, timeZone);
  const endTime = validDate(context.appointment?.endTime);
  if (!endTime) {
    return start;
  }

  return `${start}–${formatTimeInTimeZone(endTime, {}, timeZone)}`;
}

function serviceNamesFor(appointment: ClientSmsAppointment | null | undefined): string | null {
  const services = appointment?.serviceNames
    ?.map(service => clean(service))
    .filter((service): service is string => Boolean(service));

  if (!services?.length) {
    return null;
  }

  return [...new Set(services)].join(', ');
}

function formatPrice(cents: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) {
    return null;
  }

  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: clean(currency)?.toUpperCase() ?? 'CAD',
    }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(cents / 100);
  }
}

function buildTextMessage(context: ClientSmsContext): string {
  const name = firstNameFor(context.client.name);
  const salonName = salonNameFor(context.salon.name);
  return `Hi ${name}, it’s ${salonName} 😊 How can we help?`;
}

function buildRebookMessage(context: ClientSmsContext): string {
  const name = firstNameFor(context.client.name);
  const salonName = salonNameFor(context.salon.name);
  const bookingUrl = clean(context.salon.bookingUrl);
  const previousService = serviceNamesFor(context.appointment);
  const artistName = clean(context.appointment?.artistName);
  const withArtist = artistName ? ` with ${artistName}` : '';
  const appointmentCopy = previousService ? ` another ${previousService} appointment${withArtist}` : ` your next appointment${withArtist}`;
  const action = bookingUrl
    ? `You can choose a time here: ${bookingUrl}`
    : 'Reply to this message and we’ll help you find a time.';

  return `Hi ${name} 😊 would you like to book${appointmentCopy} at ${salonName}? ${action}`;
}

function buildAppointmentReminderMessage(context: ClientSmsContext): string {
  const name = firstNameFor(context.client.name);
  const salonName = salonNameFor(context.salon.name);
  const date = appointmentDate(context);
  const time = appointmentTimeRange(context)?.split('–')[0] ?? null;
  const serviceNames = serviceNamesFor(context.appointment);
  const artistName = clean(context.appointment?.artistName);
  const manageUrl = clean(context.appointment?.manageUrl);
  const when = date && time
    ? ` on ${date} at ${time}`
    : date
      ? ` on ${date}`
      : time
        ? ` at ${time}`
        : '';
  const lines = [
    `Hi ${name} 😊 this is a reminder about your appointment at ${salonName}${when}.`,
    ...(serviceNames ? [`Service: ${serviceNames}`] : []),
    ...(artistName ? [`Artist: ${artistName}`] : []),
    manageUrl
      ? `If you need to make any changes, use this secure link: ${manageUrl}`
      : 'If you need to make any changes, reply to this message.',
  ];

  return lines.join('\n');
}

function buildAppointmentDetailsMessage(context: ClientSmsContext): string {
  const name = firstNameFor(context.client.name);
  const salonName = salonNameFor(context.salon.name);
  const date = appointmentDate(context);
  const time = appointmentTimeRange(context);
  const serviceNames = serviceNamesFor(context.appointment);
  const artistName = clean(context.appointment?.artistName);
  const price = formatPrice(context.appointment?.totalPriceCents, context.salon.currency);
  const manageUrl = clean(context.appointment?.manageUrl);
  const address = buildDirectionsDestination(context.salon.location);
  const lines = [
    `Hi ${name} 😊 here are your appointment details for ${salonName}:`,
    ...(date ? [`Date: ${date}`] : []),
    ...(time ? [`Time: ${time}`] : []),
    ...(serviceNames ? [`Service: ${serviceNames}`] : []),
    ...(artistName ? [`Artist: ${artistName}`] : []),
    ...(price ? [`Price: ${price}`] : []),
    ...(address ? [`Address: ${address}`] : []),
    manageUrl
      ? `View or change your appointment: ${manageUrl}`
      : 'Reply to this message if you need to make a change.',
  ];

  return lines.join('\n');
}

function buildDirectionsMessage(context: ClientSmsContext): string {
  const name = firstNameFor(context.client.name);
  const salonName = salonNameFor(context.salon.name);
  const location = context.salon.location;
  const address = buildDirectionsDestination(location);
  const parking = clean(location?.parkingInstructions);
  const mapsUrl = clean(location?.mapsUrl) ?? buildGoogleMapsDirectionsUrl(location);
  const hasDirections = Boolean(address || parking || mapsUrl);
  const lines = [
    `Hi ${name} 😊 here are directions to ${salonName}:`,
    ...(address ? [address] : []),
    ...(parking ? [`Parking: ${parking}`] : []),
    ...(mapsUrl ? [`Maps: ${mapsUrl}`] : []),
    ...(!hasDirections ? ['Reply to this message for directions and parking information.'] : []),
  ];

  return lines.join('\n');
}

/**
 * Builds editable client-facing copy for every native Messages action.
 * Returns null only when a message fundamentally cannot be composed (currently
 * a Google review request without a configured review URL).
 */
export function buildClientSmsMessage(
  kind: ClientSmsMessageKind,
  context: ClientSmsContext,
): string | null {
  switch (kind) {
    case 'text':
      return buildTextMessage(context);
    case 'rebook':
      return buildRebookMessage(context);
    case 'appointment_reminder':
      return buildAppointmentReminderMessage(context);
    case 'appointment_details':
      return buildAppointmentDetailsMessage(context);
    case 'directions':
      return buildDirectionsMessage(context);
    case 'satisfaction':
      return buildSatisfactionMessage({
        salonName: salonNameFor(context.salon.name),
        clientName: context.client.name,
      });
    case 'google_review':
      return buildGoogleReviewMessage({
        salonName: salonNameFor(context.salon.name),
        clientName: context.client.name,
        googleReviewUrl: context.salon.googleReviewUrl,
      });
  }
}

/** Pure user-agent detection; callers supply navigator.userAgent themselves. */
export function detectNativeSmsPlatform(userAgent: string | null | undefined): NativeSmsPlatform {
  const value = userAgent ?? '';
  const isIOSDevice = /iPad|iPhone|iPod/i.test(value);
  const isIPadDesktopMode = /Macintosh/i.test(value) && /Mobile/i.test(value);
  return isIOSDevice || isIPadDesktopMode ? 'ios' : 'other';
}

/**
 * Builds a native Messages URI without reading browser globals. Apple expects
 * `&body=`, while Android and other platforms expect `?body=`.
 */
export function buildNativeSmsUrl(args: {
  phone: string | null | undefined;
  body: string;
  platform: NativeSmsPlatform;
}): string | null {
  const rawPhone = args.phone ?? '';
  if (!isValidPhone(rawPhone)) {
    return null;
  }

  const recipient = normalizePhone(rawPhone);
  const separator = args.platform === 'ios' ? '&' : '?';
  return `sms:${recipient}${separator}body=${encodeURIComponent(args.body)}`;
}

/** Composes both the editable copy and its native Messages URI. */
export function composeClientSmsDraft(args: {
  kind: ClientSmsMessageKind;
  context: ClientSmsContext;
  platform: NativeSmsPlatform;
}): ClientSmsDraft | null {
  const body = buildClientSmsMessage(args.kind, args.context);
  if (!body) {
    return null;
  }

  const href = buildNativeSmsUrl({
    phone: args.context.client.phone,
    body,
    platform: args.platform,
  });
  if (!href) {
    return null;
  }

  return {
    body,
    href,
    recipient: normalizePhone(args.context.client.phone ?? ''),
  };
}
