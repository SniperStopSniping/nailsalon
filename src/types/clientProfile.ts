export type ClientNextVisitOffer =
  | { state: 'none' | 'unavailable' }
  | {
    state: 'available';
    discountType: 'percent' | 'fixed';
    discountValue: number;
    currency: string;
    expiresOn: string;
    expiresAt: string;
    sourceAppointmentId: string;
  };
