// Synthetic data only. Browser fixtures never connect to a database or provider.
const query = new URLSearchParams(window.location.search);
const status = query.get('status') ?? 'confirmed';
const long = query.has('long');
const startTime = new Date(query.has('closed') ? '2026-01-01T15:00:00Z' : '2099-10-12T15:00:00Z');
const salon = {
  id: 'fixture-salon',
  slug: 'fixture',
  name: 'Isla Nail Studio',
  phone: '+14165550100',
  settings: { booking: { timezone: 'America/Toronto', clientChangeCutoffHours: 24 } },
};
export const requirePublishedTenantSalon = async () => salon;
export const getSalonById = async () => salon;
export const verifyAppointmentAccessToken = async () => query.has('invalid')
  ? null
  : ({
      salonId: salon.id,
      salonSlug: salon.slug,
      salonName: salon.name,
      salonPhone: salon.phone,
      salonSettings: salon.settings,
      appointment: {
        id: 'fixture-appointment',
        salonId: salon.id,
        technicianId: 'fixture-tech',
        locationId: null,
        clientName: long ? 'Alexandria Verylongname' : 'Alex',
        status,
        startTime,
        endTime: new Date(startTime.getTime() + 35 * 60_000),
        totalPrice: 3500,
        totalDurationMinutes: 35,
        invoiceCurrency: 'CAD',
        discountAmountCents: 0,
      },
    });
export const describeAppointmentAccessFailure = async () => query.get('invalid') || 'expired';
const rows = [
  [{ name: long ? 'Russian Manicure with Structured Builder Gel and a Detailed Chrome Finish' : 'Russian Manicure' }],
  [],
  [{ name: 'Daniela' }],
  [{ amountCents: 1000, currency: 'CAD', checkoutUrl: 'https://checkout.stripe.com/c/pay/synthetic-fixture' }],
];
export const db = { select: () => ({ from: () => ({ where: () => {
  const value = rows.shift() ?? [];
  return Object.assign(Promise.resolve(value), { limit: async () => value });
} }) }) };
export const loadBookingEmailFinancialSummary = async () => query.has('financial-error')
  ? null
  : ({
      currency: 'CAD',
      serviceInvoiceTotalCents: 3500,
      totalDueCents: 3500,
      collectedDepositCents: 0,
      refundedDepositCents: 0,
      depositCreditAppliedCents: 0,
      appointmentPaymentsCents: 0,
      amountAlreadyPaidCents: 0,
      balanceCents: 3500,
      depositPresentationState: 'none',
    });
export const getLocationById = async () => ({ name: 'Primary location', address: '880 Ellesmere Rd, Unit 2', city: 'Toronto', state: 'ON', zipCode: '' });
export const getPrimaryLocation = getLocationById;
export const getRetentionSettingsForSalon = async () => ({ parkingInstructions: 'Inside TB Nails' });
export const Inter = () => ({ variable: '' });
export const Newsreader = () => ({ variable: '' });
