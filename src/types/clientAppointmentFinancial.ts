export type ClientAppointmentFinancialPresentation
  = | {
    state: 'resolved';
    currency: 'CAD' | 'USD';
    taxClassification: 'estimate';
    taxAmountCents: number | null;
    taxLabel: string | null;
    taxMode: 'added' | 'included' | null;
    taxApplied: boolean | null;
    totalCents: number;
    collectedDepositCents: number;
    refundedDepositCents: number;
    depositCreditCents: number;
    amountAlreadyPaidCents: number;
    balanceCents: number;
  }
  | { state: 'under_review' };
