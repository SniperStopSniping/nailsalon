/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

import { ensureServiceAssignments } from './serviceAssignments';

function createDatabase(activeTechnicianIds: string[]) {
  let selectCount = 0;
  const select = vi.fn(() => {
    selectCount += 1;
    const where = vi.fn(() => selectCount === 1
      ? { limit: async () => [{ id: 'svc_new' }] }
      : activeTechnicianIds.map(id => ({ id })));
    const from = vi.fn(() => ({ where }));
    return { from };
  });
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));

  return {
    database: { select, insert } as never,
    values,
    onConflictDoUpdate,
  };
}

describe('ensureServiceAssignments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('automatically assigns a new service when the salon has one active technician', async () => {
    const { database, values, onConflictDoUpdate } = createDatabase(['tech_daniela']);

    const result = await ensureServiceAssignments(database, {
      salonId: 'salon_isla',
      serviceId: 'svc_builder_overlay',
    });

    expect(result).toEqual({
      assignedTechnicianIds: ['tech_daniela'],
      assignmentRequired: false,
    });
    expect(values).toHaveBeenCalledWith([expect.objectContaining({
      technicianId: 'tech_daniela',
      serviceId: 'svc_builder_overlay',
      enabled: true,
    })]);
    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it('requires explicit assignments for a multi-technician salon', async () => {
    const { database, values } = createDatabase(['tech_1', 'tech_2']);

    const result = await ensureServiceAssignments(database, {
      salonId: 'salon_1',
      serviceId: 'svc_new',
    });

    expect(result).toEqual({ assignedTechnicianIds: [], assignmentRequired: true });
    expect(values).not.toHaveBeenCalled();
  });

  it('rejects explicit technician ids outside the active salon technician set', async () => {
    const { database } = createDatabase(['tech_1']);

    await expect(ensureServiceAssignments(database, {
      salonId: 'salon_1',
      serviceId: 'svc_new',
      technicianIds: ['tech_other_salon'],
    })).rejects.toThrow('INVALID_TECHNICIAN_ASSIGNMENT');
  });
});
