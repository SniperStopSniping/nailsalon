/**
 * Redaction Security Tests
 *
 * These tests verify that staff-facing redaction functions correctly
 * omit forbidden fields and respect visibility settings.
 */

import { describe, expect, it } from 'vitest';

import type { ResolvedStaffVisibility } from '@/types/salonPolicy';

import {
  redactAppointmentForStaff,
  redactClientForStaff,
  STAFF_FORBIDDEN_FIELDS,
} from './redact';

// =============================================================================
// TEST DATA
// =============================================================================

const fullVisibility: ResolvedStaffVisibility = {
  showClientPhone: true,
  showClientEmail: true,
  showClientFullName: true,
  showAppointmentPrice: true,
  showClientHistory: true,
  showClientNotes: true,
  showOtherTechAppointments: true,
};

const restrictedVisibility: ResolvedStaffVisibility = {
  showClientPhone: false,
  showClientEmail: false,
  showClientFullName: false,
  showAppointmentPrice: false,
  showClientHistory: false,
  showClientNotes: false,
  showOtherTechAppointments: false,
};

const baseAppointment = {
  id: 'appt-1',
  startTime: '2024-01-01T10:00:00Z',
  endTime: '2024-01-01T11:00:00Z',
  status: 'confirmed',
  technicianId: 'tech-1',
  clientName: 'Jane Doe',
  clientPhone: '+1234567890',
  totalPrice: 100,
  services: [{ name: 'Manicure' }],
  photos: [{ id: 'photo-1', imageUrl: 'https://example.com/photo.jpg', photoType: 'before' }],
};

const baseClient = {
  id: 'client-1',
  phone: '+1234567890',
  fullName: 'Jane Doe',
  name: 'Jane',
  email: 'jane@example.com',
  notes: 'VIP client',
  totalVisits: 10,
  totalSpent: 1000,
  lastVisitAt: '2024-01-01T10:00:00Z',
  memberSince: '2023-01-01',
};

// =============================================================================
// APPOINTMENT REDACTION TESTS
// =============================================================================

describe('redactAppointmentForStaff', () => {
  describe('core fields (always present)', () => {
    it('always includes id, startTime, endTime, status, technicianId', () => {
      const result = redactAppointmentForStaff(baseAppointment, restrictedVisibility);

      expect(result.id).toBe('appt-1');
      expect(result.startTime).toBe('2024-01-01T10:00:00Z');
      expect(result.endTime).toBe('2024-01-01T11:00:00Z');
      expect(result.status).toBe('confirmed');
      expect(result.technicianId).toBe('tech-1');
    });

    it('includes services if present', () => {
      const result = redactAppointmentForStaff(baseAppointment, restrictedVisibility);

      expect(result.services).toEqual([{ name: 'Manicure' }]);
    });

    it('includes photos if present', () => {
      const result = redactAppointmentForStaff(baseAppointment, restrictedVisibility);

      expect(result.photos).toEqual([
        { id: 'photo-1', imageUrl: 'https://example.com/photo.jpg', photoType: 'before' },
      ]);
    });
  });

  describe('visibility-controlled fields', () => {
    it('includes clientPhone when showClientPhone is true', () => {
      const result = redactAppointmentForStaff(baseAppointment, {
        ...restrictedVisibility,
        showClientPhone: true,
      });

      expect(result.clientPhone).toBe('+1234567890');
    });

    it('excludes clientPhone when showClientPhone is false', () => {
      const result = redactAppointmentForStaff(baseAppointment, restrictedVisibility);

      expect(result).not.toHaveProperty('clientPhone');
    });

    it('includes clientName when showClientFullName is true', () => {
      const result = redactAppointmentForStaff(baseAppointment, {
        ...restrictedVisibility,
        showClientFullName: true,
      });

      expect(result.clientName).toBe('Jane Doe');
    });

    it('excludes clientName when showClientFullName is false', () => {
      const result = redactAppointmentForStaff(baseAppointment, restrictedVisibility);

      expect(result).not.toHaveProperty('clientName');
    });

    it('includes totalPrice when showAppointmentPrice is true', () => {
      const result = redactAppointmentForStaff(baseAppointment, {
        ...restrictedVisibility,
        showAppointmentPrice: true,
      });

      expect(result.totalPrice).toBe(100);
    });

    it('excludes totalPrice when showAppointmentPrice is false', () => {
      const result = redactAppointmentForStaff(baseAppointment, restrictedVisibility);

      expect(result).not.toHaveProperty('totalPrice');
    });
  });

  describe('with full visibility', () => {
    it('includes all visibility-controlled fields', () => {
      const result = redactAppointmentForStaff(baseAppointment, fullVisibility);

      expect(result.clientPhone).toBe('+1234567890');
      expect(result.clientName).toBe('Jane Doe');
      expect(result.totalPrice).toBe(100);
    });
  });
});

// =============================================================================
// CLIENT REDACTION TESTS
// =============================================================================

describe('redactClientForStaff', () => {
  describe('core fields (always present)', () => {
    it('always includes id', () => {
      const result = redactClientForStaff(baseClient, restrictedVisibility);

      expect(result.id).toBe('client-1');
    });
  });

  describe('visibility-controlled fields', () => {
    it('includes phone when showClientPhone is true', () => {
      const result = redactClientForStaff(baseClient, {
        ...restrictedVisibility,
        showClientPhone: true,
      });

      expect(result.phone).toBe('+1234567890');
    });

    it('excludes phone when showClientPhone is false', () => {
      const result = redactClientForStaff(baseClient, restrictedVisibility);

      expect(result).not.toHaveProperty('phone');
    });

    it('includes fullName and name when showClientFullName is true', () => {
      const result = redactClientForStaff(baseClient, {
        ...restrictedVisibility,
        showClientFullName: true,
      });

      expect(result.fullName).toBe('Jane Doe');
      expect(result.name).toBe('Jane');
    });

    it('excludes fullName and name when showClientFullName is false', () => {
      const result = redactClientForStaff(baseClient, restrictedVisibility);

      expect(result).not.toHaveProperty('fullName');
      expect(result).not.toHaveProperty('name');
    });

    it('includes email when showClientEmail is true', () => {
      const result = redactClientForStaff(baseClient, {
        ...restrictedVisibility,
        showClientEmail: true,
      });

      expect(result.email).toBe('jane@example.com');
    });

    it('excludes email when showClientEmail is false', () => {
      const result = redactClientForStaff(baseClient, restrictedVisibility);

      expect(result).not.toHaveProperty('email');
    });

    it('includes notes when showClientNotes is true', () => {
      const result = redactClientForStaff(baseClient, {
        ...restrictedVisibility,
        showClientNotes: true,
      });

      expect(result.notes).toBe('VIP client');
    });

    it('excludes notes when showClientNotes is false', () => {
      const result = redactClientForStaff(baseClient, restrictedVisibility);

      expect(result).not.toHaveProperty('notes');
    });

    it('includes history fields when showClientHistory is true', () => {
      const result = redactClientForStaff(baseClient, {
        ...restrictedVisibility,
        showClientHistory: true,
      });

      expect(result.totalVisits).toBe(10);
      expect(result.totalSpent).toBe(1000);
      expect(result.lastVisitAt).toBe('2024-01-01T10:00:00Z');
      expect(result.memberSince).toBe('2023-01-01');
    });

    it('excludes history fields when showClientHistory is false', () => {
      const result = redactClientForStaff(baseClient, restrictedVisibility);

      expect(result).not.toHaveProperty('totalVisits');
      expect(result).not.toHaveProperty('totalSpent');
      expect(result).not.toHaveProperty('lastVisitAt');
      expect(result).not.toHaveProperty('memberSince');
    });
  });

  describe('with full visibility', () => {
    it('includes all visibility-controlled fields', () => {
      const result = redactClientForStaff(baseClient, fullVisibility);

      expect(result.phone).toBe('+1234567890');
      expect(result.fullName).toBe('Jane Doe');
      expect(result.name).toBe('Jane');
      expect(result.email).toBe('jane@example.com');
      expect(result.notes).toBe('VIP client');
      expect(result.totalVisits).toBe(10);
      expect(result.totalSpent).toBe(1000);
    });
  });
});

// =============================================================================
// FORBIDDEN FIELDS DOCUMENTATION TEST
// =============================================================================

describe('STAFF_FORBIDDEN_FIELDS', () => {
  it('includes all sensitive fields that must never be exposed to staff', () => {
    // This test documents the forbidden fields and will fail if the list changes
    expect(STAFF_FORBIDDEN_FIELDS).toEqual([
      'cancelReason',
      'internalNotes',
      'paymentStatus',
      'metadata',
      'source',
      'referralId',
      'profit',
      'margin',
      'cost',
      'commissionRate',
      'payoutDetails',
    ]);
  });

  it('contains at least the critical financial and internal fields', () => {
    expect(STAFF_FORBIDDEN_FIELDS).toContain('cancelReason');
    expect(STAFF_FORBIDDEN_FIELDS).toContain('internalNotes');
    expect(STAFF_FORBIDDEN_FIELDS).toContain('paymentStatus');
    expect(STAFF_FORBIDDEN_FIELDS).toContain('metadata');
    expect(STAFF_FORBIDDEN_FIELDS).toContain('profit');
    expect(STAFF_FORBIDDEN_FIELDS).toContain('margin');
    expect(STAFF_FORBIDDEN_FIELDS).toContain('cost');
  });
});

// =============================================================================
// DEEP-SCAN TEST: Forbidden keys never appear at any depth
// =============================================================================

/**
 * Recursively collect all keys from an object/array at any depth.
 * Used to verify no forbidden keys leak through nested structures.
 */
function deepKeys(obj: unknown, out: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') {
    return out;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepKeys(item, out);
    }
    return out;
  }

  for (const [k, v] of Object.entries(obj)) {
    out.push(k);
    deepKeys(v, out);
  }
  return out;
}

describe('Deep-scan forbidden field verification', () => {
  it('redactAppointmentForStaff never returns forbidden keys at any depth', () => {
    // Create appointment with ALL forbidden fields present (simulating a leak)
    const appointmentWithForbidden = {
      ...baseAppointment,
      // Top-level forbidden fields
      cancelReason: 'no_show',
      internalNotes: 'admin only note',
      paymentStatus: 'paid',
      metadata: { foo: 'bar', payoutDetails: { bank: 'x' } },
      source: 'referral',
      referralId: 'ref-1',
      profit: 50,
      margin: 0.5,
      cost: 50,
      commissionRate: 0.4,
      payoutDetails: { account: '123' },
      // Nested structure that might contain forbidden fields
      nested: {
        internalNotes: 'should not appear',
        metadata: { secret: 'value' },
      },
    };

    // Cast to any since our type intentionally doesn't include forbidden fields
    const result = redactAppointmentForStaff(
      appointmentWithForbidden as Parameters<typeof redactAppointmentForStaff>[0],
      fullVisibility,
    );

    // Collect all keys at any depth
    const allKeys = new Set(deepKeys(result));

    // Verify no forbidden key appears anywhere in the output
    for (const forbidden of STAFF_FORBIDDEN_FIELDS) {
      expect(allKeys.has(forbidden)).toBe(false);
    }
  });

  it('redactClientForStaff never returns forbidden keys at any depth', () => {
    // Create client with potential forbidden fields
    const clientWithForbidden = {
      ...baseClient,
      // Client shouldn't have these, but test defense-in-depth
      profit: 100,
      margin: 0.3,
      commissionRate: 0.5,
      metadata: { internal: 'data' },
    };

    const result = redactClientForStaff(
      clientWithForbidden as Parameters<typeof redactClientForStaff>[0],
      fullVisibility,
    );

    const allKeys = new Set(deepKeys(result));

    for (const forbidden of STAFF_FORBIDDEN_FIELDS) {
      expect(allKeys.has(forbidden)).toBe(false);
    }
  });

  it('whitelist approach guarantees only allowed fields appear', () => {
    // This test verifies the whitelist approach works correctly
    // by checking that ONLY known safe fields appear in output
    const result = redactAppointmentForStaff(baseAppointment, fullVisibility);
    const resultKeys = Object.keys(result);

    const allowedAppointmentFields = [
      'id',
      'startTime',
      'endTime',
      'status',
      'technicianId',
      'services',
      'photos',
      'clientName',
      'clientPhone',
      'totalPrice',
    ];

    for (const key of resultKeys) {
      expect(allowedAppointmentFields).toContain(key);
    }
  });
});
