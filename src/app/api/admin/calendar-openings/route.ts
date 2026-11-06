import { z } from 'zod';

import { requireAdminSalonFromRequest } from '@/libs/adminAuth';
import { getAllSlots } from '@/libs/availability/engine.server';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { loadBookingPolicy, resolveBookingHoursCeiling } from '@/libs/bookingPolicy';
import { type CalendarOpening, findCalendarGaps } from '@/libs/calendarOpenings';
import { getGoogleCalendarBusyWindowsReadOnly } from '@/libs/googleCalendar';
import { technicianSupportsPublicLocation } from '@/libs/publicTechnicianCompatibility';
import { getPrimaryLocation, getTechniciansBySalonId } from '@/libs/queries';
import { guardSalonApiRoute } from '@/libs/salonStatus';
import { buildSmartFitDayContext } from '@/libs/smartFitBooking';
import { getDateKeyInTimeZone, getTimeKeyInTimeZone, getZonedDayBounds, isZonedTimeMatch, zonedTimeToUtc } from '@/libs/timeZone';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { salon, error } = await requireAdminSalonFromRequest(request);
  if (error || !salon) {
    return error!;
  }

  const query = new URL(request.url).searchParams;
  const parsedDate = z.string().date().safeParse(query.get('date'));
  if (!parsedDate.success) {
    return Response.json({ error: { message: 'Choose a date.' } }, { status: 400 });
  }

  const date = parsedDate.data;
  const technicianId = query.get('technicianId');
  const config = resolveBookingConfigFromSettings(salon.settings as SalonSettings);
  const timeZone = config.timezone;
  const now = new Date();
  const { startOfDay, endOfDay } = getZonedDayBounds(date, timeZone);
  const response = (openings: CalendarOpening[]) => Response.json({ data: { openings, timeZone } }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });

  try {
    const blocked = await guardSalonApiRoute(salon.id);
    if (blocked) {
      return blocked;
    }
    if (date < getDateKeyInTimeZone(now, timeZone)) {
      return response([]);
    }

    const [location, team] = await Promise.all([
      getPrimaryLocation(salon.id),
      getTechniciansBySalonId(salon.id),
    ]);
    const hours = resolveBookingHoursCeiling({ location, salonBusinessHours: salon.businessHours ?? null });
    const technicians = team.filter(technician =>
      (!technicianId || technician.id === technicianId)
      && technicianSupportsPublicLocation({ technician, locationId: hours.locationId }),
    );
    if (technicians.length === 0) {
      return response([]);
    }

    const [policy, googleBusyWindows] = await Promise.all([
      loadBookingPolicy({ salonId: salon.id, technicianIds: technicians.map(tech => tech.id), date, selectedDate: startOfDay, startOfDay, endOfDay, now }),
      getGoogleCalendarBusyWindowsReadOnly({ salonId: salon.id, startTime: startOfDay, endTime: endOfDay, timeZone, signal: request.signal }),
    ]);
    const starts = getAllSlots(config.slotIntervalMinutes).flatMap((time) => {
      const instant = zonedTimeToUtc({ date, time, timeZone });
      return instant.getTime() >= now.getTime() + config.minimumNoticeMinutes * 60_000
        && isZonedTimeMatch(instant, { date, time, timeZone })
        ? [instant.getTime()]
        : [];
    }).sort((a, b) => a - b);

    const openings = technicians.flatMap((tech) => {
      const context = buildSmartFitDayContext({
        technicianId: tech.id,
        weeklySchedule: tech.weeklySchedule,
        override: policy.overridesByTechnician.get(tech.id),
        isOnTimeOff: policy.timeOffTechnicianIds.has(tech.id),
        appointments: policy.appointmentsByTechnician.get(tech.id) ?? [],
        blockedSlots: policy.blockedSlotsByTechnician.get(tech.id),
        googleBusyWindows,
        locationId: hours.locationId,
        locationBusinessHours: hours.businessHours,
        date,
        timeZone,
        slotIntervalMinutes: config.slotIntervalMinutes,
        gridAnchorMs: startOfDay.getTime(),
        minLeadTimeMinutes: config.minimumNoticeMinutes,
        nowMs: now.getTime(),
      });

      if (!context) {
        return [];
      }
      return findCalendarGaps(
        { startMs: context.workStartMs, endMs: context.workEndMs },
        context.blocks,
        starts,
        config.bufferMinutes + 1,
      ).map(({ startMs, endMs }): CalendarOpening => ({
        technicianId: tech.id,
        technicianName: tech.name,
        date,
        time: getTimeKeyInTimeZone(new Date(startMs), timeZone),
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      }));
    });

    return response(openings.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.technicianName.localeCompare(b.technicianName)));
  } catch {
    return Response.json({ error: { message: 'Could not check the calendar for openings. Try again.' } }, { status: 503 });
  }
}
