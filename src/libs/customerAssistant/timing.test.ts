import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomerTurnTiming } from './timing';

afterEach(() => vi.restoreAllMocks());

describe('customer turn timings', () => {
  it('reports availability separately without double-counting it as server resolution', () => {
    const timing = new CustomerTurnTiming();
    timing.add('resolution', 200);
    timing.add('availability', 170);
    timing.add('persistence', 12);
    timing.add('total', 900);

    expect(timing.snapshot()).toEqual({ resolution: 30, availability: 170, persistence: 12, total: 900 });
    expect(timing.header()).toBe('resolution;dur=30, availability;dur=170, persistence;dur=12, total;dur=900');
  });

  it('records failed work as elapsed time rather than excluding slow failures', async () => {
    const timing = new CustomerTurnTiming();
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(8100);

    await expect(timing.measure('model', async () => {
      throw new Error('synthetic timeout');
    })).rejects.toThrow('synthetic timeout');
    expect(timing.snapshot()).toEqual({ model: 8000 });
  });
});
