import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RETENTION_SETTINGS } from '@/libs/retentionAssistant';

import { getRetentionSettingsForSalon } from './retentionSettings.server';

vi.mock('server-only', () => ({}));

const { selectQueue, db } = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const query = (result: unknown) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => result),
    };
    return chain;
  };
  return {
    selectQueue,
    db: { select: vi.fn(() => query(selectQueue.shift() ?? [])) },
  };
});

vi.mock('@/libs/DB', () => ({ db }));

describe('getRetentionSettingsForSalon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('preserves a Google review link configured in legacy salon settings', async () => {
    selectQueue.push(
      [],
      [{ settings: { googleReviewUrl: 'https://g.page/r/legacy/review' } }],
    );

    const settings = await getRetentionSettingsForSalon('salon_1');

    expect(settings).toEqual({
      ...DEFAULT_RETENTION_SETTINGS,
      googleReviewUrl: 'https://g.page/r/legacy/review',
    });
  });

  it('ignores an insecure legacy review link instead of breaking all retention settings', async () => {
    selectQueue.push(
      [],
      [{ settings: { googleReviewUrl: 'http://example.com/review' } }],
    );

    const settings = await getRetentionSettingsForSalon('salon_1');

    expect(settings.googleReviewUrl).toBeNull();
  });

  it('treats the new retention row as authoritative once populated', async () => {
    selectQueue.push([{
      ...DEFAULT_RETENTION_SETTINGS,
      salonId: 'salon_1',
      googleReviewUrl: 'https://g.page/r/new/review',
    }]);

    const settings = await getRetentionSettingsForSalon('salon_1');

    expect(settings.googleReviewUrl).toBe('https://g.page/r/new/review');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('respects an intentionally cleared new review link instead of resurrecting legacy data', async () => {
    selectQueue.push([{
      ...DEFAULT_RETENTION_SETTINGS,
      salonId: 'salon_1',
      googleReviewUrl: null,
    }]);

    const settings = await getRetentionSettingsForSalon('salon_1');

    expect(settings.googleReviewUrl).toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
