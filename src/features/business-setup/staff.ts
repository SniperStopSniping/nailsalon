import { resolveWeeklySchedule } from '@/libs/weeklySchedule';
import type { technicianSchema } from '@/models/Schema';

import { hoursSchema, type SetupStaff, WEEKDAYS } from './contracts';

type Technician = typeof technicianSchema.$inferSelect;
export function setupStaffFromSnapshot(staff: Technician[], assignments: { technicianId: string; serviceId: string; enabled: boolean | null }[]): SetupStaff[] {
  return staff.map((person) => {
    const schedule = resolveWeeklySchedule(person);
    const hours = schedule ? hoursSchema.safeParse(Object.fromEntries(WEEKDAYS.map(day => [day, schedule[day] ? { open: schedule[day]!.start.padStart(5, '0'), close: schedule[day]!.end.padStart(5, '0') } : null]))) : null;
    const linked = assignments.filter(assignment => assignment.technicianId === person.id);
    return { id: person.id, name: person.name, isActive: person.isActive === true, hours: hours?.success ? hours.data : null, serviceIds: linked.filter(assignment => assignment.enabled).map(assignment => assignment.serviceId).sort(), assignmentMode: linked.length ? 'explicit' : 'preserve' };
  });
}
export function setupStaffSchedule(person: Pick<SetupStaff, 'hours'>) {
  return person.hours ? Object.fromEntries(WEEKDAYS.map(day => [day, person.hours![day] ? { start: person.hours![day]!.open, end: person.hours![day]!.close } : null])) : null;
}
