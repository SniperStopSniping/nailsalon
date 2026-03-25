import { and, eq, gte, inArray, lt, lte, ne } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { normalizeScheduleDay } from '@/libs/weeklySchedule';
import {
  appointmentSchema,
  technicianBlockedSlotSchema,
  technicianScheduleOverrideSchema,
  technicianTimeOffSchema,
  type WeeklySchedule,
} from '@/models/Schema';

export const BUFFER_MINUTES = 10;
export const TORONTO_TZ = 'America/Toronto';

const DAY_NAMES: (keyof WeeklySchedule)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export type ScheduleDay = { start: string; end: string };

export type ScheduleOverride = {
  technicianId: string;
  type: string;
  startTime: string | null;
  endTime: string | null;
};

export type AppointmentWindow = {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
};

export type BlockedSlotWindow = {
  startTime: string;
  endTime: string;
  label: string | null;
};

export type BusinessHours = {
  sunday?: { open: string; close: string } | null;
  monday?: { open: string; close: string } | null;
  tuesday?: { open: string; close: string } | null;
  wednesday?: { open: string; close: string } | null;
  thursday?: { open: string; close: string } | null;
  friday?: { open: string; close: string } | null;
  saturday?: { open: string; close: string } | null;
} | null;

export type RequestedService = {
  id: string;
  name?: string | null;
  category?: string | null;
};

export type BookingPolicyTechnician = {
  id: string;
  weeklySchedule: WeeklySchedule | null;
  enabledServiceIds?: string[];
  serviceIds?: string[];
  specialties?: string[] | null;
  primaryLocationId?: string | null;
};

export type TechnicianCapabilityMode =
  | 'service_assignments'
  | 'specialty_fallback'
  | 'unrestricted';

export type LoadedBookingPolicy = {
  appointmentsByTechnician: Map<string, AppointmentWindow[]>;
  overridesByTechnician: Map<string, ScheduleOverride>;
  timeOffTechnicianIds: Set<string>;
  blockedSlotsByTechnician: Map<string, BlockedSlotWindow[]>;
};

export type TechnicianBookingDecision =
  | { available: true; schedule: ScheduleDay }
  | {
    available: false;
    reason:
      | 'time_off'
      | 'day_off'
      | 'outside_schedule'
      | 'time_conflict'
      | 'blocked_slot'
      | 'service_unsupported'
      | 'location_unavailable';
  };

function isMissingRelationError(error: unknown, relationName: string): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message)
    : '';

  return code === '42P01' || message.includes(`relation "${relationName}" does not exist`);
}

function warnMissingRelation(relationName: string) {
  console.warn(
    `[BookingPolicy] Missing relation "${relationName}". Treating it as empty. Run \`npm run db:migrate:dev\` for the local database.`,
  );
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function getTorontoDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

function getTorontoDate(date: Date): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: TORONTO_TZ }));
}

export function getDayNameForDate(date: Date): keyof WeeklySchedule {
  const torontoDate = getTorontoDate(date);
  return DAY_NAMES[torontoDate.getDay()]!;
}

function getTorontoDayIndex(date: Date): number {
  return getTorontoDate(date).getDay();
}

export function timeStringToMinutes(time: string): number {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function buildSlotWindow(
  date: Date,
  slotTime: string,
  durationMinutes: number,
): { startTime: Date; endTime: Date } {
  const [hours = 0, minutes = 0] = slotTime.split(':').map(Number);
  const startTime = new Date(date);
  startTime.setHours(hours, minutes, 0, 0);

  return {
    startTime,
    endTime: new Date(startTime.getTime() + durationMinutes * 60 * 1000),
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function specialtyMatchesService(specialty: string, service: RequestedService): boolean {
  const normalizedSpecialty = normalizeText(specialty);
  const normalizedServiceName = normalizeText(service.name ?? '');
  const normalizedCategory = normalizeText(service.category ?? '');

  if (!normalizedSpecialty) {
    return false;
  }

  if (normalizedCategory && normalizedSpecialty === normalizedCategory) {
    return true;
  }

  if (normalizedServiceName) {
    return normalizedSpecialty === normalizedServiceName
      || normalizedSpecialty.includes(normalizedServiceName)
      || normalizedServiceName.includes(normalizedSpecialty);
  }

  return false;
}

export function resolveTechnicianCapabilityMode(
  technicians: Array<Pick<BookingPolicyTechnician, 'enabledServiceIds' | 'serviceIds' | 'specialties'>>,
  requestedServices: RequestedService[],
): TechnicianCapabilityMode {
  if (requestedServices.length === 0) {
    return 'unrestricted';
  }

  const hasStructuredAssignments = technicians.some(
    tech => (tech.enabledServiceIds?.length ?? 0) > 0 || (tech.serviceIds?.length ?? 0) > 0,
  );
  if (hasStructuredAssignments) {
    return 'service_assignments';
  }

  const hasCompleteSpecialties = technicians.length > 0
    && technicians.every(tech => (tech.specialties?.length ?? 0) > 0);

  return hasCompleteSpecialties ? 'specialty_fallback' : 'unrestricted';
}

export function technicianCanPerformServices(args: {
  technician: Pick<BookingPolicyTechnician, 'enabledServiceIds' | 'specialties'>;
  requestedServices: RequestedService[];
  capabilityMode: TechnicianCapabilityMode;
}): boolean {
  const { technician, requestedServices, capabilityMode } = args;

  if (requestedServices.length === 0 || capabilityMode === 'unrestricted') {
    return true;
  }

  if (capabilityMode === 'service_assignments') {
    const enabledServiceIds = new Set(technician.enabledServiceIds ?? []);
    return requestedServices.every(service => enabledServiceIds.has(service.id));
  }

  const specialties = technician.specialties ?? [];
  return requestedServices.every(service =>
    specialties.some(specialty => specialtyMatchesService(specialty, service)),
  );
}

export function technicianSupportsLocation(args: {
  technician: Pick<BookingPolicyTechnician, 'primaryLocationId'>;
  locationId?: string | null;
}): boolean {
  const { technician, locationId } = args;

  if (!locationId) {
    return true;
  }

  return !technician.primaryLocationId || technician.primaryLocationId === locationId;
}

export function getEffectiveScheduleForWindow(args: {
  startTime: Date;
  weeklySchedule: WeeklySchedule | null;
  override?: ScheduleOverride | null;
  isOnTimeOff?: boolean;
}): { available: false; reason: 'time_off' | 'day_off' } | { available: true; schedule: ScheduleDay } {
  const { startTime, weeklySchedule, override, isOnTimeOff = false } = args;

  if (isOnTimeOff) {
    return { available: false, reason: 'time_off' };
  }

  if (override?.type === 'off') {
    return { available: false, reason: 'day_off' };
  }

  if (override?.type === 'hours' && override.startTime && override.endTime) {
    const overrideSchedule = normalizeScheduleDay({
      start: override.startTime,
      end: override.endTime,
    });

    if (!overrideSchedule) {
      return { available: false, reason: 'day_off' };
    }

    return {
      available: true,
      schedule: overrideSchedule,
    };
  }

  if (!weeklySchedule) {
    return { available: false, reason: 'day_off' };
  }

  const dayName = getDayNameForDate(startTime);
  const daySchedule = normalizeScheduleDay(weeklySchedule[dayName]);

  if (!daySchedule) {
    return { available: false, reason: 'day_off' };
  }

  return { available: true, schedule: daySchedule };
}

export function isWindowWithinSchedule(
  startTime: Date,
  endTime: Date,
  schedule: ScheduleDay,
): boolean {
  const startInToronto = getTorontoDate(startTime);
  const endInToronto = getTorontoDate(endTime);

  const scheduleStartMinutes = timeStringToMinutes(schedule.start);
  const scheduleEndMinutes = timeStringToMinutes(schedule.end);
  const startMinutes = startInToronto.getHours() * 60 + startInToronto.getMinutes();
  const endMinutes = endInToronto.getHours() * 60 + endInToronto.getMinutes();

  return startMinutes >= scheduleStartMinutes && endMinutes <= scheduleEndMinutes;
}

function getLocationScheduleForWindow(
  startTime: Date,
  locationBusinessHours: BusinessHours,
): ScheduleDay | null {
  if (!locationBusinessHours) {
    return null;
  }

  const dayName = getDayNameForDate(startTime);
  const hours = locationBusinessHours[dayName];

  if (!hours) {
    return null;
  }

  return {
    start: hours.open,
    end: hours.close,
  };
}

export function hasBlockedSlotConflict(args: {
  startTime: Date;
  endTime: Date;
  blockedSlots: BlockedSlotWindow[];
}): boolean {
  const { startTime, endTime, blockedSlots } = args;
  const startInToronto = getTorontoDate(startTime);
  const endInToronto = getTorontoDate(endTime);
  const startMinutes = startInToronto.getHours() * 60 + startInToronto.getMinutes();
  const endMinutes = endInToronto.getHours() * 60 + endInToronto.getMinutes();

  return blockedSlots.some((blockedSlot) => {
    const blockedStartMinutes = timeStringToMinutes(blockedSlot.startTime);
    const blockedEndMinutes = timeStringToMinutes(blockedSlot.endTime);

    return startMinutes < blockedEndMinutes && endMinutes > blockedStartMinutes;
  });
}

export function hasBufferedConflict(args: {
  startTime: Date;
  endTime: Date;
  existingAppointments: AppointmentWindow[];
  excludedAppointmentId?: string | null;
}): boolean {
  const { startTime, endTime, existingAppointments, excludedAppointmentId } = args;
  const requestedEndWithBuffer = new Date(endTime.getTime() + BUFFER_MINUTES * 60 * 1000);

  return existingAppointments.some((existing) => {
    if (excludedAppointmentId && existing.id === excludedAppointmentId) {
      return false;
    }

    const existingStart = toDate(existing.startTime);
    const existingEnd = toDate(existing.endTime);
    const existingEndWithBuffer = new Date(existingEnd.getTime() + BUFFER_MINUTES * 60 * 1000);

    return startTime < existingEndWithBuffer && requestedEndWithBuffer > existingStart;
  });
}

export function canTechnicianTakeAppointment(args: {
  startTime: Date;
  endTime: Date;
  weeklySchedule: WeeklySchedule | null;
  override?: ScheduleOverride | null;
  isOnTimeOff?: boolean;
  existingAppointments: AppointmentWindow[];
  excludedAppointmentId?: string | null;
  blockedSlots?: BlockedSlotWindow[];
  requestedServices?: RequestedService[];
  capabilityMode?: TechnicianCapabilityMode;
  enabledServiceIds?: string[];
  specialties?: string[] | null;
  locationId?: string | null;
  primaryLocationId?: string | null;
  locationBusinessHours?: BusinessHours;
}): TechnicianBookingDecision {
  const {
    startTime,
    endTime,
    weeklySchedule,
    override,
    isOnTimeOff = false,
    existingAppointments,
    excludedAppointmentId,
    blockedSlots = [],
    requestedServices = [],
    capabilityMode = 'unrestricted',
    enabledServiceIds = [],
    specialties = [],
    locationId = null,
    primaryLocationId = null,
    locationBusinessHours = null,
  } = args;

  if (!technicianCanPerformServices({
    technician: { enabledServiceIds, specialties },
    requestedServices,
    capabilityMode,
  })) {
    return { available: false, reason: 'service_unsupported' };
  }

  if (!technicianSupportsLocation({
    technician: { primaryLocationId },
    locationId,
  })) {
    return { available: false, reason: 'location_unavailable' };
  }

  const effectiveSchedule = getEffectiveScheduleForWindow({
    startTime,
    weeklySchedule,
    override,
    isOnTimeOff,
  });

  if (!effectiveSchedule.available) {
    return effectiveSchedule;
  }

  if (!isWindowWithinSchedule(startTime, endTime, effectiveSchedule.schedule)) {
    return { available: false, reason: 'outside_schedule' };
  }

  const locationSchedule = getLocationScheduleForWindow(startTime, locationBusinessHours);
  if (locationBusinessHours && !locationSchedule) {
    return { available: false, reason: 'location_unavailable' };
  }

  if (locationSchedule && !isWindowWithinSchedule(startTime, endTime, locationSchedule)) {
    return { available: false, reason: 'location_unavailable' };
  }

  if (hasBlockedSlotConflict({ startTime, endTime, blockedSlots })) {
    return { available: false, reason: 'blocked_slot' };
  }

  if (hasBufferedConflict({
    startTime,
    endTime,
    existingAppointments,
    excludedAppointmentId,
  })) {
    return { available: false, reason: 'time_conflict' };
  }

  return {
    available: true,
    schedule: effectiveSchedule.schedule,
  };
}

export async function loadBookingPolicy(args: {
  salonId: string;
  technicianIds: string[];
  date: string;
  selectedDate: Date;
  startOfDay: Date;
  endOfDay: Date;
  excludedAppointmentId?: string | null;
}): Promise<LoadedBookingPolicy> {
  const {
    salonId,
    technicianIds,
    date,
    selectedDate,
    startOfDay,
    endOfDay,
    excludedAppointmentId,
  } = args;

  if (technicianIds.length === 0) {
    return {
      appointmentsByTechnician: new Map(),
      overridesByTechnician: new Map(),
      timeOffTechnicianIds: new Set(),
      blockedSlotsByTechnician: new Map(),
    };
  }

  const overrides = await db
    .select({
      technicianId: technicianScheduleOverrideSchema.technicianId,
      type: technicianScheduleOverrideSchema.type,
      startTime: technicianScheduleOverrideSchema.startTime,
      endTime: technicianScheduleOverrideSchema.endTime,
    })
    .from(technicianScheduleOverrideSchema)
    .where(
      and(
        eq(technicianScheduleOverrideSchema.salonId, salonId),
        inArray(technicianScheduleOverrideSchema.technicianId, technicianIds),
        eq(technicianScheduleOverrideSchema.date, date),
      ),
    );

  let timeOffRows: Array<{ technicianId: string }> = [];
  try {
    timeOffRows = await db
      .select({ technicianId: technicianTimeOffSchema.technicianId })
      .from(technicianTimeOffSchema)
      .where(
        and(
          eq(technicianTimeOffSchema.salonId, salonId),
          inArray(technicianTimeOffSchema.technicianId, technicianIds),
          lte(technicianTimeOffSchema.startDate, selectedDate),
          gte(technicianTimeOffSchema.endDate, selectedDate),
        ),
      );
  } catch (error) {
    if (!isMissingRelationError(error, 'technician_time_off')) {
      throw error;
    }

    warnMissingRelation('technician_time_off');
  }

  let blockedSlotRows: Array<{
    technicianId: string;
    dayOfWeek: number | null;
    startTime: string;
    endTime: string;
    specificDate: Date | null;
    label: string | null;
    isRecurring: boolean | null;
  }> = [];
  try {
    blockedSlotRows = await db
      .select({
        technicianId: technicianBlockedSlotSchema.technicianId,
        dayOfWeek: technicianBlockedSlotSchema.dayOfWeek,
        startTime: technicianBlockedSlotSchema.startTime,
        endTime: technicianBlockedSlotSchema.endTime,
        specificDate: technicianBlockedSlotSchema.specificDate,
        label: technicianBlockedSlotSchema.label,
        isRecurring: technicianBlockedSlotSchema.isRecurring,
      })
      .from(technicianBlockedSlotSchema)
      .where(
        and(
          eq(technicianBlockedSlotSchema.salonId, salonId),
          inArray(technicianBlockedSlotSchema.technicianId, technicianIds),
        ),
      );
  } catch (error) {
    if (!isMissingRelationError(error, 'technician_blocked_slot')) {
      throw error;
    }

    warnMissingRelation('technician_blocked_slot');
  }

  const appointmentConditions = [
    eq(appointmentSchema.salonId, salonId),
    inArray(appointmentSchema.technicianId, technicianIds),
    gte(appointmentSchema.startTime, startOfDay),
    lt(appointmentSchema.startTime, endOfDay),
    inArray(appointmentSchema.status, ['pending', 'confirmed']),
  ];

  if (excludedAppointmentId) {
    appointmentConditions.push(ne(appointmentSchema.id, excludedAppointmentId));
  }

  const appointments = await db
    .select({
      id: appointmentSchema.id,
      technicianId: appointmentSchema.technicianId,
      startTime: appointmentSchema.startTime,
      endTime: appointmentSchema.endTime,
    })
    .from(appointmentSchema)
    .where(and(...appointmentConditions));

  const overridesByTechnician = new Map<string, ScheduleOverride>();
  for (const override of overrides) {
    overridesByTechnician.set(override.technicianId, override);
  }

  const timeOffTechnicianIds = new Set(timeOffRows.map(row => row.technicianId));
  const selectedDateString = getTorontoDateString(selectedDate);
  const selectedDayIndex = getTorontoDayIndex(selectedDate);

  const appointmentsByTechnician = new Map<string, AppointmentWindow[]>();
  for (const appointment of appointments) {
    if (!appointment.technicianId) {
      continue;
    }

    const existing = appointmentsByTechnician.get(appointment.technicianId) ?? [];
    existing.push({
      id: appointment.id,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
    });
    appointmentsByTechnician.set(appointment.technicianId, existing);
  }

  const blockedSlotsByTechnician = new Map<string, BlockedSlotWindow[]>();
  for (const blockedSlot of blockedSlotRows) {
    const recurringMatch = blockedSlot.isRecurring !== false
      && blockedSlot.dayOfWeek !== null
      && blockedSlot.dayOfWeek === selectedDayIndex;
    const specificDateMatch = blockedSlot.specificDate
      ? getTorontoDateString(new Date(blockedSlot.specificDate)) === selectedDateString
      : false;

    if (!recurringMatch && !specificDateMatch) {
      continue;
    }

    const existing = blockedSlotsByTechnician.get(blockedSlot.technicianId) ?? [];
    existing.push({
      startTime: blockedSlot.startTime,
      endTime: blockedSlot.endTime,
      label: blockedSlot.label,
    });
    blockedSlotsByTechnician.set(blockedSlot.technicianId, existing);
  }

  return {
    appointmentsByTechnician,
    overridesByTechnician,
    timeOffTechnicianIds,
    blockedSlotsByTechnician,
  };
}
