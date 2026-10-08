const nextVisit = new Date();
nextVisit.setDate(nextVisit.getDate() + 3);
nextVisit.setHours(11, 0, 0, 0);
const nextVisitStart = nextVisit.toISOString();
const nextVisitEnd = new Date(nextVisit.getTime() + 60 * 60 * 1000).toISOString();

// Synthetic review data; no real client information.
type Scenario = 'default' | 'empty' | 'empty-profile' | 'no-offer';

const longName = 'Sofia Martin';

export function clientList(scenario: Scenario) {
  if (scenario === 'empty') {
    return { data: { clients: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } } };
  }
  return {
    data: {
      clients: [{
        id: 'client_browser',
        fullName: longName,
        phone: '4165550101',
        email: 'sofia.fixture@example.com',
        preferredTechnician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        lastVisitAt: '2026-09-01T14:00:00.000Z',
        totalVisits: 6,
        totalSpent: 45500,
        spendCurrency: 'CAD',
        spendState: 'canonical_settled',
        noShowCount: 0,
        loyaltyPoints: 820,
        notes: 'Prefers quiet appointments and short almond nails.',
        createdAt: '2025-01-01T00:00:00.000Z',
      }],
      pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
    },
  };
}

export function clientDetail(noUpcoming = false) {
  return {
    data: {
      client: {
        id: 'client_browser',
        fullName: longName,
        phone: '4165550101',
        email: 'sofia.fixture@example.com',
        birthday: null,
        preferredTechnician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        notes: 'Prefers quiet appointments and short almond nails.',
        sensitivities: 'HEMA sensitivity',
        nailPreferences: { shape: 'Almond', length: 'Short', favoriteColors: 'Neutral pink', productsUsed: 'Builder gel' },
        tags: ['VIP'],
        rebookIntervalDays: 21,
        nextRebookDueAt: '2026-09-22T14:00:00.000Z',
        lastVisitAt: '2026-09-01T14:00:00.000Z',
        totalVisits: 6,
        totalSpent: 45500,
        averageSpend: 7583,
        noShowCount: 0,
        loyaltyPoints: 820,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
      upcomingAppointments: noUpcoming ? [] : [{ id: 'appt_upcoming', startTime: nextVisitStart, endTime: nextVisitEnd, status: 'confirmed', totalPrice: 9500, currency: 'CAD', technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null }, services: [{ id: 'svc_1', name: 'Structured Builder Gel', price: 9500 }], notes: null }],
      pastAppointments: [{ id: 'appt_completed', startTime: '2026-09-01T15:00:00.000Z', endTime: '2026-09-01T16:00:00.000Z', status: 'completed', totalPrice: 8200, currency: 'CAD', technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null }, services: [{ id: 'svc_1', name: 'Structured Builder Gel', price: 8200 }], addOns: [], financial: { completedValueCents: 8200, paymentsReceivedCents: 8200, balanceCents: 0, financialState: 'resolved' }, notes: null }],
      recentIssues: [],
      photos: [],
      summary: { currency: 'CAD', timeZone: 'America/Toronto', lifetimeSpendCents: 45500, spendThisMonthCents: 8200, completedOutstandingCents: 0, financialState: 'resolved', completedVisits: 6, mostBookedService: { id: 'svc_1', name: 'Structured Builder Gel', count: 3 }, rebooking: { status: 'due_soon', dueAt: '2026-09-22T14:00:00.000Z' }, provenance: { lifetimeSpend: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false }, spendThisMonth: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false }, completedOutstanding: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false } } },
      submittedPreferences: { favoriteTechnician: { id: 'tech_1', name: 'Daniela', avatarUrl: null }, favoriteServices: ['svc_1'], nailShape: 'almond', nailLength: 'short', finishes: ['glossy'], colorFamilies: ['nude'], preferredBrands: ['Luster Gel'], sensitivities: ['HEMA-free'], musicPreference: 'quiet', conversationLevel: 'quiet', beveragePreference: ['tea'], techNotes: null, appointmentNotes: null, updatedAt: '2026-09-01T00:00:00.000Z' },
    },
  };
}

export function emptyClientDetail() {
  const detail = structuredClone(clientDetail(true)) as {
    data: {
      client: Record<string, unknown>;
      upcomingAppointments: unknown[];
      pastAppointments: unknown[];
      photos: unknown[];
      submittedPreferences: unknown;
      summary: Record<string, unknown>;
    };
  };
  detail.data.client = {
    ...detail.data.client,
    notes: '',
    sensitivities: '',
    nailPreferences: null,
    tags: [],
    preferredTechnician: null,
    rebookIntervalDays: null,
    nextRebookDueAt: null,
    lastVisitAt: null,
    totalVisits: 0,
    totalSpent: 0,
    averageSpend: 0,
    loyaltyPoints: 0,
  };
  detail.data.pastAppointments = [];
  detail.data.photos = [];
  detail.data.submittedPreferences = null;
  detail.data.summary = {
    ...detail.data.summary,
    completedVisits: 0,
    lifetimeSpendCents: 0,
    spendThisMonthCents: 0,
    mostBookedService: null,
    rebooking: { status: 'not_due', dueAt: null },
  };
  return detail;
}

export function managedAppointment() {
  return { data: { appointment: { id: 'appt_upcoming', salonId: 'salon_browser_fixture', salonSlug: 'isla-browser', clientName: longName, clientPhone: '4165550101', clientEmail: 'sofia.fixture@example.com', technicianId: 'tech_1', locationId: null, locationName: null, status: 'confirmed', startTime: nextVisitStart, endTime: nextVisitEnd, totalPrice: 9500, totalDurationMinutes: 60, bufferMinutes: 0, slotIntervalMinutes: 15, isLocked: false, lockedAt: null, paymentStatus: 'pending', baseServiceId: 'svc_1', baseServiceName: 'Structured Builder Gel', discountType: null, discountAmountCents: 0, notes: null, techNotes: null }, services: [], addOns: [], serviceOptions: [{ id: 'svc_1', name: 'Structured Builder Gel', category: 'manicure', priceCents: 9500, durationMinutes: 60 }], technicianOptions: [{ id: 'tech_1', name: 'Daniela' }], permissions: { canMove: true, canChangeService: true, canCancel: true, canMarkCompleted: true, canStart: true, canConfirm: false, canMarkNoShow: true, canReassignTechnician: true }, warnings: [], communications: [] } };
}
