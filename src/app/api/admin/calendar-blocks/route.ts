import { and, asc, eq, gt, isNotNull, lt } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalonFromRequest } from '@/libs/adminAuth';
import { logAuditEvent } from '@/libs/auditLog';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { lockTechnicianAndAssertSlotFree, lockTechnicianSchedule, SlotConflictError } from '@/libs/bookingConflictGuard';
import { calendarBlockInput, resolveCalendarBlockWindow } from '@/libs/calendarBlocks';
import { withClientLifecycleTransactionRetry } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { getZonedDayBounds } from '@/libs/timeZone';
import { technicianBlockedSlotSchema, technicianSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';
const failure = (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status });

export async function GET(request: Request) {
  const { salon, error } = await requireAdminSalonFromRequest(request);
  if (error || !salon) {
    return error!;
  }
  const parsed = z.string().date().safeParse(new URL(request.url).searchParams.get('date'));
  if (!parsed.success) {
    return failure('INVALID_DATE', 'Choose a date.', 400);
  }
  const timeZone = resolveBookingConfigFromSettings(salon.settings as SalonSettings).timezone;
  const bounds = getZonedDayBounds(parsed.data, timeZone);
  const blocks = await db.select().from(technicianBlockedSlotSchema).where(and(
    eq(technicianBlockedSlotSchema.salonId, salon.id),
    lt(technicianBlockedSlotSchema.startsAt, new Date(bounds.endOfDay.getTime() + 1)),
    gt(technicianBlockedSlotSchema.endsAt, bounds.startOfDay),
  )).orderBy(asc(technicianBlockedSlotSchema.startsAt));
  return Response.json({ data: { blocks, timeZone } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function mutate(request: Request, operation: 'create' | 'update' | 'delete') {
  const { salon, admin, error } = await requireAdminSalonFromRequest(request);
  if (error || !salon || !admin) {
    return error!;
  }
  if (salon.deletedAt || ['suspended', 'cancelled'].includes(salon.status ?? '')) {
    return failure('SALON_INACTIVE', 'This salon cannot change its schedule.', 403);
  }
  const body = await request.json().catch(() => null);
  const parsed = operation === 'delete'
    ? z.object({ id: z.string().uuid(), technicianId: z.string().min(1), version: z.string().datetime() }).strict().safeParse(body)
    : calendarBlockInput.safeParse(body);
  if (!parsed.success) {
    return failure('INVALID_BLOCK', 'Check the date, times and technician.', 400);
  }
  const input = parsed.data;
  const timeZone = resolveBookingConfigFromSettings(salon.settings as SalonSettings).timezone;
  let window: { startsAt: Date; endsAt: Date } | null = null;
  if (operation !== 'delete') {
    try {
      window = resolveCalendarBlockWindow(calendarBlockInput.parse(input), timeZone);
    } catch {
      return failure('INVALID_WINDOW', 'Choose a valid start and later end time on the same day, outside any skipped or repeated clock-change hour.', 400);
    }
  }
  const [technician] = await db.select({ id: technicianSchema.id }).from(technicianSchema)
    .where(and(eq(technicianSchema.id, input.technicianId), eq(technicianSchema.salonId, salon.id))).limit(1);
  if (!technician) {
    return failure('NOT_FOUND', 'Technician not found.', 404);
  }
  try {
    const result = await withClientLifecycleTransactionRetry(() => db.transaction(async (tx) => {
      // Booking and block writes serialize on the same technician lock.
      if (window) {
        await lockTechnicianAndAssertSlotFree(tx, {
          salonId: salon.id,
          technicianId: input.technicianId,
          startTime: window.startsAt,
          blockedEndTime: window.endsAt,
          excludedBlockId: input.id,
        });
      } else {
        await lockTechnicianSchedule(tx, salon.id, input.technicianId);
      }
      const [existing] = await tx.select().from(technicianBlockedSlotSchema).where(and(
        eq(technicianBlockedSlotSchema.id, input.id),
        eq(technicianBlockedSlotSchema.salonId, salon.id),
        eq(technicianBlockedSlotSchema.technicianId, input.technicianId),
        isNotNull(technicianBlockedSlotSchema.startsAt),
      )).for('update').limit(1);
      if (operation === 'create' && existing) {
        const draft = calendarBlockInput.parse(input);
        if (existing.startsAt?.getTime() === window!.startsAt.getTime()
          && existing.endsAt?.getTime() === window!.endsAt.getTime() && (existing.label ?? '') === draft.label) {
          return existing;
        }
        throw new Error('STALE');
      }
      if (operation !== 'create' && (!existing || !input.version || existing.updatedAt.toISOString() !== input.version)) {
        throw new Error(existing ? 'STALE' : 'NOT_FOUND');
      }
      if (operation === 'delete') {
        await tx.delete(technicianBlockedSlotSchema).where(and(eq(technicianBlockedSlotSchema.id, input.id), eq(technicianBlockedSlotSchema.salonId, salon.id)));
        return null;
      }
      const draft = calendarBlockInput.parse(input);
      const values = { startTime: draft.startTime, endTime: draft.endTime, label: draft.label || null, ...window!, isRecurring: false, specificDate: null, dayOfWeek: null, updatedAt: new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1)) };
      const [saved] = operation === 'create'
        ? await tx.insert(technicianBlockedSlotSchema).values({ id: input.id, salonId: salon.id, technicianId: input.technicianId, ...values }).returning()
        : await tx.update(technicianBlockedSlotSchema).set(values).where(and(eq(technicianBlockedSlotSchema.id, input.id), eq(technicianBlockedSlotSchema.salonId, salon.id))).returning();
      return saved;
    }));
    await logAuditEvent({ salonId: salon.id, actorType: 'admin', actorId: admin.id, action: 'settings_updated', entityType: 'calendar_block', entityId: input.id, metadata: { operation, technicianId: input.technicianId } });
    return Response.json({ data: { block: result } });
  } catch (cause) {
    if (cause instanceof SlotConflictError) {
      return failure('SLOT_CONFLICT', 'That time overlaps an appointment, its buffer, or another block. Open Calendar to review it.', 409);
    }
    if (cause instanceof Error && cause.message === 'STALE') {
      return failure('STALE_BLOCK', 'This block changed. Refresh before editing it.', 409);
    }
    if (cause instanceof Error && cause.message === 'NOT_FOUND') {
      return failure('NOT_FOUND', 'Block not found. Refresh Calendar.', 404);
    }
    return failure('SAVE_FAILED', 'The block could not be saved. Refresh and try again.', 500);
  }
}
export const POST = (request: Request) => mutate(request, 'create');
export const PATCH = (request: Request) => mutate(request, 'update');
export const DELETE = (request: Request) => mutate(request, 'delete');
