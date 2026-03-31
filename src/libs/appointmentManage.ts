import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import {
  buildBlockedSlotWindow,
  canTechnicianTakeAppointment,
  getTorontoDateString,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
  type RequestedService,
} from '@/libs/bookingPolicy';
import { db } from '@/libs/DB';
import { FIRST_VISIT_DISCOUNT_TYPE } from '@/libs/firstVisitDiscount';
import { getLocationById, getTechnicianById, getTechniciansBySalonId } from '@/libs/queries';
import {
  appointmentAddOnSchema,
  appointmentSchema,
  appointmentServicesSchema,
  salonSchema,
  salonLocationSchema,
  serviceAddOnSchema,
  serviceSchema,
  type AddOnCategory,
  type Appointment,
  type AppointmentAddOn,
  type AppointmentService,
  type Service,
  type ServiceCategory,
} from '@/models/Schema';

export type ManageWarning =
  | 'INVALID_ADD_ONS_REMOVED'
  | 'LEGACY_MULTI_SERVICE_REPLACED';

export class AppointmentManageError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ManageAction =
  | 'move'
  | 'moveToNextAvailable'
  | 'changeService'
  | 'reassignTechnician';

export type ManagePermissions = {
  canMove: boolean;
  canChangeService: boolean;
  canCancel: boolean;
  canMarkCompleted: boolean;
  canStart: boolean;
  canReassignTechnician: boolean;
};

type AppointmentServiceSnapshot = {
  row: AppointmentService;
  liveService: Service | null;
};

type AppointmentAddOnSnapshot = AppointmentAddOn;

type LoadedManagedAppointment = {
  appointment: Appointment;
  appointmentServices: AppointmentServiceSnapshot[];
  appointmentAddOns: AppointmentAddOnSnapshot[];
  salonLocation: {
    id: string;
    name: string;
  } | null;
  activeServices: Service[];
  technicians: Awaited<ReturnType<typeof getTechniciansBySalonId>>;
  slotIntervalMinutes: number;
  bufferMinutes: number;
};

export type AppointmentManageDetail = {
  appointment: {
    id: string;
    salonId: string;
    salonSlug: string;
    clientName: string | null;
    clientPhone: string;
    technicianId: string | null;
    locationId: string | null;
    locationName: string | null;
    status: string;
    startTime: string;
    endTime: string;
    totalPrice: number;
    totalDurationMinutes: number;
    bufferMinutes: number;
    slotIntervalMinutes: number;
    isLocked: boolean;
    lockedAt: string | null;
    paymentStatus: string | null;
    baseServiceId: string | null;
    baseServiceName: string;
    discountType: string | null;
    discountAmountCents: number;
  };
  services: Array<{
    id: string;
    name: string;
    category: ServiceCategory | null;
    priceAtBooking: number;
    durationAtBooking: number;
    isBaseService: boolean;
  }>;
  addOns: Array<{
    id: string;
    addOnId: string | null;
    name: string;
    category: AddOnCategory;
    quantity: number;
    lineTotalCents: number;
    lineDurationMinutes: number;
  }>;
  serviceOptions: Array<{
    id: string;
    name: string;
    category: ServiceCategory;
    priceCents: number;
    durationMinutes: number;
  }>;
  technicianOptions: Array<{
    id: string;
    name: string;
  }>;
  permissions: ManagePermissions;
  warnings: ManageWarning[];
};

export type AppointmentCalendarEvent = {
  id: string;
  clientName: string | null;
  startTime: string;
  endTime: string;
  status: string;
  technicianId: string | null;
  technicianName: string | null;
  serviceLabel: string;
  totalPrice: number;
  totalDurationMinutes: number;
  locationName: string | null;
  isLocked: boolean;
};

type MoveArgs = {
  loaded: LoadedManagedAppointment;
  startTime: Date;
  technicianId?: string | null;
};

type ChangeServiceArgs = {
  loaded: LoadedManagedAppointment;
  baseServiceId: string;
  startTime?: Date;
  technicianId?: string | null;
};

type ReassignArgs = {
  loaded: LoadedManagedAppointment;
  technicianId: string;
};

type NextAvailableArgs = {
  loaded: LoadedManagedAppointment;
};

type MutationResult = {
  appointment: Appointment;
  warnings: ManageWarning[];
};
const SEARCH_DAYS_AHEAD = 14;
const MANAGE_VISIBLE_START_HOUR = 8;
const MANAGE_VISIBLE_END_HOUR = 20;

function getAllSlots(intervalMinutes: number): string[] {
  const slots: string[] = [];
  for (let hour = MANAGE_VISIBLE_START_HOUR; hour <= MANAGE_VISIBLE_END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      if (hour === MANAGE_VISIBLE_END_HOUR && minute > 0) {
        continue;
      }
      slots.push(`${hour}:${minute.toString().padStart(2, '0')}`);
    }
  }
  return slots;
}

function buildPermissions(
  appointment: Appointment,
  canReassignTechnician: boolean,
): ManagePermissions {
  const terminal = ['completed', 'cancelled', 'no_show'].includes(appointment.status);
  const isLocked = Boolean(appointment.lockedAt) || appointment.status === 'in_progress';

  return {
    canMove: !terminal && !isLocked,
    canChangeService: !terminal && !isLocked,
    canCancel: !terminal,
    canMarkCompleted: !terminal && appointment.status !== 'completed',
    canStart: appointment.status === 'confirmed' && !appointment.lockedAt,
    canReassignTechnician: canReassignTechnician && !terminal && !isLocked,
  };
}

function toRequestedServices(
  appointmentServices: AppointmentServiceSnapshot[],
): RequestedService[] {
  return appointmentServices.map(({ row, liveService }) => ({
    id: row.serviceId,
    name: row.nameSnapshot ?? liveService?.name ?? 'Service',
    category: row.categorySnapshot ?? liveService?.category ?? null,
  }));
}

function sumAppointmentServiceSnapshots(appointmentServices: AppointmentServiceSnapshot[]) {
  return appointmentServices.reduce((sum, service) => sum + service.row.priceAtBooking, 0);
}

function sumAddOnLineTotals(appointmentAddOns: AppointmentAddOnSnapshot[]) {
  return appointmentAddOns.reduce((sum, addOn) => sum + addOn.lineTotalCentsSnapshot, 0);
}

function sumAddOnDurations(appointmentAddOns: AppointmentAddOnSnapshot[]) {
  return appointmentAddOns.reduce((sum, addOn) => sum + addOn.lineDurationMinutesSnapshot, 0);
}

function getCurrentSubtotalCents(loaded: LoadedManagedAppointment): number {
  if (typeof loaded.appointment.subtotalBeforeDiscountCents === 'number') {
    return loaded.appointment.subtotalBeforeDiscountCents;
  }

  if (
    typeof loaded.appointment.basePriceCents === 'number'
    || typeof loaded.appointment.addOnsPriceCents === 'number'
  ) {
    return (loaded.appointment.basePriceCents ?? 0) + (loaded.appointment.addOnsPriceCents ?? 0);
  }

  return sumAppointmentServiceSnapshots(loaded.appointmentServices) + sumAddOnLineTotals(loaded.appointmentAddOns);
}

function roundDownToSlot(date: Date, intervalMinutes: number): Date {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const snappedMinutes = Math.floor(minutes / intervalMinutes) * intervalMinutes;
  rounded.setMinutes(snappedMinutes, 0, 0);
  return rounded;
}

function computePreservedDiscount(args: {
  loaded: LoadedManagedAppointment;
  newSubtotalCents: number;
}): {
  totalPrice: number;
  subtotalBeforeDiscountCents: number;
  discountAmountCents: number;
  discountType: string | null;
  discountLabel: string | null;
  discountPercent: number | null;
  discountAppliedAt: Date | null;
} {
  const { loaded, newSubtotalCents } = args;

  if (loaded.appointment.discountType === FIRST_VISIT_DISCOUNT_TYPE) {
    const discountAmountCents = Math.floor(newSubtotalCents * 0.25);
    return {
      totalPrice: Math.max(0, newSubtotalCents - discountAmountCents),
      subtotalBeforeDiscountCents: newSubtotalCents,
      discountAmountCents,
      discountType: FIRST_VISIT_DISCOUNT_TYPE,
      discountLabel: loaded.appointment.discountLabel ?? 'First visit discount',
      discountPercent: loaded.appointment.discountPercent ?? 25,
      discountAppliedAt: loaded.appointment.discountAppliedAt ?? new Date(),
    };
  }

  const currentSubtotalCents = getCurrentSubtotalCents(loaded);
  const preservedDiscountAmount = Math.max(0, currentSubtotalCents - loaded.appointment.totalPrice);

  return {
    totalPrice: Math.max(0, newSubtotalCents - preservedDiscountAmount),
    subtotalBeforeDiscountCents: newSubtotalCents,
    discountAmountCents: preservedDiscountAmount,
    discountType: loaded.appointment.discountType ?? null,
    discountLabel: loaded.appointment.discountLabel ?? null,
    discountPercent: loaded.appointment.discountPercent ?? null,
    discountAppliedAt: loaded.appointment.discountAppliedAt ?? null,
  };
}

function buildCalendarEvent(loaded: LoadedManagedAppointment): AppointmentCalendarEvent {
  const primaryService = loaded.appointmentServices[0];
  const serviceLabel = loaded.appointmentServices
    .map(({ row, liveService }) => row.nameSnapshot ?? liveService?.name ?? 'Service')
    .join(', ');
  const technicianName = loaded.technicians.find(technician => technician.id === loaded.appointment.technicianId)?.name ?? null;

  return {
    id: loaded.appointment.id,
    clientName: loaded.appointment.clientName,
    startTime: loaded.appointment.startTime.toISOString(),
    endTime: loaded.appointment.endTime.toISOString(),
    status: loaded.appointment.status,
    technicianId: loaded.appointment.technicianId,
    technicianName,
    serviceLabel: serviceLabel || primaryService?.liveService?.name || 'Service',
    totalPrice: loaded.appointment.totalPrice,
    totalDurationMinutes: loaded.appointment.totalDurationMinutes,
    locationName: loaded.salonLocation?.name ?? null,
    isLocked: Boolean(loaded.appointment.lockedAt) || loaded.appointment.status === 'in_progress',
  };
}

async function loadManagedAppointment(
  appointmentId: string,
  salonId: string,
): Promise<LoadedManagedAppointment> {
  const [appointment] = await db
    .select()
    .from(appointmentSchema)
    .where(
      and(
        eq(appointmentSchema.id, appointmentId),
        eq(appointmentSchema.salonId, salonId),
      ),
    )
    .limit(1);

  if (!appointment) {
    throw new AppointmentManageError('APPOINTMENT_NOT_FOUND', 'Appointment not found', 404);
  }

  const [
    appointmentServices,
    appointmentAddOns,
    salonLocation,
    activeServices,
    technicians,
    bookingConfig,
  ] = await Promise.all([
    db
      .select({
        row: appointmentServicesSchema,
        liveService: serviceSchema,
      })
      .from(appointmentServicesSchema)
      .leftJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
      .where(eq(appointmentServicesSchema.appointmentId, appointmentId)),
    db
      .select()
      .from(appointmentAddOnSchema)
      .where(eq(appointmentAddOnSchema.appointmentId, appointmentId)),
    appointment.locationId
      ? db
          .select({
            id: salonLocationSchema.id,
            name: salonLocationSchema.name,
          })
          .from(salonLocationSchema)
          .where(eq(salonLocationSchema.id, appointment.locationId))
          .limit(1)
          .then(rows => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(serviceSchema)
      .where(and(eq(serviceSchema.salonId, appointment.salonId), eq(serviceSchema.isActive, true))),
    getTechniciansBySalonId(appointment.salonId),
    getBookingConfigForSalon(appointment.salonId),
  ]);

  return {
    appointment,
    appointmentServices: appointmentServices.map(entry => ({
      row: entry.row,
      liveService: entry.liveService,
    })),
    appointmentAddOns,
    salonLocation,
    activeServices,
    technicians,
    slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
    bufferMinutes: bookingConfig.bufferMinutes,
  };
}

function ensureEditable(appointment: Appointment) {
  if (['completed', 'cancelled', 'no_show'].includes(appointment.status)) {
    throw new AppointmentManageError(
      'APPOINTMENT_NOT_EDITABLE',
      'Completed, cancelled, and no-show appointments cannot be edited.',
      409,
    );
  }

  if (appointment.lockedAt || appointment.status === 'in_progress') {
    throw new AppointmentManageError(
      'APPOINTMENT_LOCKED',
      'Appointments in progress must be finished before changing time, service, or technician.',
      409,
    );
  }
}

async function resolveTechnicianForMutation(args: {
  loaded: LoadedManagedAppointment;
  technicianId?: string | null;
  requireAssigned?: boolean;
}) {
  const technicianId = args.technicianId ?? args.loaded.appointment.technicianId ?? null;
  if (!technicianId) {
    if (args.requireAssigned) {
      throw new AppointmentManageError(
        'TECHNICIAN_REQUIRED',
        'A technician must be assigned before using this action.',
        409,
      );
    }
    return null;
  }

  const technician = await getTechnicianById(technicianId, args.loaded.appointment.salonId);
  if (!technician) {
    throw new AppointmentManageError('TECHNICIAN_NOT_FOUND', 'Technician not found.', 404);
  }

  return technician;
}

async function validateTimeAndTechnician(args: {
  loaded: LoadedManagedAppointment;
  startTime: Date;
  totalDurationMinutes: number;
  bufferMinutes: number;
  technicianId?: string | null;
  requestedServices: RequestedService[];
}) {
  const technician = await resolveTechnicianForMutation({
    loaded: args.loaded,
    technicianId: args.technicianId,
  });

  if (!technician) {
    return {
      technician: null,
      startTime: args.startTime,
      endTime: new Date(args.startTime.getTime() + args.totalDurationMinutes * 60 * 1000),
    };
  }

  const location = args.loaded.appointment.locationId
    ? await getLocationById(args.loaded.appointment.locationId, args.loaded.appointment.salonId)
    : null;

  const dateKey = getTorontoDateString(args.startTime);
  const startOfDay = new Date(`${dateKey}T00:00:00`);
  const endOfDay = new Date(`${dateKey}T23:59:59.999`);
  const bookingPolicy = await loadBookingPolicy({
    salonId: args.loaded.appointment.salonId,
    technicianIds: [technician.id],
    date: dateKey,
    selectedDate: new Date(`${dateKey}T12:00:00`),
    startOfDay,
    endOfDay,
    excludedAppointmentId: args.loaded.appointment.id,
  });

  const endTime = new Date(args.startTime.getTime() + args.totalDurationMinutes * 60 * 1000);
  const capabilityMode = resolveTechnicianCapabilityMode([technician], args.requestedServices);

  const decision = canTechnicianTakeAppointment({
    startTime: args.startTime,
    endTime,
    weeklySchedule: technician.weeklySchedule,
    override: bookingPolicy.overridesByTechnician.get(technician.id),
    isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(technician.id),
    existingAppointments: bookingPolicy.appointmentsByTechnician.get(technician.id) ?? [],
    excludedAppointmentId: args.loaded.appointment.id,
    blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(technician.id) ?? [],
    requestedServices: args.requestedServices,
    capabilityMode,
    enabledServiceIds: technician.enabledServiceIds,
    specialties: technician.specialties,
    locationId: location?.id ?? null,
    primaryLocationId: technician.primaryLocationId,
    locationBusinessHours: location?.businessHours ?? null,
    bufferMinutes: args.bufferMinutes,
  });

  if (!decision.available) {
    throw new AppointmentManageError(
      'APPOINTMENT_CONFLICT',
      'That time is not available for the selected technician.',
      409,
      {
        reason: decision.reason,
        attemptedStartTime: args.startTime.toISOString(),
      },
    );
  }

  return {
    technician,
    startTime: args.startTime,
    endTime,
  };
}

async function findNextAvailableStart(
  loaded: LoadedManagedAppointment,
  technicianId: string,
  requestedServices: RequestedService[],
  totalDurationMinutes: number,
  bufferMinutes: number,
): Promise<Date | null> {
  const technician = await getTechnicianById(technicianId, loaded.appointment.salonId);
  if (!technician) {
    throw new AppointmentManageError('TECHNICIAN_NOT_FOUND', 'Technician not found.', 404);
  }

  const location = loaded.appointment.locationId
    ? await getLocationById(loaded.appointment.locationId, loaded.appointment.salonId)
    : null;
  const capabilityMode = resolveTechnicianCapabilityMode([technician], requestedServices);
  const slots = getAllSlots(loaded.slotIntervalMinutes);
  const searchStart = new Date(loaded.appointment.startTime.getTime() + loaded.slotIntervalMinutes * 60 * 1000);

  for (let offset = 0; offset < SEARCH_DAYS_AHEAD; offset++) {
    const day = new Date(searchStart);
    day.setDate(searchStart.getDate() + offset);
    const dateKey = getTorontoDateString(day);
    const startOfDay = new Date(`${dateKey}T00:00:00`);
    const endOfDay = new Date(`${dateKey}T23:59:59.999`);
    const bookingPolicy = await loadBookingPolicy({
      salonId: loaded.appointment.salonId,
      technicianIds: [technician.id],
      date: dateKey,
      selectedDate: new Date(`${dateKey}T12:00:00`),
      startOfDay,
      endOfDay,
      excludedAppointmentId: loaded.appointment.id,
    });

    for (const slot of slots) {
      const { startTime, endTime } = buildBlockedSlotWindow(
        startOfDay,
        slot,
        totalDurationMinutes,
        bufferMinutes,
      );

      if (startTime <= searchStart) {
        continue;
      }

      const decision = canTechnicianTakeAppointment({
        startTime,
        endTime,
        weeklySchedule: technician.weeklySchedule,
        override: bookingPolicy.overridesByTechnician.get(technician.id),
        isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(technician.id),
        existingAppointments: bookingPolicy.appointmentsByTechnician.get(technician.id) ?? [],
        excludedAppointmentId: loaded.appointment.id,
        blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(technician.id) ?? [],
        requestedServices,
        capabilityMode,
        enabledServiceIds: technician.enabledServiceIds,
        specialties: technician.specialties,
        locationId: location?.id ?? null,
        primaryLocationId: technician.primaryLocationId,
        locationBusinessHours: location?.businessHours ?? null,
        bufferMinutes,
      });

      if (decision.available) {
        return startTime;
      }
    }
  }

  return null;
}

function getChangeServiceAddOnRetention(
  loaded: LoadedManagedAppointment,
  allowedAddOnIds: Set<string>,
) {
  const kept = loaded.appointmentAddOns.filter(addOn => addOn.addOnId && allowedAddOnIds.has(addOn.addOnId));
  const warnings: ManageWarning[] = [];
  if (kept.length !== loaded.appointmentAddOns.length) {
    warnings.push('INVALID_ADD_ONS_REMOVED');
  }
  if (loaded.appointmentServices.length > 1) {
    warnings.push('LEGACY_MULTI_SERVICE_REPLACED');
  }
  return { kept, warnings };
}

export async function getAppointmentManageDetail(args: {
  appointmentId: string;
  salonId: string;
  canReassignTechnician: boolean;
  salonSlug: string;
}): Promise<AppointmentManageDetail> {
  const loaded = await loadManagedAppointment(args.appointmentId, args.salonId);
  const permissions = buildPermissions(loaded.appointment, args.canReassignTechnician);
  const baseService = loaded.appointmentServices[0];

  return {
    appointment: {
      id: loaded.appointment.id,
      salonId: loaded.appointment.salonId,
      salonSlug: args.salonSlug,
      clientName: loaded.appointment.clientName,
      clientPhone: loaded.appointment.clientPhone,
      technicianId: loaded.appointment.technicianId,
      locationId: loaded.appointment.locationId,
      locationName: loaded.salonLocation?.name ?? null,
      status: loaded.appointment.status,
      startTime: loaded.appointment.startTime.toISOString(),
      endTime: loaded.appointment.endTime.toISOString(),
      totalPrice: loaded.appointment.totalPrice,
      totalDurationMinutes: loaded.appointment.totalDurationMinutes,
      bufferMinutes: loaded.appointment.bufferMinutes ?? loaded.bufferMinutes,
      slotIntervalMinutes: loaded.slotIntervalMinutes,
      isLocked: Boolean(loaded.appointment.lockedAt) || loaded.appointment.status === 'in_progress',
      lockedAt: loaded.appointment.lockedAt?.toISOString() ?? null,
      paymentStatus: loaded.appointment.paymentStatus,
      baseServiceId: baseService?.row.serviceId ?? null,
      baseServiceName: baseService?.row.nameSnapshot ?? baseService?.liveService?.name ?? 'Service',
      discountType: loaded.appointment.discountType,
      discountAmountCents: loaded.appointment.discountAmountCents ?? 0,
    },
    services: loaded.appointmentServices.map((entry, index) => ({
      id: entry.row.serviceId,
      name: entry.row.nameSnapshot ?? entry.liveService?.name ?? 'Service',
      category: entry.row.categorySnapshot as ServiceCategory | null ?? entry.liveService?.category ?? null,
      priceAtBooking: entry.row.priceAtBooking,
      durationAtBooking: entry.row.durationAtBooking,
      isBaseService: index === 0,
    })),
    addOns: loaded.appointmentAddOns.map(addOn => ({
      id: addOn.id,
      addOnId: addOn.addOnId,
      name: addOn.nameSnapshot,
      category: addOn.categorySnapshot as AddOnCategory,
      quantity: addOn.quantitySnapshot,
      lineTotalCents: addOn.lineTotalCentsSnapshot,
      lineDurationMinutes: addOn.lineDurationMinutesSnapshot,
    })),
    serviceOptions: loaded.activeServices
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
      .map(service => ({
        id: service.id,
        name: service.name,
        category: service.category,
        priceCents: service.price,
        durationMinutes: service.durationMinutes,
      })),
    technicianOptions: loaded.technicians
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(technician => ({
        id: technician.id,
        name: technician.name,
      })),
    permissions,
    warnings: [],
  };
}

async function mutateMove(args: MoveArgs): Promise<MutationResult> {
  ensureEditable(args.loaded.appointment);
  const requestedServices = toRequestedServices(args.loaded.appointmentServices);
  const totalDurationMinutes = args.loaded.appointment.totalDurationMinutes;
  const bufferMinutes = args.loaded.appointment.bufferMinutes ?? args.loaded.bufferMinutes;
  const normalizedStartTime = roundDownToSlot(args.startTime, args.loaded.slotIntervalMinutes);
  const validated = await validateTimeAndTechnician({
    loaded: args.loaded,
    startTime: normalizedStartTime,
    totalDurationMinutes,
    bufferMinutes,
    technicianId: args.technicianId,
    requestedServices,
  });

  const [appointment] = await db
    .update(appointmentSchema)
    .set({
      technicianId: validated.technician?.id ?? args.loaded.appointment.technicianId,
      startTime: validated.startTime,
      endTime: validated.endTime,
      bufferMinutes,
      blockedDurationMinutes: totalDurationMinutes + bufferMinutes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentSchema.id, args.loaded.appointment.id),
        eq(appointmentSchema.salonId, args.loaded.appointment.salonId),
      ),
    )
    .returning();

  if (!appointment) {
    throw new AppointmentManageError('UPDATE_FAILED', 'Failed to update appointment.', 500);
  }

  return { appointment, warnings: [] };
}

async function mutateReassign(args: ReassignArgs): Promise<MutationResult> {
  ensureEditable(args.loaded.appointment);
  const requestedServices = toRequestedServices(args.loaded.appointmentServices);
  const validated = await validateTimeAndTechnician({
    loaded: args.loaded,
    startTime: args.loaded.appointment.startTime,
    totalDurationMinutes: args.loaded.appointment.totalDurationMinutes,
    bufferMinutes: args.loaded.appointment.bufferMinutes ?? args.loaded.bufferMinutes,
    technicianId: args.technicianId,
    requestedServices,
  });

  const [appointment] = await db
    .update(appointmentSchema)
    .set({
      technicianId: validated.technician?.id ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentSchema.id, args.loaded.appointment.id),
        eq(appointmentSchema.salonId, args.loaded.appointment.salonId),
      ),
    )
    .returning();

  if (!appointment) {
    throw new AppointmentManageError('UPDATE_FAILED', 'Failed to update appointment.', 500);
  }

  return { appointment, warnings: [] };
}

async function mutateMoveToNextAvailable(args: NextAvailableArgs): Promise<MutationResult> {
  ensureEditable(args.loaded.appointment);
  const technicianId = args.loaded.appointment.technicianId;
  if (!technicianId) {
    throw new AppointmentManageError(
      'TECHNICIAN_REQUIRED',
      'Assign a technician before using next available.',
      409,
    );
  }

  const requestedServices = toRequestedServices(args.loaded.appointmentServices);
  const totalDurationMinutes = args.loaded.appointment.totalDurationMinutes;
  const bufferMinutes = args.loaded.appointment.bufferMinutes ?? args.loaded.bufferMinutes;
  const nextStart = await findNextAvailableStart(
    args.loaded,
    technicianId,
    requestedServices,
    totalDurationMinutes,
    bufferMinutes,
  );

  if (!nextStart) {
    throw new AppointmentManageError(
      'NO_NEXT_AVAILABLE_SLOT',
      'No next available slot was found for this technician.',
      409,
    );
  }

  return mutateMove({
    loaded: args.loaded,
    startTime: nextStart,
  });
}

async function mutateChangeService(args: ChangeServiceArgs): Promise<MutationResult> {
  ensureEditable(args.loaded.appointment);

  const [newService] = await db
    .select()
    .from(serviceSchema)
    .where(
      and(
        eq(serviceSchema.id, args.baseServiceId),
        eq(serviceSchema.salonId, args.loaded.appointment.salonId),
        eq(serviceSchema.isActive, true),
      ),
    )
    .limit(1);

  if (!newService) {
    throw new AppointmentManageError('INVALID_BASE_SERVICE', 'Service not found.', 404);
  }

  const allowedRules = await db
    .select({ addOnId: serviceAddOnSchema.addOnId })
    .from(serviceAddOnSchema)
    .where(
      and(
        eq(serviceAddOnSchema.salonId, args.loaded.appointment.salonId),
        eq(serviceAddOnSchema.serviceId, newService.id),
      ),
    );
  const allowedAddOnIds = new Set(allowedRules.map(rule => rule.addOnId));
  const { kept, warnings } = getChangeServiceAddOnRetention(args.loaded, allowedAddOnIds);

  const newBasePriceCents = newService.price;
  const newBaseDurationMinutes = newService.durationMinutes;
  const preservedAddOnPriceCents = sumAddOnLineTotals(kept);
  const preservedAddOnDurationMinutes = sumAddOnDurations(kept);
  const totalDurationMinutes = newBaseDurationMinutes + preservedAddOnDurationMinutes;
  const bufferMinutes = args.loaded.bufferMinutes;
  const newSubtotalCents = newBasePriceCents + preservedAddOnPriceCents;
  const discount = computePreservedDiscount({
    loaded: args.loaded,
    newSubtotalCents,
  });
  const requestedServices: RequestedService[] = [{
    id: newService.id,
    name: newService.name,
    category: newService.category,
  }];

  const startTime = roundDownToSlot(
    args.startTime ?? args.loaded.appointment.startTime,
    args.loaded.slotIntervalMinutes,
  );

  await validateTimeAndTechnician({
    loaded: args.loaded,
    startTime,
    totalDurationMinutes,
    bufferMinutes,
    technicianId: args.technicianId,
    requestedServices,
  });

  const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000);

  const [appointment] = await db.transaction(async (tx) => {
    await tx
      .delete(appointmentServicesSchema)
      .where(eq(appointmentServicesSchema.appointmentId, args.loaded.appointment.id));

    await tx
      .insert(appointmentServicesSchema)
      .values({
        id: `appt_service_${crypto.randomUUID()}`,
        appointmentId: args.loaded.appointment.id,
        serviceId: newService.id,
        priceAtBooking: newService.price,
        durationAtBooking: newService.durationMinutes,
        nameSnapshot: newService.name,
        categorySnapshot: newService.category,
        priceCentsSnapshot: newService.price,
        durationMinutesSnapshot: newService.durationMinutes,
        priceDisplayTextSnapshot: newService.priceDisplayText,
        resolvedIntroPriceLabelSnapshot: null,
      });

    await tx
      .delete(appointmentAddOnSchema)
      .where(eq(appointmentAddOnSchema.appointmentId, args.loaded.appointment.id));

    if (kept.length > 0) {
      await tx
        .insert(appointmentAddOnSchema)
        .values(kept.map(addOn => ({
          id: `appointment_add_on_${crypto.randomUUID()}`,
          appointmentId: args.loaded.appointment.id,
          addOnId: addOn.addOnId,
          quantitySnapshot: addOn.quantitySnapshot,
          nameSnapshot: addOn.nameSnapshot,
          categorySnapshot: addOn.categorySnapshot,
          pricingTypeSnapshot: addOn.pricingTypeSnapshot,
          unitPriceCentsSnapshot: addOn.unitPriceCentsSnapshot,
          durationMinutesSnapshot: addOn.durationMinutesSnapshot,
          lineTotalCentsSnapshot: addOn.lineTotalCentsSnapshot,
          lineDurationMinutesSnapshot: addOn.lineDurationMinutesSnapshot,
        })));
    }

    const [updatedAppointment] = await tx
      .update(appointmentSchema)
      .set({
        technicianId: args.technicianId ?? args.loaded.appointment.technicianId,
        startTime,
        endTime,
        totalPrice: discount.totalPrice,
        totalDurationMinutes,
        basePriceCents: newBasePriceCents,
        addOnsPriceCents: preservedAddOnPriceCents,
        baseDurationMinutes: newBaseDurationMinutes,
        addOnsDurationMinutes: preservedAddOnDurationMinutes,
        bufferMinutes,
        blockedDurationMinutes: totalDurationMinutes + bufferMinutes,
        subtotalBeforeDiscountCents: discount.subtotalBeforeDiscountCents,
        discountAmountCents: discount.discountAmountCents,
        discountType: discount.discountType,
        discountLabel: discount.discountLabel,
        discountPercent: discount.discountPercent,
        discountAppliedAt: discount.discountAppliedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointmentSchema.id, args.loaded.appointment.id),
          eq(appointmentSchema.salonId, args.loaded.appointment.salonId),
        ),
      )
      .returning();

    if (!updatedAppointment) {
      throw new AppointmentManageError('UPDATE_FAILED', 'Failed to update appointment.', 500);
    }

    return [updatedAppointment] as const;
  });

  return { appointment, warnings };
}

export async function runAppointmentManageMutation(args: {
  appointmentId: string;
  salonId: string;
  operation: ManageAction;
  startTime?: Date;
  baseServiceId?: string;
  technicianId?: string | null;
  canReassignTechnician: boolean;
}): Promise<{
  detail: AppointmentManageDetail;
  calendarEvent: AppointmentCalendarEvent;
  warnings: ManageWarning[];
}> {
  const loaded = await loadManagedAppointment(args.appointmentId, args.salonId);
  let result: MutationResult;

  switch (args.operation) {
    case 'move':
      if (!args.startTime) {
        throw new AppointmentManageError('START_TIME_REQUIRED', 'A new start time is required.', 400);
      }
      result = await mutateMove({
        loaded,
        startTime: args.startTime,
        technicianId: args.technicianId,
      });
      break;
    case 'moveToNextAvailable':
      result = await mutateMoveToNextAvailable({ loaded });
      break;
    case 'changeService':
      if (!args.baseServiceId) {
        throw new AppointmentManageError('BASE_SERVICE_REQUIRED', 'A service is required.', 400);
      }
      result = await mutateChangeService({
        loaded,
        baseServiceId: args.baseServiceId,
        startTime: args.startTime,
        technicianId: args.technicianId,
      });
      break;
    case 'reassignTechnician':
      if (!args.technicianId) {
        throw new AppointmentManageError('TECHNICIAN_REQUIRED', 'A technician is required.', 400);
      }
      result = await mutateReassign({
        loaded,
        technicianId: args.technicianId,
      });
      break;
    default:
      throw new AppointmentManageError('INVALID_OPERATION', 'Unsupported appointment action.', 400);
  }

  const [salon] = await db
    .select({ slug: salonSchema.slug })
    .from(salonSchema)
    .where(eq(salonSchema.id, result.appointment.salonId))
    .limit(1);

  const detail = await getAppointmentManageDetail({
    appointmentId: result.appointment.id,
    salonId: result.appointment.salonId,
    canReassignTechnician: args.canReassignTechnician,
    salonSlug: salon?.slug ?? '',
  });
  const reloaded = await loadManagedAppointment(
    result.appointment.id,
    result.appointment.salonId,
  );

  return {
    detail,
    calendarEvent: buildCalendarEvent(reloaded),
    warnings: result.warnings,
  };
}
