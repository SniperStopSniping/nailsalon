import { expect, it, vi } from 'vitest';

import { appointmentFitsProposedHours } from './appointment-impact.server';
import { CLOSED_HOURS } from './contracts';

vi.mock('server-only', () => ({}));
const hours = { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } };

it('counts a window ending exactly at closing as inside the proposed hours', () => {
  expect(appointmentFitsProposedHours(new Date('2026-10-19T20:00:00Z'), new Date('2026-10-19T21:00:00Z'), hours, 'America/Toronto')).toBe(true);
  expect(appointmentFitsProposedHours(new Date('2026-10-19T20:00:00Z'), new Date('2026-10-19T21:01:00Z'), hours, 'America/Toronto')).toBe(false);
});

it('compares local dates, including crossing midnight and closed days', () => {
  expect(appointmentFitsProposedHours(new Date('2026-10-20T14:00:00Z'), new Date('2026-10-20T15:00:00Z'), hours, 'America/Toronto')).toBe(false);
  expect(appointmentFitsProposedHours(new Date('2026-10-20T03:30:00Z'), new Date('2026-10-20T04:30:00Z'), { ...hours, monday: { open: '00:00', close: '23:59' } }, 'America/Toronto')).toBe(false);
});

it('uses the saved business time zone for the impact report across DST changes', () => {
  expect(appointmentFitsProposedHours(new Date('2026-11-02T14:00:00Z'), new Date('2026-11-02T15:00:00Z'), hours, 'America/Toronto')).toBe(true);
  expect(appointmentFitsProposedHours(new Date('2026-11-02T14:00:00Z'), new Date('2026-11-02T15:00:00Z'), hours, 'America/Vancouver')).toBe(false);
});
