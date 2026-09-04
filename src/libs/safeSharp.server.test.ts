import { expect, it, vi } from 'vitest';

import sharp from './safeSharp.server';

vi.mock('server-only', () => ({}));
vi.mock('sharp', () => ({ default: { block: vi.fn() } }));

it('blocks every vulnerable native loader before exposing the shared decoder', () => {
  expect(sharp.block).toHaveBeenCalledTimes(1);
  expect(sharp.block).toHaveBeenCalledWith({
    operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips'],
  });
});
