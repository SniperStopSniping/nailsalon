/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectRows } = vi.hoisted(() => ({ selectRows: [] as unknown[][] }));

vi.mock('server-only', () => ({}));

vi.mock('@/libs/DB', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = async () => selectRows.shift() ?? [];
      return chain;
    },
  },
}));

import { describeAppointmentAccessFailure } from './appointmentAccess';

const NOW = new Date('2026-07-20T12:00:00.000Z');

describe('describeAppointmentAccessFailure', () => {
  beforeEach(() => {
    selectRows.length = 0;
  });

  it('reports an aged-out token as expired', async () => {
    selectRows.push([{ expiresAt: new Date('2026-07-01T00:00:00.000Z'), revokedAt: null }]);

    await expect(describeAppointmentAccessFailure('token', NOW)).resolves.toBe('expired');
  });

  it('reports an unknown token as invalid', async () => {
    selectRows.push([]);

    await expect(describeAppointmentAccessFailure('token', NOW)).resolves.toBe('invalid');
  });

  it('reports a revoked token as invalid, never as expired', async () => {
    // A superseded link is not something the holder should learn more about.
    selectRows.push([{
      expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      revokedAt: new Date('2026-07-02T00:00:00.000Z'),
    }]);

    await expect(describeAppointmentAccessFailure('token', NOW)).resolves.toBe('invalid');
  });

  it('reports a still-valid token as invalid, since it did not fail on expiry', async () => {
    selectRows.push([{ expiresAt: new Date('2026-08-01T00:00:00.000Z'), revokedAt: null }]);

    await expect(describeAppointmentAccessFailure('token', NOW)).resolves.toBe('invalid');
  });
});
