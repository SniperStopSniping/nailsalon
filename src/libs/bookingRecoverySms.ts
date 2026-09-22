import 'server-only';

import { eq } from 'drizzle-orm';

import { resolveAppointmentOperationalPhoneRecipient, resolveOperationalSalonClientContact } from '@/libs/clientLifecycleStabilization';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { computeSchedulingRevision } from '@/libs/communicationScheduling';
import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';

const RECOVERY_DEDUPE_BUCKET_MS = 10 * 60_000;

type RecoveryAppointment = { id: string };

/**
 * Queue recovery texts only for the resolved terminal client's current phone.
 * The dispatcher performs consent, STOP/suppression, sender, rate-limit, and
 * final current-recipient checks immediately before the provider boundary.
 */
export async function queueBookingRecoverySms(input: {
  salonId: string;
  terminalClientId?: string;
  recipientPhone?: string;
  appointments: RecoveryAppointment[];
  now?: Date;
}): Promise<{ queued: boolean }> {
  const now = input.now ?? new Date();
  const [salon] = await db.select({ settings: salonSchema.settings, smsRemindersEnabled: salonSchema.smsRemindersEnabled })
    .from(salonSchema).where(eq(salonSchema.id, input.salonId)).limit(1);
  if (!salon) {
    return { queued: false };
  }
  const settings = resolveCommunicationSettingsFromSettings(salon.settings);
  const client = input.terminalClientId
    ? await resolveOperationalSalonClientContact({
      salonId: input.salonId,
      clientId: input.terminalClientId,
      allowArchived: true,
    })
    : null;
  const recipient = client?.phone ?? input.recipientPhone;
  if (!recipient) {
    return { queued: false };
  }
  const bucket = now.getTime() - (now.getTime() % RECOVERY_DEDUPE_BUCKET_MS);
  const notAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const schedulingRevision = computeSchedulingRevision({
    timeZone: salon.settings?.booking?.timezone,
    quietHours: settings.quietHours,
    appointmentStart: null,
    appointmentUpdatedAt: null,
    smsEnabled: settings.sms.enabled,
    emailEnabled: settings.email.enabled,
  });
  let queued = false;
  for (const appointment of input.appointments) {
    const current = await resolveAppointmentOperationalPhoneRecipient({ salonId: input.salonId, appointmentId: appointment.id });
    const validCanonical = client !== null
      && current.status === 'terminal_current'
      && current.terminalClientId === client.id
      && current.phone === recipient;
    const validOrphan = client === null
      && current.status === 'appointment_snapshot'
      && current.phone === recipient;
    if (!validCanonical && !validOrphan) {
      continue;
    }
    const result = await enqueueCommunicationIntent({
      salonId: input.salonId,
      appointmentId: appointment.id,
      channel: 'sms',
      eventType: 'booking_recovery',
      audience: 'client',
      dedupeKey: `sms:booking-recovery:${input.salonId}:${appointment.id}:${bucket}`,
      recipient,
      destinationCountry: 'CA',
      templateKey: 'client_booking_recovery_shortlink',
      templateVersion: 'v1',
      // The dispatcher replaces this non-capability placeholder with a fresh
      // short capability only after its final delivery gates pass.
      variables: { ...(client ? { clientId: client.id } : {}), manageUrl: 'pending' },
      schedulingRevision,
      scheduledFor: now,
      notAfter,
    });
    queued ||= result.created;
  }
  return { queued };
}
