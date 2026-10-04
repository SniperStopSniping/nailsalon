import 'server-only';

import { enqueueCommunicationIntent } from '@/libs/communicationIntent';

export async function queueSalonInviteSms(input: { salonId: string; inviteId: string; recipient: string; message: string; revision: string }) {
  const now = new Date();
  return enqueueCommunicationIntent({
    salonId: input.salonId,
    eventType: 'salon_invite',
    channel: 'sms',
    audience: 'owner',
    dedupeKey: `salon-invite:${input.salonId}:${input.inviteId}:${input.revision}`,
    recipient: input.recipient,
    destinationCountry: 'CA',
    templateKey: 'salon_invite',
    templateVersion: 'v1',
    variables: { inviteId: input.inviteId, message: input.message },
    schedulingRevision: input.revision,
    scheduledFor: now,
    notAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
}
