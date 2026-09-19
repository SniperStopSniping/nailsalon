import { describe, expect, it } from 'vitest';

import { evaluateReviewHistory, type ReviewHistoryEvidence } from './reviewRequestHistory';

const sentAt = new Date('2026-01-01T18:00:00.000Z');
const boundary = new Date(sentAt.getTime() + 90 * 86_400_000);
const sent: ReviewHistoryEvidence = { id: 'older', appointmentId: 'older-appointment', state: 'sent', sentAt };
const decide = (history: ReviewHistoryEvidence[], now = boundary, cooldownDays: 90 | 180 | 365 | 'never' = 90) => evaluateReviewHistory({ history, appointmentId: 'current', cooldownDays, now });

describe('review history decision', () => {
  it('allows a future appointment exactly 90 days after the recorded send', () => {
    expect(decide([sent], new Date(boundary.getTime() - 1))).toMatchObject({ allowed: false, reason: 'cooldown', nextEligibleAt: boundary });
    expect(decide([sent])).toMatchObject({ allowed: true });
  });

  it.each([180, 365] as const)('honors the advanced %i-day alternative', (days) => {
    expect(decide([sent], boundary, days)).toMatchObject({ allowed: false, reason: 'cooldown', nextEligibleAt: new Date(sentAt.getTime() + days * 86_400_000) });
  });

  it('preserves lifetime suppression for legacy never-repeat salons', () => {
    expect(decide([sent], new Date('2030-01-01'), 'never')).toMatchObject({ allowed: false, reason: 'repeat_disabled' });
  });

  it('never requests twice for the same appointment even after the cooldown', () => {
    expect(decide([{ ...sent, appointmentId: 'current' }], new Date('2030-01-01'))).toMatchObject({ allowed: false, reason: 'same_appointment' });
  });

  it.each(['pending', 'claimed', 'blocked_no_credit', 'sending'])('reserves the client while an intent is %s', (state) => {
    expect(decide([{ ...sent, state, sentAt: null }])).toMatchObject({ allowed: false, reason: 'request_pending', nextEligibleAt: null });
  });

  it.each(['send_outcome_unknown', 'failed', null, 'unrecognized'])('fails closed for uncertain evidence %s', (state) => {
    expect(decide([{ ...sent, state }])).toMatchObject({ allowed: false, reason: 'outcome_uncertain', nextEligibleAt: null });
  });

  it.each(['canceled', 'suppressed', 'expired'])('releases a proven never-sent %s intent, including the same appointment', (state) => {
    expect(decide([{ ...sent, appointmentId: 'current', state, sentAt: null }])).toMatchObject({ allowed: true });
  });

  it('requires a recorded sent time and never substitutes the current time', () => {
    for (const missing of [null, new Date(Number.NaN)]) {
      expect(decide([{ ...sent, sentAt: missing }])).toMatchObject({ allowed: false, reason: 'outcome_uncertain', nextEligibleAt: null });
    }
  });

  it('does not release a canceled intent that has contradictory provider evidence', () => {
    expect(decide([{ ...sent, state: 'canceled', sentAt: null, hasProviderEvidence: true }])).toMatchObject({ allowed: false, reason: 'outcome_uncertain' });
  });

  it('uses the most recent send across matching history independent of row order', () => {
    const newer = { ...sent, id: 'newer', sentAt: new Date('2026-03-01T18:00:00.000Z') };
    const expected = { allowed: false, blockingId: 'newer', nextEligibleAt: new Date(newer.sentAt.getTime() + 90 * 86_400_000) };

    expect(decide([sent, newer])).toMatchObject(expected);
    expect(decide([newer, sent])).toMatchObject(expected);
  });

  it('does not hide an uncertain request behind a known cooldown', () => {
    expect(decide([{ ...sent, sentAt: boundary }, { ...sent, id: 'unknown', state: 'send_outcome_unknown' }])).toMatchObject({ reason: 'outcome_uncertain', blockingId: 'unknown' });
  });
});
