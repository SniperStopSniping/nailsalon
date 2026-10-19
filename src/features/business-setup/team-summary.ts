import { type SetupService, type SetupStaff, WEEKDAYS } from './contracts';

export function teamReviewValue(value: unknown, services: SetupService[]) {
  if (!Array.isArray(value) || !value.length) {
    return 'No team profiles in this draft';
  }
  return (value as SetupStaff[]).map(person => `${person.name}: ${person.isActive ? 'accepting bookings' : 'bookings off'}; ${person.assignmentMode === 'preserve' ? 'current booking eligibility kept' : person.serviceIds.map(id => services.find(service => service.id === id)?.name ?? 'Previously saved service').join(', ') || 'no assigned services'}; ${person.hours ? WEEKDAYS.map(day => `${day}: ${person.hours![day] ? `${person.hours![day]!.open}–${person.hours![day]!.close}` : 'off'}`).join(', ') : 'current schedule kept'}`).join('\n');
}

export const TEAM_BOOKING_IMPACT = 'Team schedules and service choices affect new bookings after publishing. Existing appointments keep their staff, prices and times, including appointments outside the new schedule. Check your calendar if you need to arrange a change with a customer.';
