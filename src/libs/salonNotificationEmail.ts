import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { sendTransactionalEmailDetailed } from '@/libs/email';
import { formatMoney } from '@/libs/formatMoney';
import { getCanonicalAppOrigin } from '@/libs/publicUrl';
import {
  resolveSalonEmailNotificationSettings,
  resolveSalonNotificationRecipient,
  type SalonEmailNotificationEvent,
} from '@/libs/salonNotificationEmailSettings';
import { SMART_FIT_DISCOUNT_TYPE } from '@/libs/smartFit';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import {
  appointmentAddOnSchema,
  appointmentSchema,
  appointmentServicesSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// TYPES
// =============================================================================

export type SalonNotificationEventKey = SalonEmailNotificationEvent;

/** Where the customer action came from. Never a client identifier. */
export type SalonNotificationSource
  = | 'online_booking'
  | 'client_manage_link'
  | 'dashboard'
  | 'unknown';

/**
 * The confirmed pre-reschedule schedule. Every field is read from the original
 * appointment row *after* the reschedule committed, so it is the real previous
 * state, not what the client had on screen.
 */
export type SalonNotificationPreviousSchedule = {
  appointmentId: string;
  startTime: string;
  endTime: string;
  technicianName: string | null;
  serviceSummary: string;
  discountLabel: string | null;
  discountAmountCents: number;
  totalPriceCents: number;
};

export type SalonNotificationCancellation = {
  reason: string | null;
  cancelledAt: string;
};

export type SendSalonNotificationEmailInput = {
  salonId: string;
  appointmentId: string;
  event: SalonNotificationEventKey;
  source: SalonNotificationSource;
  previous?: SalonNotificationPreviousSchedule;
  cancellation?: SalonNotificationCancellation;
};

export type SendSalonNotificationEmailResult =
  | { status: 'sent'; deliveryId: string }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: 'disabled' | 'appointment_not_found' }
  | { status: 'failed'; reason: string; deliveryId: string | null };

export type SalonNotificationContext = {
  appointment: typeof appointmentSchema.$inferSelect;
  salon: {
    id: string;
    name: string;
    slug: string;
    customDomain: string | null;
    ownerEmail: string | null;
    email: string | null;
    settings: SalonSettings | null;
  };
  technicianName: string | null;
  services: Array<{ name: string; priceCents: number; durationMinutes: number }>;
  addOns: Array<{ name: string; quantity: number; lineTotalCents: number }>;
  timeZone: string;
  currency: string;
};

const EVENT_PURPOSE: Record<SalonNotificationEventKey, string> = {
  newBooking: 'salon_new_booking',
  rescheduled: 'salon_rescheduled',
  cancelled: 'salon_cancelled',
};

const EVENT_LABEL: Record<SalonNotificationEventKey, string> = {
  newBooking: 'New booking',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
};

const EVENT_ACCENT: Record<SalonNotificationEventKey, { bg: string; fg: string }> = {
  newBooking: { bg: '#E7F6EC', fg: '#1B6B39' },
  rescheduled: { bg: '#FDF1DC', fg: '#8A5A08' },
  cancelled: { bg: '#FCE9E9', fg: '#9B1C1C' },
};

const SOURCE_LABEL: Record<SalonNotificationSource, string> = {
  online_booking: 'Online booking page',
  client_manage_link: 'Client manage link',
  dashboard: 'Salon dashboard',
  unknown: 'Unknown',
};

// =============================================================================
// IDEMPOTENCY
// =============================================================================

/**
 * A reschedule mints a *new* appointment row, so the appointment id alone
 * already separates two legitimate reschedules. The schedule hash is the
 * belt-and-braces guarantee: an endpoint/queue/webhook retry of one confirmed
 * reschedule reproduces the exact same key and is rejected by the unique index,
 * while a genuinely different move produces a different one.
 */
export function buildRescheduleEventVersion(input: {
  previousAppointmentId: string;
  previousStartTime: string;
  previousEndTime: string;
  newStartTime: string;
  newEndTime: string;
}): string {
  return createHash('sha256')
    .update([
      input.previousAppointmentId,
      input.previousStartTime,
      input.previousEndTime,
      input.newStartTime,
      input.newEndTime,
    ].join('|'))
    .digest('hex')
    .slice(0, 12);
}

export function buildSalonNotificationDedupeKey(input: {
  appointmentId: string;
  event: SalonNotificationEventKey;
  eventVersion?: string;
}): string {
  switch (input.event) {
    case 'newBooking':
      return `appointment:${input.appointmentId}:salon:new-booking`;
    case 'cancelled':
      return `appointment:${input.appointmentId}:salon:cancelled`;
    case 'rescheduled':
      return `appointment:${input.appointmentId}:salon:rescheduled:${input.eventVersion ?? 'unknown'}`;
  }
}

// =============================================================================
// CONTEXT LOADING
// =============================================================================

async function loadSalonNotificationContext(
  salonId: string,
  appointmentId: string,
): Promise<SalonNotificationContext | null> {
  const [row] = await db
    .select({
      appointment: appointmentSchema,
      salonName: salonSchema.name,
      salonSlug: salonSchema.slug,
      salonCustomDomain: salonSchema.customDomain,
      salonOwnerEmail: salonSchema.ownerEmail,
      salonEmail: salonSchema.email,
      salonSettings: salonSchema.settings,
      technicianName: technicianSchema.name,
    })
    .from(appointmentSchema)
    .innerJoin(salonSchema, eq(salonSchema.id, appointmentSchema.salonId))
    .leftJoin(
      technicianSchema,
      and(
        eq(technicianSchema.id, appointmentSchema.technicianId),
        eq(technicianSchema.salonId, appointmentSchema.salonId),
      ),
    )
    .where(and(
      eq(appointmentSchema.id, appointmentId),
      eq(appointmentSchema.salonId, salonId),
    ))
    .limit(1);

  if (!row) {
    return null;
  }

  const [serviceRows, addOnRows] = await Promise.all([
    db
      .select({
        name: appointmentServicesSchema.nameSnapshot,
        priceCents: appointmentServicesSchema.priceAtBooking,
        durationMinutes: appointmentServicesSchema.durationAtBooking,
      })
      .from(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, appointmentId)),
    db
      .select({
        name: appointmentAddOnSchema.nameSnapshot,
        quantity: appointmentAddOnSchema.quantitySnapshot,
        lineTotalCents: appointmentAddOnSchema.lineTotalCentsSnapshot,
      })
      .from(appointmentAddOnSchema)
      .where(eq(appointmentAddOnSchema.appointmentId, appointmentId)),
  ]);

  const settings = (row.salonSettings as SalonSettings | null) ?? null;
  const bookingConfig = resolveBookingConfigFromSettings(settings);

  return {
    appointment: row.appointment,
    salon: {
      id: salonId,
      name: row.salonName,
      slug: row.salonSlug,
      customDomain: row.salonCustomDomain,
      ownerEmail: row.salonOwnerEmail,
      email: row.salonEmail,
      settings,
    },
    technicianName: row.technicianName ?? null,
    services: serviceRows.map(service => ({
      name: service.name || 'Appointment',
      priceCents: service.priceCents,
      durationMinutes: service.durationMinutes,
    })),
    addOns: addOnRows.map(addOn => ({
      name: addOn.name,
      quantity: addOn.quantity,
      lineTotalCents: addOn.lineTotalCents,
    })),
    timeZone: bookingConfig.timezone,
    currency: bookingConfig.currency,
  };
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function formatLongDate(value: string | Date, timeZone: string): string {
  return formatDateInTimeZone(
    value,
    { weekday: 'long', month: 'long', day: 'numeric' },
    timeZone,
  );
}

function formatShortDate(value: string | Date, timeZone: string): string {
  return formatDateInTimeZone(value, { month: 'short', day: 'numeric' }, timeZone);
}

function formatClock(value: string | Date, timeZone: string): string {
  return formatTimeInTimeZone(value, {}, timeZone);
}

function formatTimeZoneLabel(value: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(new Date(value));
  const name = parts.find(part => part.type === 'timeZoneName')?.value;
  return name ? `${timeZone} (${name})` : timeZone;
}

/** Short, human-quotable reference. The full id stays in the dashboard link. */
function formatAppointmentReference(appointmentId: string): string {
  return appointmentId.slice(-8).toUpperCase();
}

function buildDashboardUrl(context: SalonNotificationContext): string | null {
  try {
    const origin = getCanonicalAppOrigin();
    const params = new URLSearchParams({
      salon: context.salon.slug,
      app: 'bookings',
      appointment: context.appointment.id,
    });
    return `${origin}/admin?${params.toString()}`;
  } catch {
    // A missing PUBLIC_APP_URL must degrade the email, never drop it.
    return null;
  }
}

type Line = { label: string; value: string };

function buildScheduleLines(context: SalonNotificationContext): Line[] {
  const { appointment, timeZone } = context;
  return [
    { label: 'Date', value: formatLongDate(appointment.startTime, timeZone) },
    { label: 'Start', value: formatClock(appointment.startTime, timeZone) },
    { label: 'Expected finish', value: formatClock(appointment.endTime, timeZone) },
    { label: 'Timezone', value: formatTimeZoneLabel(appointment.startTime, timeZone) },
  ];
}

function buildClientLines(context: SalonNotificationContext): Line[] {
  const { appointment } = context;
  return [
    { label: 'Name', value: appointment.clientName || 'Guest' },
    { label: 'Phone', value: appointment.clientPhone },
    { label: 'Email', value: appointment.clientEmail || 'Not provided' },
  ];
}

function buildServiceLines(context: SalonNotificationContext): Line[] {
  const { appointment, services, technicianName } = context;
  const lines: Line[] = [
    {
      label: 'Service',
      value: services.length ? services.map(service => service.name).join(', ') : 'Appointment',
    },
    { label: 'Technician', value: technicianName ?? 'Any available artist' },
    { label: 'Duration', value: `${appointment.totalDurationMinutes} min` },
  ];

  if (appointment.bufferMinutes && appointment.bufferMinutes > 0) {
    lines.push({ label: 'Buffer', value: `${appointment.bufferMinutes} min` });
  }

  return lines;
}

function buildAddOnLines(context: SalonNotificationContext): Line[] {
  return context.addOns.map(addOn => ({
    label: addOn.quantity > 1 ? `${addOn.name} ×${addOn.quantity}` : addOn.name,
    value: formatMoney(addOn.lineTotalCents, context.currency),
  }));
}

function resolveDiscountLabel(
  discountType: string | null,
  discountLabel: string | null,
): string {
  if (discountType === SMART_FIT_DISCOUNT_TYPE) {
    return 'Smart Fit discount';
  }
  return discountLabel?.trim() || 'Discount';
}

function resolveExpectedTotalCents(
  appointment: typeof appointmentSchema.$inferSelect,
): number {
  // Tax is only snapshotted at checkout, so booking-time emails normally have
  // none. When it exists and is exclusive, it is part of what the client owes.
  if (
    appointment.taxEnabledSnapshot
    && appointment.taxAmountCents != null
    && !appointment.taxInclusive
  ) {
    return appointment.totalPrice + appointment.taxAmountCents;
  }
  return appointment.totalPrice;
}

function buildPricingLines(context: SalonNotificationContext): Line[] {
  const { appointment, currency, services } = context;
  const lines: Line[] = [];

  const addOnTotal = appointment.addOnsPriceCents
    ?? context.addOns.reduce((sum, addOn) => sum + addOn.lineTotalCents, 0);
  const baseTotal = appointment.basePriceCents
    ?? services.reduce((sum, service) => sum + service.priceCents, 0);

  lines.push({ label: 'Service', value: formatMoney(baseTotal, currency) });

  if (addOnTotal > 0) {
    lines.push({ label: 'Add-ons', value: formatMoney(addOnTotal, currency) });
  }

  const discountAmount = appointment.discountAmountCents ?? 0;
  if (discountAmount > 0) {
    lines.push({
      label: resolveDiscountLabel(appointment.discountType, appointment.discountLabel),
      value: `-${formatMoney(discountAmount, currency)}`,
    });
  }

  if (appointment.taxEnabledSnapshot && appointment.taxAmountCents != null) {
    lines.push({
      label: appointment.taxNameSnapshot || 'Tax',
      value: formatMoney(appointment.taxAmountCents, currency),
    });
  }

  lines.push({
    label: 'Expected total',
    value: formatMoney(resolveExpectedTotalCents(appointment), currency),
  });

  return lines;
}

// =============================================================================
// TEMPLATE
// =============================================================================

type Block =
  | { kind: 'lines'; title: string | null; lines: Line[] }
  | { kind: 'text'; title: string | null; body: string }
  | { kind: 'compare'; title: string; previous: string[]; next: string[] };

export type SalonNotificationEmailPayload = {
  subject: string;
  html: string;
  text: string;
};

function renderTextBlock(block: Block): string {
  if (block.kind === 'lines') {
    return [
      block.title ? `${block.title}:` : null,
      ...block.lines.map(line => `${line.label}: ${line.value}`),
    ].filter(Boolean).join('\n');
  }

  if (block.kind === 'text') {
    return [block.title ? `${block.title}:` : null, block.body]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `${block.title}:`,
    'Previous:',
    ...block.previous,
    'New:',
    ...block.next,
  ].join('\n');
}

function renderHtmlBlock(block: Block): string {
  const title = block.title
    ? `<tr><td style="padding:20px 24px 4px 24px;font:600 12px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a8a8e;">${escapeHtml(block.title)}</td></tr>`
    : '';

  if (block.kind === 'lines') {
    const rows = block.lines.map(line => `
      <tr>
        <td style="padding:3px 24px;font:400 15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b6b70;">${escapeHtml(line.label)}</td>
        <td align="right" style="padding:3px 24px;font:500 15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e;">${escapeHtml(line.value)}</td>
      </tr>`).join('');
    return `${title}${rows}`;
  }

  if (block.kind === 'text') {
    return `${title}<tr><td colspan="2" style="padding:3px 24px;font:400 15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e;">${escapeHtml(block.body)}</td></tr>`;
  }

  const column = (heading: string, values: string[]) => `
    <td width="50%" valign="top" style="padding:12px 16px;background:#f6f6f7;border-radius:12px;">
      <div style="font:600 12px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#8a8a8e;">${escapeHtml(heading)}</div>
      ${values.map(value => `<div style="font:500 15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e;">${escapeHtml(value)}</div>`).join('')}
    </td>`;

  return `${title}
    <tr><td colspan="2" style="padding:4px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;">
        <tr>${column('Previous', block.previous)}${column('New', block.next)}</tr>
      </table>
    </td></tr>`;
}

function renderEmail(args: {
  event: SalonNotificationEventKey;
  subject: string;
  salonName: string;
  headline: string;
  blocks: Block[];
  dashboardUrl: string | null;
}): SalonNotificationEmailPayload {
  const accent = EVENT_ACCENT[args.event];
  const chip = EVENT_LABEL[args.event];

  const button = args.dashboardUrl
    ? `<tr><td colspan="2" style="padding:24px;">
        <a href="${escapeHtml(args.dashboardUrl)}" style="display:block;padding:14px 20px;border-radius:999px;background:#1c1c1e;color:#ffffff;font:600 15px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center;text-decoration:none;">View appointment</a>
      </td></tr>`
    : '';

  const html = `<!-- ${escapeHtml(chip)} -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td colspan="2" style="padding:24px 24px 0 24px;">
        <div style="font:600 13px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#8a8a8e;">${escapeHtml(args.salonName)}</div>
        <div style="display:inline-block;margin-top:10px;padding:5px 12px;border-radius:999px;background:${accent.bg};color:${accent.fg};font:600 12px/1.2 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(chip)}</div>
        <div style="margin-top:12px;font:600 22px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e;">${escapeHtml(args.headline)}</div>
      </td></tr>
      ${args.blocks.map(renderHtmlBlock).join('')}
      ${button}
    </table>
  </td></tr>
</table>`;

  const text = [
    args.salonName,
    chip.toUpperCase(),
    '',
    args.headline,
    '',
    ...args.blocks.map(renderTextBlock),
    args.dashboardUrl ? `\nView appointment: ${args.dashboardUrl}` : '',
  ].filter(part => part !== null).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject: args.subject, html, text };
}

// =============================================================================
// PAYLOAD BUILDERS
// =============================================================================

export function buildSalonNotificationEmailPayload(
  context: SalonNotificationContext,
  input: SendSalonNotificationEmailInput,
): SalonNotificationEmailPayload {
  const { appointment, timeZone, currency } = context;
  const clientName = appointment.clientName || 'Guest';
  const serviceSummary = context.services.length
    ? context.services.map(service => service.name).join(', ')
    : 'Appointment';
  const dashboardUrl = buildDashboardUrl(context);
  const addOnLines = buildAddOnLines(context);
  const reference = formatAppointmentReference(appointment.id);

  const commonTail: Block[] = [
    ...(addOnLines.length
      ? [{ kind: 'lines' as const, title: 'Add-ons', lines: addOnLines }]
      : []),
    { kind: 'lines', title: 'Pricing', lines: buildPricingLines(context) },
    {
      kind: 'text',
      title: 'Client notes',
      body: appointment.notes?.trim() || 'No notes provided',
    },
    {
      kind: 'lines',
      title: 'Reference',
      lines: [
        { label: 'Appointment', value: reference },
        { label: 'Source', value: SOURCE_LABEL[input.source] },
      ],
    },
  ];

  if (input.event === 'newBooking') {
    return renderEmail({
      event: 'newBooking',
      subject: `New booking: ${clientName} — ${serviceSummary} on ${formatShortDate(appointment.startTime, timeZone)} at ${formatClock(appointment.startTime, timeZone)}`,
      salonName: context.salon.name,
      headline: 'New appointment booked',
      dashboardUrl,
      blocks: [
        { kind: 'lines', title: 'Client', lines: buildClientLines(context) },
        { kind: 'lines', title: 'Appointment', lines: [...buildServiceLines(context), ...buildScheduleLines(context)] },
        ...commonTail,
      ],
    });
  }

  if (input.event === 'rescheduled') {
    const previous = input.previous;
    const changeLines: Line[] = [];

    if (previous) {
      if ((previous.technicianName ?? null) !== (context.technicianName ?? null)) {
        changeLines.push({
          label: 'Technician changed',
          value: `${previous.technicianName ?? 'Any available artist'} → ${context.technicianName ?? 'Any available artist'}`,
        });
      }
      if (previous.serviceSummary !== serviceSummary) {
        changeLines.push({
          label: 'Service changed',
          value: `${previous.serviceSummary} → ${serviceSummary}`,
        });
      }
      const previousDiscount = previous.discountAmountCents ?? 0;
      const newDiscount = appointment.discountAmountCents ?? 0;
      if (previousDiscount !== newDiscount || previous.discountLabel !== appointment.discountLabel) {
        changeLines.push({
          label: 'Previous discount',
          value: previousDiscount > 0
            ? `${previous.discountLabel ?? 'Discount'} -${formatMoney(previousDiscount, currency)}`
            : 'None',
        });
        changeLines.push({
          label: 'New discount',
          value: newDiscount > 0
            ? `${resolveDiscountLabel(appointment.discountType, appointment.discountLabel)} -${formatMoney(newDiscount, currency)}`
            : 'None',
        });
        changeLines.push({
          label: 'Previous expected total',
          value: formatMoney(previous.totalPriceCents, currency),
        });
        changeLines.push({
          label: 'New expected total',
          value: formatMoney(resolveExpectedTotalCents(appointment), currency),
        });
      }
    }

    return renderEmail({
      event: 'rescheduled',
      subject: `Appointment rescheduled: ${clientName} — now ${formatShortDate(appointment.startTime, timeZone)} at ${formatClock(appointment.startTime, timeZone)}`,
      salonName: context.salon.name,
      headline: 'Appointment rescheduled',
      dashboardUrl,
      blocks: [
        { kind: 'lines', title: 'Client', lines: buildClientLines(context) },
        ...(previous
          ? [{
              kind: 'compare' as const,
              title: 'Schedule change',
              previous: [
                formatLongDate(previous.startTime, timeZone),
                `${formatClock(previous.startTime, timeZone)}–${formatClock(previous.endTime, timeZone)}`,
              ],
              next: [
                formatLongDate(appointment.startTime, timeZone),
                `${formatClock(appointment.startTime, timeZone)}–${formatClock(appointment.endTime, timeZone)}`,
              ],
            }]
          : []),
        { kind: 'lines', title: 'Appointment', lines: [...buildServiceLines(context), { label: 'Timezone', value: formatTimeZoneLabel(appointment.startTime, timeZone) }] },
        ...(changeLines.length
          ? [{ kind: 'lines' as const, title: 'What changed', lines: changeLines }]
          : []),
        ...commonTail,
      ],
    });
  }

  const cancellationLines: Line[] = [
    { label: 'Cancelled at', value: `${formatLongDate(input.cancellation?.cancelledAt ?? new Date().toISOString(), timeZone)}, ${formatClock(input.cancellation?.cancelledAt ?? new Date().toISOString(), timeZone)}` },
  ];
  const reason = input.cancellation?.reason?.trim();
  if (reason && reason !== 'client_request') {
    cancellationLines.push({ label: 'Reason', value: reason.replaceAll('_', ' ') });
  }

  return renderEmail({
    event: 'cancelled',
    subject: `Appointment cancelled: ${clientName} — ${serviceSummary} on ${formatShortDate(appointment.startTime, timeZone)} at ${formatClock(appointment.startTime, timeZone)}`,
    salonName: context.salon.name,
    headline: 'This appointment is cancelled',
    dashboardUrl,
    blocks: [
      { kind: 'lines', title: 'Client', lines: buildClientLines(context) },
      { kind: 'lines', title: 'Cancelled appointment', lines: [...buildServiceLines(context), ...buildScheduleLines(context)] },
      { kind: 'lines', title: 'Cancellation', lines: [...cancellationLines, { label: 'Source', value: SOURCE_LABEL[input.source] }] },
      ...commonTail,
    ],
  });
}

// =============================================================================
// DELIVERY
// =============================================================================

function logSalonNotification(
  level: 'warn' | 'error',
  message: string,
  meta: Record<string, string | null | undefined>,
): void {
  // Never log client name, phone, email, or notes.
  const line = `[SALON NOTIFICATION] ${message}`;
  if (level === 'warn') {
    console.warn(line, meta);
    return;
  }
  console.error(line, meta);
}

export async function sendSalonNotificationEmail(
  input: SendSalonNotificationEmailInput,
): Promise<SendSalonNotificationEmailResult> {
  const context = await loadSalonNotificationContext(input.salonId, input.appointmentId);
  if (!context) {
    logSalonNotification('warn', 'Appointment not found for notification', {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      event: input.event,
    });
    return { status: 'skipped', reason: 'appointment_not_found' };
  }

  const settings = resolveSalonEmailNotificationSettings(context.salon.settings);
  if (!settings[input.event]) {
    return { status: 'skipped', reason: 'disabled' };
  }

  const dedupeKey = buildSalonNotificationDedupeKey({
    appointmentId: input.appointmentId,
    event: input.event,
    eventVersion: input.previous
      ? buildRescheduleEventVersion({
        previousAppointmentId: input.previous.appointmentId,
        previousStartTime: input.previous.startTime,
        previousEndTime: input.previous.endTime,
        newStartTime: context.appointment.startTime.toISOString(),
        newEndTime: context.appointment.endTime.toISOString(),
      })
      : undefined,
  });

  const recipient = resolveSalonNotificationRecipient({
    recipientEmail: settings.recipientEmail,
    ownerEmail: context.salon.ownerEmail,
    salonEmail: context.salon.email,
  });

  const deliveryId = crypto.randomUUID();

  if (!recipient.email) {
    // The customer action already succeeded. Record the misconfiguration so the
    // owner can be told, and never throw.
    await db.insert(notificationDeliverySchema).values({
      id: deliveryId,
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      channel: 'email',
      purpose: EVENT_PURPOSE[input.event],
      dedupeKey,
      status: 'failed',
      errorCode: 'NO_SALON_NOTIFICATION_RECIPIENT',
      retryable: false,
    }).onConflictDoNothing();
    // The failed delivery row above is the durable record, and Settings →
    // Notifications surfaces it to the owner. Logging every booking for a salon
    // that simply has not configured an address yet would be pure noise.
    return {
      status: 'failed',
      reason: 'NO_SALON_NOTIFICATION_RECIPIENT',
      deliveryId: null,
    };
  }

  // The unique index on dedupe_key is the single idempotency gate: endpoint
  // retries, queue retries, and webhook replays all collide here.
  const inserted = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    channel: 'email',
    purpose: EVENT_PURPOSE[input.event],
    dedupeKey,
    status: 'queued',
  }).onConflictDoNothing().returning();

  if (!inserted.length) {
    return { status: 'duplicate' };
  }

  const payload = buildSalonNotificationEmailPayload(context, input);
  const result = await sendTransactionalEmailDetailed({
    to: recipient.email,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });

  await db.update(notificationDeliverySchema).set({
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    retryable: !result.ok,
  }).where(and(
    eq(notificationDeliverySchema.id, deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
  ));

  if (!result.ok) {
    await db.insert(integrationOutboxSchema).values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'retry_salon_notification',
      dedupeKey: `${dedupeKey}:retry`,
      payload: {
        deliveryId,
        event: input.event,
        source: input.source,
        previous: input.previous ?? null,
        cancellation: input.cancellation ?? null,
      },
    }).onConflictDoNothing();
    logSalonNotification('error', 'Salon notification email failed, queued for retry', {
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      event: input.event,
      errorCode: result.errorCode,
    });
    return { status: 'failed', reason: result.errorCode ?? 'UNKNOWN', deliveryId };
  }

  return { status: 'sent', deliveryId };
}

/**
 * Outbox retry. Re-renders from live data and re-sends against the *same*
 * delivery row, so a retry can never produce a second notification.
 */
export async function retrySalonNotificationEmail(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
  event: SalonNotificationEventKey;
  source: SalonNotificationSource;
  previous?: SalonNotificationPreviousSchedule;
  cancellation?: SalonNotificationCancellation;
}): Promise<void> {
  const context = await loadSalonNotificationContext(input.salonId, input.appointmentId);
  if (!context) {
    throw new Error('SALON_NOTIFICATION_APPOINTMENT_MISSING');
  }

  const settings = resolveSalonEmailNotificationSettings(context.salon.settings);
  const recipient = resolveSalonNotificationRecipient({
    recipientEmail: settings.recipientEmail,
    ownerEmail: context.salon.ownerEmail,
    salonEmail: context.salon.email,
  });

  if (!recipient.email) {
    throw new Error('NO_SALON_NOTIFICATION_RECIPIENT');
  }

  const payload = buildSalonNotificationEmailPayload(context, {
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    event: input.event,
    source: input.source,
    previous: input.previous,
    cancellation: input.cancellation,
  });

  const result = await sendTransactionalEmailDetailed({
    to: recipient.email,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });

  await db.update(notificationDeliverySchema).set({
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    retryable: !result.ok,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
  ));

  if (!result.ok) {
    throw new Error(result.errorCode || 'SALON_NOTIFICATION_RETRY_FAILED');
  }
}
