import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  parseAdminImpersonationSession,
  serializeAdminImpersonationSession,
} from './adminImpersonation';

describe('adminImpersonation session signing', () => {
  const originalSecret = process.env.SUPER_ADMIN_IMPERSONATION_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SUPER_ADMIN_IMPERSONATION_SECRET;
    } else {
      process.env.SUPER_ADMIN_IMPERSONATION_SECRET = originalSecret;
    }
  });

  it('round-trips a valid impersonation session', () => {
    process.env.SUPER_ADMIN_IMPERSONATION_SECRET = 'test-impersonation-secret';

    const session = {
      salonId: 'salon_1',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    };

    const encoded = serializeAdminImpersonationSession(session);

    expect(parseAdminImpersonationSession(encoded)).toEqual(session);
  });

  it('rejects a tampered impersonation payload', () => {
    process.env.SUPER_ADMIN_IMPERSONATION_SECRET = 'test-impersonation-secret';

    const encoded = serializeAdminImpersonationSession({
      salonId: 'salon_1',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const [payload, signature] = encoded.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      salonId: 'salon_2',
      salonSlug: 'other-salon',
      salonName: 'Other Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    })).toString('base64url');

    expect(parseAdminImpersonationSession(`${tamperedPayload}.${signature}`)).toBeNull();
    expect(parseAdminImpersonationSession(`${payload}.tampered-signature`)).toBeNull();
  });
});
