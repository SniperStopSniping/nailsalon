/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  db,
  insertValues,
  selectResults,
  updateSet,
  listGoogleCalendarEventsForSalon,
  runAppointmentManageMutation,
  getAppointmentCalendarEventForSync,
  enqueueGoogleCalendarUpsert,
  sendTransactionalEmail,
  logAppointmentChange,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const limit = vi.fn(async () => selectResults.shift() ?? []);
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    db: { select, update, insert },
    insertValues,
    selectResults,
    updateSet,
    listGoogleCalendarEventsForSalon: vi.fn(),
    runAppointmentManageMutation: vi.fn(),
    getAppointmentCalendarEventForSync: vi.fn(),
    enqueueGoogleCalendarUpsert: vi.fn(),
    sendTransactionalEmail: vi.fn(),
    logAppointmentChange: vi.fn(),
  };
});

vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/googleCalendar', () => ({ listGoogleCalendarEventsForSalon }));
vi.mock('@/libs/appointmentManage', () => ({
  AppointmentManageError: class AppointmentManageError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  getAppointmentCalendarEventForSync,
  runAppointmentManageMutation,
}));
vi.mock('@/libs/integrationOutbox', () => ({ enqueueGoogleCalendarUpsert }));
vi.mock('@/libs/email', () => ({ sendTransactionalEmail }));
vi.mock('@/libs/appointmentAudit', () => ({ logAppointmentChange }));

import { processGoogleCalendarInboundSync } from './googleCalendarInbound';

const connection = {
  salonId: 'salon_1',
  inboundSyncedAt: new Date('2026-07-15T15:00:00.000Z'),
};

const salon = {
  name: 'Best Nails',
  settings: { booking: { timezone: 'America/Toronto' } },
};

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  status: 'confirmed',
  startTime: new Date('2026-07-16T14:00:00.000Z'),
  endTime: new Date('2026-07-16T15:30:00.000Z'),
  clientEmail: 'client@example.com',
  clientName: 'Ava',
  notes: null,
};

describe('processGoogleCalendarInboundSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    listGoogleCalendarEventsForSalon.mockResolvedValue([]);
    runAppointmentManageMutation.mockResolvedValue({ appointment: {}, warnings: [] });
    sendTransactionalEmail.mockResolvedValue(true);
  });

  it('initializes a new connection without importing old calendar history', async () => {
    selectResults.push([{ salonId: 'salon_1', inboundSyncedAt: null }]);

    const result = await processGoogleCalendarInboundSync();

    expect(result.initializedConnections).toBe(1);
    expect(listGoogleCalendarEventsForSalon).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      inboundSyncedAt: expect.any(Date),
      inboundSyncError: null,
    }));
  });

  it('moves and resizes a tenant appointment changed in Google Calendar', async () => {
    selectResults.push([connection], [salon], [appointment]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'confirmed',
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:45:00.000Z'),
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(runAppointmentManageMutation).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      operation: 'move',
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      durationMinutes: 105,
      canReassignTechnician: false,
    }));
    expect(result.movedAppointments).toBe(1);
    expect(logAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'time_changed',
      salonId: 'salon_1',
      performedBy: 'google-calendar-sync',
    }));
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'client@example.com',
      subject: 'Best Nails appointment rescheduled',
    }));
  });

  it('imports a new Google event as a tenant-scoped draft that needs details', async () => {
    selectResults.push([connection], [salon]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_external_1',
      appointmentId: null,
      salonId: null,
      status: 'confirmed',
      summary: 'Maya nails',
      startTime: new Date('2026-07-16T16:00:00.000Z'),
      endTime: new Date('2026-07-16T17:30:00.000Z'),
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      googleEventId: 'google_external_1',
      title: 'Maya nails',
      status: 'needs_details',
    }));
    expect(result.importedDrafts).toBe(1);
    expect(runAppointmentManageMutation).not.toHaveBeenCalled();
  });

  it('cancels a matching appointment when its connected Google event is deleted', async () => {
    selectResults.push([connection], [salon], [appointment]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      status: 'cancelled',
      startTime: null,
      endTime: null,
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      googleCalendarEventId: null,
    }));
    expect(result.cancelledAppointments).toBe(1);
    expect(logAppointmentChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'cancelled',
      salonId: 'salon_1',
    }));
  });

  it('ignores an event whose private salon marker does not match the connection', async () => {
    selectResults.push([connection], [salon]);
    listGoogleCalendarEventsForSalon.mockResolvedValue([{
      id: 'google_1',
      appointmentId: 'appt_1',
      salonId: 'salon_2',
      status: 'confirmed',
      startTime: new Date(),
      endTime: new Date(),
    }]);

    const result = await processGoogleCalendarInboundSync();

    expect(runAppointmentManageMutation).not.toHaveBeenCalled();
    expect(result.movedAppointments).toBe(0);
  });
});
