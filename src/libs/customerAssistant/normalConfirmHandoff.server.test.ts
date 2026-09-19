import { describe, expect, it, vi } from 'vitest';

import { issueNormalConfirmHandoff, verifyNormalConfirmHandoff } from './normalConfirmHandoff.server';

vi.mock('server-only', () => ({}));

const secret = 'normal-confirm-handoff-secret-long-enough';
const now = new Date('2030-01-01T00:00:00.000Z');

describe('normal confirm handoff', () => {
  it('issues an opaque tenant-bound stable flow identity without booking material', () => {
    const handoff = issueNormalConfirmHandoff({ salonId: 'salon-a', secret, now });

    expect(handoff.flowToken).not.toContain('contact');
    expect(handoff.flowToken).not.toContain('slot');
    expect(verifyNormalConfirmHandoff({ salonId: 'salon-a', flowToken: handoff.flowToken, secret, now })).toMatchObject({ expiresAt: new Date('2030-01-01T02:00:00.000Z') });
  });

  it('rejects cross-tenant, modified, and expired handoffs', () => {
    const handoff = issueNormalConfirmHandoff({ salonId: 'salon-a', secret, now });

    expect(() => verifyNormalConfirmHandoff({ salonId: 'salon-b', flowToken: handoff.flowToken, secret, now })).toThrow('NORMAL_CONFIRM_HANDOFF_INVALID');
    expect(() => verifyNormalConfirmHandoff({ salonId: 'salon-a', flowToken: `${handoff.flowToken}x`, secret, now })).toThrow('NORMAL_CONFIRM_HANDOFF_INVALID');
    expect(() => verifyNormalConfirmHandoff({ salonId: 'salon-a', flowToken: handoff.flowToken, secret, now: new Date('2030-01-01T02:01:00.000Z') })).toThrow('NORMAL_CONFIRM_HANDOFF_EXPIRED');
  });
});
