import { describe, expect, it } from 'vitest';

import { customerContactRequestSchema, normalizeCustomerContact } from './contact';
import { createCustomerContactBinding } from './contact.server';

vi.mock('server-only', () => ({}));

describe('customer review contact boundary', () => {
  it('matches guest contact normalization without retaining raw formatting', () => {
    const parsed = customerContactRequestSchema.parse({ name: '  Ava Client ', email: ' AVA@Example.COM ', phone: '+1 (416) 555-0101' });

    expect(normalizeCustomerContact(parsed)).toEqual({ name: 'Ava Client', email: 'ava@example.com', phone: '4165550101' });
    expect(normalizeCustomerContact(customerContactRequestSchema.parse({ name: 'Ava', email: 'ava@example.com', phone: '555-0101' }))).toBeNull();
  });

  it('uses domain-separated HMAC contact binding without exposing raw contact', () => {
    const first = createCustomerContactBinding({ secret: 'x'.repeat(32), salonId: 'salon-a', sessionId: '00000000-0000-4000-8000-000000000001', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' } });
    const same = createCustomerContactBinding({ secret: 'x'.repeat(32), salonId: 'salon-a', sessionId: '00000000-0000-4000-8000-000000000001', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' } });
    const changed = createCustomerContactBinding({ secret: 'x'.repeat(32), salonId: 'salon-a', sessionId: '00000000-0000-4000-8000-000000000001', contact: { name: 'Ava', email: 'else@example.com', phone: '4165550101' } });
    const otherSalon = createCustomerContactBinding({ secret: 'x'.repeat(32), salonId: 'salon-b', sessionId: '00000000-0000-4000-8000-000000000001', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' } });
    const otherSession = createCustomerContactBinding({ secret: 'x'.repeat(32), salonId: 'salon-a', sessionId: '00000000-0000-4000-8000-000000000002', contact: { name: 'Ava', email: 'ava@example.com', phone: '4165550101' } });

    expect(first).toBe(same);
    expect(first).not.toBe(changed);
    expect(first).not.toBe(otherSalon);
    expect(first).not.toBe(otherSession);
    expect(first).not.toContain('ava@example.com');
  });
});
