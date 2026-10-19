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
});
