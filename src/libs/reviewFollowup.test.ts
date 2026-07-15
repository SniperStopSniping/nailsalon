import { describe, expect, it } from 'vitest';

import {
  buildGoogleReviewMessage,
  buildSatisfactionMessage,
  firstNameFor,
  isReviewFollowupAction,
  shouldPromptForReview,
} from './reviewFollowup';

describe('firstNameFor', () => {
  it('takes the first token of a full name', () => {
    expect(firstNameFor('Ava Nguyen')).toBe('Ava');
  });

  it('falls back to "there" when empty or missing', () => {
    expect(firstNameFor('')).toBe('there');
    expect(firstNameFor(null)).toBe('there');
    expect(firstNameFor(undefined)).toBe('there');
    expect(firstNameFor('   ')).toBe('there');
  });
});

describe('buildSatisfactionMessage', () => {
  it('greets the client by first name and names the salon', () => {
    const msg = buildSatisfactionMessage({ salonName: 'Isla Nail Studio', clientName: 'Ava Nguyen' });

    expect(msg).toBe('Hi Ava 😊 thank you for coming to Isla Nail Studio today. Were you happy with your nails?');
  });
});

describe('buildGoogleReviewMessage', () => {
  it('includes the review link when configured', () => {
    const msg = buildGoogleReviewMessage({
      salonName: 'Isla Nail Studio',
      clientName: 'Ava',
      googleReviewUrl: 'https://g.page/r/abc',
    });

    expect(msg).toContain('https://g.page/r/abc');
    expect(msg).toContain('Ava');
    expect(msg).toContain('Google review');
  });

  it('returns null when no review URL is configured', () => {
    expect(buildGoogleReviewMessage({ salonName: 'Isla', clientName: 'Ava', googleReviewUrl: null })).toBeNull();
    expect(buildGoogleReviewMessage({ salonName: 'Isla', clientName: 'Ava', googleReviewUrl: '  ' })).toBeNull();
  });
});

describe('isReviewFollowupAction', () => {
  it('accepts valid actions and rejects others', () => {
    expect(isReviewFollowupAction('satisfaction_question')).toBe(true);
    expect(isReviewFollowupAction('google_review_link')).toBe(true);
    expect(isReviewFollowupAction('skipped')).toBe(true);
    expect(isReviewFollowupAction('already_reviewed')).toBe(true);
    expect(isReviewFollowupAction('nonsense')).toBe(false);
    expect(isReviewFollowupAction(null)).toBe(false);
  });
});

describe('shouldPromptForReview', () => {
  it('prompts only when the client has not reviewed', () => {
    expect(shouldPromptForReview({ hasGoogleReview: false })).toBe(true);
    expect(shouldPromptForReview({ hasGoogleReview: null })).toBe(true);
    expect(shouldPromptForReview({})).toBe(true);
    expect(shouldPromptForReview({ hasGoogleReview: true })).toBe(false);
  });
});
