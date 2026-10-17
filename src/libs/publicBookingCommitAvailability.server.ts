import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import type { BookingConfig } from '@/libs/bookingConfig.shared';
import { resolveBookingHoursCeiling } from '@/libs/bookingHoursCeiling';
import { canTechnicianTakeAppointment, loadBookingPolicy, resolveTechnicianCapabilityMode } from '@/libs/bookingPolicy';
import { CustomerBookingOperationError } from '@/libs/customerAssistant/operationStore.server';
import type { db } from '@/libs/DB';
import { resolveWeeklySchedule } from '@/libs/weeklySchedule';
import { salonLocationSchema, salonSchema, type Service, serviceSchema, technicianSchema, technicianServicesSchema } from '@/models/Schema';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const REVIEWED_BOOKING_KEYS = ['currency', 'timezone', 'minimumNoticeMinutes', 'bufferMinutes', 'slotIntervalMinutes', 'confirmationMode'] as const;
const REVIEWED_SERVICE_KEYS = ['name', 'price', 'durationMinutes', 'preparationBufferMinutes', 'cleanupBufferMinutes'] as const;

/** Fresh authority for ordinary public bookings, inside the original serialized transaction. */
export async function assertCurrentPublicBookingAvailability(tx: Transaction, input: {
  salonId: string;
  technicianId: string;
  locationId: string | null;
  services: Service[];
  strictServiceAssignments: boolean;
  expectedBooking: BookingConfig;
  currentBooking: BookingConfig;
  startTime: Date;
  blockedEndTime: Date;
  date: string;
  startOfDay: Date;
  endOfDay: Date;
  now: Date;
}) {
  const changed = () => new CustomerBookingOperationError('review_changed');
  const unavailable = () => new CustomerBookingOperationError('slot_unavailable');
  if (REVIEWED_BOOKING_KEYS.some(key => input.expectedBooking[key] !== input.currentBooking[key])) {
    throw changed();
  }
  // The caller already acquired the salon SHARE lock through the existing
  // policy/financial fence. Repeat the allowlisted read on this transaction.
  const [salon] = await tx.select({ businessHours: salonSchema.businessHours, isActive: salonSchema.isActive, publicationStatus: salonSchema.publicationStatus, onlineBookingEnabled: salonSchema.onlineBookingEnabled }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).for('share');
  if (!salon || !salon.isActive || salon.publicationStatus !== 'published' || salon.onlineBookingEnabled === false) {
    throw unavailable();
  }
  const [location] = input.locationId ? await tx.select().from(salonLocationSchema).where(and(eq(salonLocationSchema.id, input.locationId), eq(salonLocationSchema.salonId, input.salonId), eq(salonLocationSchema.isActive, true))).for('share') : [];
  if (input.locationId && !location) {
    throw changed();
  }
  const ceiling = resolveBookingHoursCeiling({ location, salonBusinessHours: salon.businessHours });
  const savedServices = await tx.select().from(serviceSchema).where(and(eq(serviceSchema.salonId, input.salonId), inArray(serviceSchema.id, input.services.map(service => service.id)), eq(serviceSchema.isActive, true))).for('share');
  if (savedServices.length !== input.services.length || input.services.some((service) => {
    const saved = savedServices.find(saved => saved.id === service.id);
    return !saved || REVIEWED_SERVICE_KEYS.some(key => service[key] !== saved[key]);
  })) {
    throw changed();
  }
  const staff = await tx.select().from(technicianSchema).where(and(eq(technicianSchema.salonId, input.salonId), eq(technicianSchema.isActive, true))).for('share');
  const person = staff.find(person => person.id === input.technicianId);
  if (!person) {
    throw unavailable();
  }
  // Include disabled junction rows: their existence intentionally disables the
  // old unrestricted fallback. No customer or private staff data leaves here.
  const assignments = await tx.select({ technicianId: technicianServicesSchema.technicianId, serviceId: technicianServicesSchema.serviceId, enabled: technicianServicesSchema.enabled }).from(technicianServicesSchema).innerJoin(serviceSchema, eq(serviceSchema.id, technicianServicesSchema.serviceId)).where(and(eq(serviceSchema.salonId, input.salonId), inArray(technicianServicesSchema.technicianId, staff.map(person => person.id)))).for('share', { of: technicianServicesSchema });
  const capable = staff.map(person => ({ specialties: person.specialties ?? [], serviceIds: assignments.filter(assignment => assignment.technicianId === person.id).map(assignment => assignment.serviceId), enabledServiceIds: assignments.filter(assignment => assignment.technicianId === person.id && assignment.enabled).map(assignment => assignment.serviceId) }));
  const enabledServiceIds = assignments.filter(assignment => assignment.technicianId === person.id && assignment.enabled).map(assignment => assignment.serviceId);
  const policy = await loadBookingPolicy({ salonId: input.salonId, technicianIds: [person.id], date: input.date, selectedDate: input.startOfDay, startOfDay: input.startOfDay, endOfDay: input.endOfDay, database: tx, now: input.now });
  const decision = canTechnicianTakeAppointment({ startTime: input.startTime, endTime: input.blockedEndTime, weeklySchedule: resolveWeeklySchedule(person), override: policy.overridesByTechnician.get(person.id), isOnTimeOff: policy.timeOffTechnicianIds.has(person.id), blockedSlots: policy.blockedSlotsByTechnician.get(person.id) ?? [], existingAppointments: policy.appointmentsByTechnician.get(person.id) ?? [], requestedServices: savedServices, capabilityMode: input.strictServiceAssignments ? 'service_assignments' : resolveTechnicianCapabilityMode(capable, savedServices), enabledServiceIds, specialties: person.specialties ?? [], locationId: input.locationId, primaryLocationId: person.primaryLocationId, locationBusinessHours: ceiling.businessHours, bufferMinutes: 0 });
  if (!decision.available || input.startTime.getTime() < input.now.getTime() + input.currentBooking.minimumNoticeMinutes * 60000) {
    throw unavailable();
  }
}
