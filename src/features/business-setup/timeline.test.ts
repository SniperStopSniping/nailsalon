import { describe, expect, it } from 'vitest';

import { setupTimeline } from './timeline';

describe('saved owner conversation', () => {
  const turn = { id: 'business', message: 'My details', reply: 'Saved', status: 'completed', createdAt: new Date(0), leaseExpiresAt: new Date(60000), designOperationId: null };
  const design = { id: 'design', message: 'Larger hero', status: 'completed', createdAt: new Date(1000) };

  it('retains design chat alongside intake after a refresh', () => {
    expect(setupTimeline([turn], [design], 2000).map(message => message.message)).toEqual(['My details', 'Larger hero']);
  });

  it('does not duplicate an intake message that already launched generation', () => {
    expect(setupTimeline([{ ...turn, designOperationId: 'design', status: 'generated' }], [design], 2000)).toEqual([{ id: 'business', message: 'My details', reply: 'Saved', status: 'completed' }]);
  });

  it('keeps generation and applying stages visibly pending until saved', () => {
    expect(setupTimeline([{ ...turn, status: 'generated' }], [], 2000)[0]?.status).toBe('pending');
    expect(setupTimeline([{ ...turn, status: 'generated', designOperationId: 'design' }], [{ ...design, status: 'generated' }], 2000)[0]?.status).toBe('pending');
  });

  it('shows an interruption instead of an endless preparation message', () => {
    expect(setupTimeline([{ ...turn, status: 'pending' }], [{ ...design, status: 'pending' }], 400000).map(message => message.status)).toEqual(['interrupted', 'interrupted']);
  });

  it.each([
    ['generating', 'Creating your website design. This can take a few minutes…'],
    ['repairing', 'Making a correction before showing your design…'],
    ['validating', 'Checking your design and booking links…'],
    ['saving', 'Saving your new website draft…'],
    ['applying', 'Finishing your saved website draft…'],
  ])('restores the actual %s stage without duplicating the owner request', (phase, progress) => {
    const pendingDesign = { ...design, status: 'pending', phase };
    const pendingTurn = { ...turn, status: 'generated', designOperationId: design.id };

    expect(setupTimeline([pendingTurn], [pendingDesign], 2000)).toEqual([{ id: turn.id, message: turn.message, reply: turn.reply, status: 'pending', progress }]);
    expect(setupTimeline([], [pendingDesign], 2000)[0]).toMatchObject({ status: 'pending', progress });
  });

  it('does not show stale, unknown or interrupted stages as ongoing progress', () => {
    for (const pendingDesign of [design, { ...design, status: 'failed' }, { ...design, status: 'pending', phase: 'unknown' }]) {
      expect(setupTimeline([], [{ ...pendingDesign, phase: pendingDesign.status === 'pending' ? 'unknown' : 'generating' }], 2000)[0]).not.toHaveProperty('progress');
    }

    expect(setupTimeline([], [{ ...design, status: 'pending', phase: 'generating' }], 400000)[0]).not.toHaveProperty('progress');
  });
});
