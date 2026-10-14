import 'server-only';

import { computeDaySlots } from '@/libs/availability/engine.server';
import { resolvePublicTechnicianCapabilityMode } from '@/libs/publicTechnicianCompatibility';
import { getDateKeyInTimeZone } from '@/libs/timeZone';

import type { SetupDocument } from './contracts';
import { WEEKDAYS } from './contracts';
import type { readSetupSnapshot } from './drafts.server';

type Snapshot = Awaited<ReturnType<typeof readSetupSnapshot>>;
/**
 * Uses the original availability engine without reading customer data or
 * fetching calendar integrations. Results are explicitly simulated.
 */
export function setupPreviewBooking(document: SetupDocument, snapshot: Pick<Snapshot, 'staff' | 'assignments'>, now = new Date()) {
  const technicians = snapshot.staff.filter(t => t.isActive).map(t => ({
    id: t.id,
    name: t.name,
    imageUrl: t.avatarUrl,
    rating: t.rating ? Number(t.rating) : null,
    reviewCount: t.reviewCount ?? 0,
    weeklySchedule: t.weeklySchedule,
    primaryLocationId: t.primaryLocationId,
    specialties: t.specialties,
    enabledServiceIds: snapshot.assignments.filter(a => a.technicianId === t.id && a.enabled).map(a => a.serviceId),
    serviceIds: snapshot.assignments.filter(a => a.technicianId === t.id).map(a => a.serviceId),
  }));
  if (!snapshot.staff.length && document.business.workMode === 'solo') {
    technicians.push({ id: 'setup_preview_owner', name: document.business.name, imageUrl: null, rating: null, reviewCount: 0, specialties: [], primaryLocationId: null, weeklySchedule: Object.fromEntries(WEEKDAYS.map(day => [day, document.hours[day] ? { start: document.hours[day]!.open, end: document.hours[day]!.close } : null])), enabledServiceIds: document.services.map(s => s.id), serviceIds: document.services.map(s => s.id) });
  }
  const service = document.services.find(s => s.durationMinutes !== null && s.priceCents !== null);
  const examples: { date: string; times: string[] }[] = [];
  if (service) {
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = getDateKeyInTimeZone(new Date(now.getTime() + offset * 86400000), document.booking.timezone);
      const result = computeDaySlots({ date, technicians, requestedServices: [service], capabilityMode: resolvePublicTechnicianCapabilityMode(technicians, [service]), bookingPolicy: { appointmentsByTechnician: new Map(), overridesByTechnician: new Map(), timeOffTechnicianIds: new Set(), blockedSlotsByTechnician: new Map() }, googleBusyWindows: [], hoursCeiling: { locationId: null, businessHours: document.hours, source: 'salon' }, effectiveLocationId: null, visibleDurationMinutes: service.durationMinutes! + service.preparationBufferMinutes + service.cleanupBufferMinutes, bufferMinutes: document.booking.bufferMinutes, slotIntervalMinutes: document.booking.slotIntervalMinutes, minimumNoticeMinutes: document.booking.minimumNoticeMinutes, timeZone: document.booking.timezone, now, excludedAppointmentId: null });
      const times = result.slots.filter(slot => slot.availability === 'available').map(slot => slot.time);
      if (times.length) {
        examples.push({ date, times: times.slice(0, 4) });
      }
      if (examples.length === 2) {
        break;
      }
    }
  }
  return { technicians, service, examples };
}
