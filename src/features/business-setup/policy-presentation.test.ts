import { describe, expect, it, vi } from 'vitest';

import { EMPTY_WEBSITE_DETAILS } from '@/features/custom-sites/website-details';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig.shared';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';

import { resolveSetupPolicy, setupPolicyInput } from './booking-policy';
import { applySetupOperations, CLOSED_HOURS, type SetupDocument, type SetupOperation, setupOperationSchema } from './contracts';
import { assertSavedPolicyPresentation, isSavedPolicyVisibilityOperation, savedPolicyVisibilityRequest } from './policy-presentation';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

const policy = resolveSetupPolicy({ enabled: true, title: 'Appointment agreement', text: 'Please arrive on time.', showOnServicePage: false, showBeforeConfirmation: true, showAfterConfirmation: false, showInConfirmationEmail: true, acknowledgment: { required: true, text: 'I agree.' } });
const document = { bookingPolicy: policy, website: { content: { websiteDetails: EMPTY_WEBSITE_DETAILS } } };
const show: SetupOperation = { type: 'booking_policy', values: { ...setupPolicyInput(policy), showOnServicePage: true } };
const message = 'Show my saved booking agreement on the website in a rounded card.';

describe('saved policy presentation', () => {
  it.each([
    [message, true],
    ['Please include my existing booking policy on my website.', true],
    ['Show my current agreement on the page and remove that photo.', true],
    ['Hide the gallery, but display my current booking policy on the website.', true],
    ['Hide my saved booking policy from the website.', false],
    ['Do not show my saved booking policy on the website.', false],
    ['Don’t display my existing appointment agreement on the homepage.', false],
    ['Change the policy text and show my saved booking policy on the website.', null],
    ['Make my homepage beige.', null],
    ['What is my saved booking policy?', null],
  ] as const)('recognizes a narrow visibility instruction: %s', (text, result) => {
    expect(savedPolicyVisibilityRequest(text)).toBe(result);
  });

  it('allows website presentation while protecting every operational and acceptance field', () => {
    expect(isSavedPolicyVisibilityOperation(show, document, true)).toBe(true);
    expect(() => assertSavedPolicyPresentation(document, message, 'website', [show])).not.toThrow();

    for (const values of [
      { ...show.values, enabled: false, acknowledgment: { required: false, text: null } },
      { ...show.values, text: 'A different agreement.' },
      { ...show.values, showInConfirmationEmail: false },
      { ...show.values, acknowledgment: { required: false, text: null } },
    ]) {
      expect(isSavedPolicyVisibilityOperation({ type: 'booking_policy', values }, document, true)).toBe(false);
    }
  });

  it('rejects a copied agreement and accepts removal of an existing identical copy', () => {
    const copy: SetupOperation = { type: 'website_details', values: { sections: [{ id: 'agreement', title: policy.title!, text: policy.text! }] } };

    expect(() => assertSavedPolicyPresentation(document, message, 'business_and_website', [copy])).toThrow('booking_policy_visibility');
    expect(() => assertSavedPolicyPresentation(document, message, 'business_and_website', [show, copy])).toThrow('separate copy');

    const copied = { ...document, website: { content: { websiteDetails: { ...EMPTY_WEBSITE_DETAILS, sections: copy.values.sections! } } } };

    expect(() => assertSavedPolicyPresentation(copied, message, 'website', [show])).toThrow('separate copy');
    expect(() => assertSavedPolicyPresentation(copied, message, 'website', [show, { type: 'website_details', values: { sections: [] } }])).not.toThrow();
  });

  it('does not invent or activate a missing agreement from an image or a price request', () => {
    expect(() => assertSavedPolicyPresentation({ website: { content: {} } }, message, 'website', [])).not.toThrow();
    expect(() => assertSavedPolicyPresentation(document, message, 'service_price', [])).not.toThrow();
    expect(isSavedPolicyVisibilityOperation(show, document, null)).toBe(false);
    expect(() => assertSavedPolicyPresentation(document, 'Build from this image.', 'business_and_website', [])).not.toThrow();
  });

  it('uses a small visibility-only action without returning long policy text or changing acceptance', () => {
    const operation: SetupOperation = { type: 'booking_policy_visibility', showOnServicePage: true };

    expect(isSavedPolicyVisibilityOperation(operation, document, true)).toBe(true);
    expect(setupOperationSchema.safeParse({ ...operation, text: 'Replacement' }).success).toBe(false);

    const draft: SetupDocument = { schemaVersion: 1, bookingPolicy: policy, business: { name: 'Test salon', city: 'Toronto', exactAddress: '', homeBased: false, workMode: 'solo', locationDisplayMode: 'city_only' }, hours: CLOSED_HOURS, booking: resolveBookingConfigFromSettings(null), services: [], website: { config: resolveBookingPageConfig(null).draft, content: resolveBookingPageContent(null).draft } };
    const changed = applySetupOperations(draft, [operation], 'assistant');

    expect(changed.bookingPolicy).toEqual({ ...policy, showOnServicePage: true });
    expect(draft.bookingPolicy).toBe(policy);
    expect(() => applySetupOperations(draft, [operation], 'upload')).toThrow('Discuss booking requirements');
    expect(() => applySetupOperations({ ...draft, bookingPolicy: undefined }, [operation], 'assistant')).toThrow('Save your booking agreement');
  });
});
