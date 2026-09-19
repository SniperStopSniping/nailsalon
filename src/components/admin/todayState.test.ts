import { describe, expect, it } from 'vitest';

import { getTodayOperationalState } from './todayState';

const now = new Date('2026-09-19T14:00:00.000Z').getTime();

function appointment(
  id: string,
  status: string,
  startTime: string,
  endTime: string,
) {
  return { id, status, startTime, endTime };
}

describe('getTodayOperationalState', () => {
  it('uses stored in-progress state for Current, never clock time', () => {
    const result = getTodayOperationalState([
      appointment('confirmed-now', 'confirmed', '2026-09-19T13:30:00.000Z', '2026-09-19T14:30:00.000Z'),
      appointment('in-progress', 'in_progress', '2026-09-19T10:00:00.000Z', '2026-09-19T11:00:00.000Z'),
    ], now);

    expect(result.currentAppointment?.id).toBe('in-progress');
    expect(result.nextConfirmedAppointment).toBeNull();
  });

  it('uses the earliest future confirmed appointment for Next', () => {
    const result = getTodayOperationalState([
      appointment('later', 'confirmed', '2026-09-19T16:00:00.000Z', '2026-09-19T17:00:00.000Z'),
      appointment('next', 'confirmed', '2026-09-19T15:00:00.000Z', '2026-09-19T16:00:00.000Z'),
      appointment('pending', 'pending', '2026-09-19T14:30:00.000Z', '2026-09-19T15:00:00.000Z'),
      appointment('hold', 'awaiting_payment', '2026-09-19T14:15:00.000Z', '2026-09-19T14:45:00.000Z'),
    ], now);

    expect(result.nextConfirmedAppointment?.id).toBe('next');
    expect(result.pendingRequests.map(item => item.id)).toEqual(['pending']);
  });

  it('flags only past-ended confirmed or pending appointments as unresolved', () => {
    const result = getTodayOperationalState([
      appointment('past-confirmed', 'confirmed', '2026-09-19T10:00:00.000Z', '2026-09-19T11:00:00.000Z'),
      appointment('past-pending', 'pending', '2026-09-19T11:00:00.000Z', '2026-09-19T12:00:00.000Z'),
      appointment('completed', 'completed', '2026-09-19T12:00:00.000Z', '2026-09-19T13:00:00.000Z'),
      appointment('hold', 'awaiting_payment', '2026-09-19T12:30:00.000Z', '2026-09-19T13:30:00.000Z'),
    ], now);

    expect(result.unresolvedAppointments.map(item => item.id)).toEqual([
      'past-confirmed',
      'past-pending',
    ]);
  });
});
