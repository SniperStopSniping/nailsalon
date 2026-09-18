import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getSalonBySlug: vi.fn(),
  guardSalonApiRoute: vi.fn(),
  guardFeatureEntitlement: vi.fn(),
  requireStaffSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireClientApiSession: vi.fn(),
  readCustomerBookingOperation: vi.fn(),
  normalizePhone: vi.fn(),
  getBookingConfigForSalon: vi.fn(),
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug: mocks.getSalonBySlug,
  normalizePhone: mocks.normalizePhone,
}));
vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute: mocks.guardSalonApiRoute,
  guardFeatureEntitlement: mocks.guardFeatureEntitlement,
}));
vi.mock('@/libs/staffAuth', () => ({ requireStaffSession: mocks.requireStaffSession }));
vi.mock('@/libs/adminAuth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/libs/clientApiGuards', () => ({ requireClientApiSession: mocks.requireClientApiSession }));
vi.mock('@/libs/bookingConfig', () => ({ getBookingConfigForSalon: mocks.getBookingConfigForSalon }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({
  CustomerBookingOperationError: class CustomerBookingOperationError extends Error {},
  readCustomerBookingOperation: mocks.readCustomerBookingOperation,
  lockCustomerBookingOperation: vi.fn(),
  linkCustomerBookingOperation: vi.fn(),
}));

const { createAppointmentFromRequest } = await import('./appointmentCreation.server');

const access = {
  kind: 'anonymous_customer' as const,
  salon: { id: 'salon_customer_assistant', slug: 'isla-nail-studio' },
  contact: { name: 'Synthetic Customer', email: 'customer@example.test', phone: '4165550101' },
  operation: { capability: 'capability', revision: 1, fingerprint: 'f'.repeat(64), secret: 's'.repeat(32) },
};

function request(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      salonSlug: access.salon.slug,
      baseServiceId: 'service_customer_assistant',
      selectedAddOns: [],
      technicianId: null,
      startTime: '2026-10-01T15:00:00.000Z',
      expectedTotalCents: 5000,
      expectedDiscountType: null,
      expectedBookingFinancialQuote: { currency: 'CAD', totalDueCents: 5000, taxConfigurationIdentity: 'synthetic-tax-identity' },
      expectedDepositFingerprint: 'deposit-v1:none',
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSalonBySlug.mockResolvedValue({
    id: access.salon.id,
    slug: access.salon.slug,
    freeSoloEnabled: false,
  });
  mocks.guardSalonApiRoute.mockResolvedValue(new Response(null, { status: 503 }));
  mocks.normalizePhone.mockImplementation((phone: string) => phone.replace(/\D/g, '').replace(/^1/, ''));
  mocks.getBookingConfigForSalon.mockResolvedValue({ timezone: 'America/Toronto' });
  mocks.readCustomerBookingOperation.mockResolvedValue({
    appointmentId: null,
    material: {
      selection: { baseServiceId: 'service_customer_assistant', selectedAddOns: [] },
      startTime: '2026-10-01T15:00:00.000Z',
      smsConsent: undefined,
      expectedTotalCents: 5000,
      expectedDiscountType: null,
      expectedBookingFinancialQuote: { currency: 'CAD', totalDueCents: 5000, taxConfigurationIdentity: 'synthetic-tax-identity' },
      expectedDepositFingerprint: 'deposit-v1:none',
    },
  });
});

describe('createAppointmentFromRequest anonymous customer access', () => {
  it('rejects assistant-forbidden authority fields before any ambient authentication', async () => {
    const response = await createAppointmentFromRequest(request({ bookingSubject: 'self' }), access);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ANONYMOUS_CUSTOMER_ACCESS_INVALID' } });
    expect(mocks.getSalonBySlug).not.toHaveBeenCalled();
    expect(mocks.requireStaffSession).not.toHaveBeenCalled();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.requireClientApiSession).not.toHaveBeenCalled();
  });

  it('requires the route-resolved salon identity to match the trusted access', async () => {
    mocks.getSalonBySlug.mockResolvedValue({
      id: 'other-salon',
      slug: access.salon.slug,
      freeSoloEnabled: false,
    });

    const response = await createAppointmentFromRequest(request(), access);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ANONYMOUS_CUSTOMER_ACCESS_INVALID' } });
    expect(mocks.guardSalonApiRoute).not.toHaveBeenCalled();
    expect(mocks.requireStaffSession).not.toHaveBeenCalled();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.requireClientApiSession).not.toHaveBeenCalled();
  });

  it('does not evaluate ambient staff, admin, or client authentication for trusted anonymous access', async () => {
    const response = await createAppointmentFromRequest(request({
      clientName: 'Untrusted Body Name',
      clientEmail: 'body@example.test',
      clientPhone: '4165550199',
    }), access);

    expect(response.status).toBe(503);
    expect(mocks.guardSalonApiRoute).toHaveBeenCalledWith(access.salon.id);
    expect(mocks.requireStaffSession).not.toHaveBeenCalled();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.requireClientApiSession).not.toHaveBeenCalled();
  });

  it('passes the ambient-auth boundary before rejecting an invalid normalized phone', async () => {
    mocks.guardSalonApiRoute.mockResolvedValue(null);
    mocks.guardFeatureEntitlement.mockResolvedValue(null);
    mocks.normalizePhone
      .mockImplementationOnce(() => access.contact.phone)
      .mockImplementationOnce(() => '');

    const response = await createAppointmentFromRequest(request(), access);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_PHONE' } });
    expect(mocks.requireStaffSession).not.toHaveBeenCalled();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.requireClientApiSession).not.toHaveBeenCalled();
  });
});
