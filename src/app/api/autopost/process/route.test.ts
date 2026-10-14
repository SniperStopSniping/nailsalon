import { expect, it, vi } from 'vitest';

import { POST } from './route';

const { postToPlatform, select, update } = vi.hoisted(() => ({ postToPlatform: vi.fn(), select: vi.fn(), update: vi.fn() }));
vi.mock('@/core/config/flags', () => ({ FEATURE_FLAGS: { ENABLE_AUTOPOST_GLOBAL: false } }));
vi.mock('@/core/autopost/poster', () => ({ postToPlatform }));
vi.mock('@/core/logging/logger', () => ({ logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: { select, update } }));

it('reports a skipped inactive worker without claiming a post succeeded or changing its queue', async () => {
  const response = await POST(new Request('http://localhost/api/autopost/process', { method: 'POST' }));

  expect(await response.json()).toMatchObject({ data: { skipped: true, processed: 0, succeeded: 0 } });
  expect(postToPlatform).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
