import 'server-only';

import { getAvailableNextVisitOfferForSourceAppointment, getLatestNextVisitOfferForClient } from '@/libs/nextVisitOffer.server';
import type { ClientNextVisitOffer } from '@/types/clientProfile';

/** Read-only promotion visibility; never issues an offer or mints a campaign. */
export async function getClientProfileNextVisitOffer(
  handle: Parameters<typeof getLatestNextVisitOfferForClient>[0],
  salonId: string,
  clientId: string,
  now: Date,
): Promise<ClientNextVisitOffer> {
  try {
    const candidate = await getLatestNextVisitOfferForClient(handle, salonId, clientId);
    if (!candidate || candidate.salonId !== salonId) {
      return { state: 'none' };
    }
    const offer = await getAvailableNextVisitOfferForSourceAppointment(handle, {
      salonId,
      sourceAppointmentId: candidate.sourceAppointmentId,
      now,
    });
    if (!offer || offer.id !== candidate.id || offer.salonId !== salonId) {
      return { state: 'none' };
    }
    return {
      state: 'available',
      discountType: offer.settingsSnapshot.discountType,
      discountValue: offer.settingsSnapshot.value,
      currency: offer.currency,
      expiresOn: offer.deadlineDate,
      expiresAt: offer.expiresAt.toISOString(),
      sourceAppointmentId: offer.sourceAppointmentId,
    };
  } catch {
    // A failed optional read is unknown, never proof that the client has no offer.
    return { state: 'unavailable' };
  }
}
