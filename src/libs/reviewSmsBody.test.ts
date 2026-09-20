import { describe, expect, it } from 'vitest';

import { COMMUNICATION_TEMPLATES } from './communicationTemplates';
import { DEFAULT_REVIEW_MESSAGE, LEGACY_DEFAULT_REVIEW_MESSAGE, resolveReviewMessageTemplate, reviewSmsBody } from './reviewRequests';
import { prepareSmsBody } from './smsSegments';

const reviewLink = 'https://g.page/r/Cd2cHWyZCr9bEBM/review';

describe('review SMS final body', () => {
  it('reproduces the Isla two-credit cause and removes only the automatic footer from custom copy', () => {
    const message = `Hi Samira! Thanks for visiting Isla Nail Studio. We would appreciate a Google review:\n${reviewLink}`;
    const old = COMMUNICATION_TEMPLATES.client_manual_text!.render({ salonName: 'Isla Nail Studio', message });
    const body = reviewSmsBody({ template: message, businessName: 'Isla Nail Studio', clientName: 'Samira', reviewLink });

    expect(prepareSmsBody(old).segmentation).toMatchObject({ encoding: 'gsm7', billableUnits: 177, segments: 2 });
    expect(prepareSmsBody(body)).toMatchObject({ finalBody: `Isla Nail Studio via Luster: ${message}`, predictedCredits: 1, segmentation: { billableUnits: 154, encoding: 'gsm7', segments: 1 } });
  });

  it.each(['Sam', 'Samira', 'Alexandria-Konstantina Papadopoulos', '美甲', 'Jose\u0301', null])('keeps the default at one credit independently of customer name %s', (clientName) => {
    for (const [businessName, units] of [['Isla Nail Studio', 119], ['ABCDEFGHIJKLMNOPQRSTUVWX', 127]] as const) {
      const body = reviewSmsBody({ template: DEFAULT_REVIEW_MESSAGE, clientName, businessName, reviewLink });

      expect(prepareSmsBody(body)).toMatchObject({ predictedCredits: 1, segmentation: { encoding: 'gsm7', billableUnits: units, segments: 1 } });
      expect(body).not.toContain('STOP');
      expect(body).toContain(reviewLink);
    }
  });

  it('adopts only the exact legacy default and preserves customized templates', () => {
    expect(resolveReviewMessageTemplate(null)).toBe(DEFAULT_REVIEW_MESSAGE);
    expect(resolveReviewMessageTemplate(LEGACY_DEFAULT_REVIEW_MESSAGE)).toBe(DEFAULT_REVIEW_MESSAGE);
    expect(resolveReviewMessageTemplate(`Custom ${LEGACY_DEFAULT_REVIEW_MESSAGE}`)).toBe(`Custom ${LEGACY_DEFAULT_REVIEW_MESSAGE}`);
  });

  it.each(['💅', '’', '\u00A0', '\u200B', 'Jose\u0301'])('preserves custom Unicode and reports its real segment cost: %s', (extra) => {
    const body = reviewSmsBody({ template: `${DEFAULT_REVIEW_MESSAGE} ${extra}`, businessName: 'Isla Nail Studio', clientName: 'Samira', reviewLink });
    const prepared = prepareSmsBody(body);

    expect(prepared.finalBody).toContain(extra);
    expect(prepared.segmentation.encoding).toBe('ucs2');
    expect(prepared.predictedCredits).toBe(2);
  });

  it('does not truncate a long review URL or hide the added credit', () => {
    const longLink = `${reviewLink}?source=${'a'.repeat(100)}`;
    const body = reviewSmsBody({ template: DEFAULT_REVIEW_MESSAGE, businessName: 'Isla Nail Studio', clientName: 'Samira', reviewLink: longLink });

    expect(body).toContain(longLink);
    expect(prepareSmsBody(body).predictedCredits).toBe(2);
  });
});
