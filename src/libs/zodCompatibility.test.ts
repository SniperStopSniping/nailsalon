import { z } from 'zod';

import { SalonPolicyInputSchema, SalonPolicyPatchSchema } from '@/core/appointments/policySchemas';
import { setupOperationSchema } from '@/features/business-setup/contracts';

import { completeAppointmentSchema } from './appointmentCompletionContract';
import { bookingConfigPatchSchema, bookingConfigSchema, DEFAULT_BOOKING_CONFIG } from './bookingConfig.shared';
import { communicationSettingsSchema, communicationSettingsUpdateSchema } from './communicationSettings';
import { DEFAULT_MERCHANDISING_SETTINGS, merchandisingSettingsSchema, merchandisingSettingsUpdateSchema } from './salonMerchandisingSettings';

vi.mock('server-only', () => ({}));

// Business-contract regressions for the supported root Zod 4 parser. In
// particular, defaults must not turn sparse mutations into settings resets.
describe('Zod runtime business contract compatibility', () => {
  it('does not traverse oversized constrained collections', () => {
    let visits = 0;
    const item = z.preprocess((value) => {
      visits += 1;
      return value;
    }, z.string());
    const result = z.array(item).max(2).safeParse(['a', 'b', 'c']);

    expect(result.success).toBe(false);
    expect(visits).toBe(0);

    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.code).toBe('too_big');
    }
  });

  it('keeps omitted booking PATCH fields absent and preserves explicit false, zero, empty and null', () => {
    expect(bookingConfigSchema.parse({})).toEqual(DEFAULT_BOOKING_CONFIG);
    expect(bookingConfigPatchSchema.parse({})).toEqual({});

    const patch = { bufferMinutes: 0, firstVisitDiscountEnabled: false, introPriceDefaultLabel: '' };

    expect(bookingConfigPatchSchema.parse(patch)).toEqual(patch);
    expect(bookingConfigPatchSchema.parse({ introPriceDefaultLabel: null })).toEqual({ introPriceDefaultLabel: null });
    expect(bookingConfigPatchSchema.parse({ currency: undefined })).toStrictEqual({ currency: undefined });

    const invalid = bookingConfigPatchSchema.safeParse({ bufferMinutes: '' });

    expect(invalid.success).toBe(false);

    if (!invalid.success) {
      expect(invalid.error.issues[0]).toMatchObject({ code: 'invalid_type', path: ['bufferMinutes'] });
    }

    expect(bookingConfigPatchSchema.safeParse({ currency: false }).success).toBe(false);
    expect(bookingConfigPatchSchema.safeParse({ timezone: 'invalid/timezone' }).success).toBe(false);
  });

  it('does not clear unrelated photo requirements or enable posting through default-filled policy patches', () => {
    expect(SalonPolicyInputSchema.parse({}).requireAfterPhotoToPay).toBe('off');
    expect(SalonPolicyPatchSchema.safeParse({}).success).toBe(false);
    expect(SalonPolicyPatchSchema.parse({ autoPostEnabled: false })).toEqual({ autoPostEnabled: false });
    expect(SalonPolicyPatchSchema.parse({ autoPostPlatforms: [] })).toEqual({ autoPostPlatforms: [] });
    expect(SalonPolicyPatchSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(merchandisingSettingsSchema.parse({})).toEqual(DEFAULT_MERCHANDISING_SETTINGS);
    expect(merchandisingSettingsUpdateSchema.parse({ showServiceImages: false })).toEqual({ showServiceImages: false });
  });

  it('preserves sparse setup operation payloads used by canonical writes and fingerprints', () => {
    const operations = [
      { type: 'booking', values: { bufferMinutes: 0 } },
      { type: 'business', values: { name: 'Studio' } },
      { type: 'business', values: { city: '', homeBased: false } },
    ];
    for (const operation of operations) {
      expect(JSON.stringify(setupOperationSchema.parse(operation))).toBe(JSON.stringify(operation));
    }

    expect(setupOperationSchema.safeParse({ type: 'booking', values: { currency: 'EUR' } }).success).toBe(false);
  });

  it('accepts partial stored/event PATCH maps without replacing sibling notification choices', () => {
    const events = { not_a_real_event: { email: false, sms: false } };
    // Use the declared event vocabulary and settings rather than assuming keys.
    const defaults = communicationSettingsSchema.parse({});
    const firstEvent = Object.keys(defaults.events)[0]!;
    const partial = { [firstEvent]: defaults.events[firstEvent as keyof typeof defaults.events] };

    expect(communicationSettingsUpdateSchema.parse({ events: partial })).toEqual({ events: partial });
    expect(communicationSettingsSchema.parse({ events: partial }).events).toEqual(defaults.events);
    expect(communicationSettingsUpdateSchema.safeParse({ events }).success).toBe(false);
  });

  it('preserves completion payment omission versus an explicit empty payment list', () => {
    const legacy = completeAppointmentSchema.parse({ finalPriceCents: 0, tipCents: 0, taxExempt: false, techNotes: '' });

    expect(legacy).toEqual({ skipPhotoValidation: false, finalPriceCents: 0, tipCents: 0, taxExempt: false, techNotes: '' });
    expect(legacy).not.toHaveProperty('payments');
    expect(completeAppointmentSchema.parse({ payments: [] })).toEqual({ skipPhotoValidation: false, payments: [] });
    expect(completeAppointmentSchema.safeParse({ payments: [{ amountCents: 0 }] }).success).toBe(false);
  });
});
