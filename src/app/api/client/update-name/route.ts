/**
 * Update Client Name API Route
 *
 * Upserts a client record with their first name.
 * Also updates the client's appointment name history and atomically schedules
 * Calendar refreshes for live appointments.
 *
 * POST /api/client/update-name
 * Body: { phone: string, firstName: string }
 */

import { and, asc, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireClientApiSession } from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { enqueueGoogleCalendarAppointmentMutation } from '@/libs/integrationOutbox';
import { upsertClient } from '@/libs/queries';
import { appointmentSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateNameSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50, 'Name too long'),
});

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
    const auth = await requireClientApiSession();
    if (!auth.ok) {
      return auth.response;
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = updateNameSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    const { firstName } = parsed.data;
    const normalizedPhone = auth.normalizedPhone;
    const phoneForDb = auth.session.phone;

    // 1. Upsert the client record
    const client = await upsertClient(phoneForDb, firstName);

    // 2. Preserve the existing all-history name update for this phone. Only a
    // live Calendar-represented appointment needs a durable provider mutation.
    // We check multiple phone formats since appointments might store phone differently
    await db.transaction(async (tx) => {
      const appointments = await tx.select().from(appointmentSchema).where(
        or(
          eq(appointmentSchema.clientPhone, normalizedPhone),
          eq(appointmentSchema.clientPhone, phoneForDb),
        ),
      ).orderBy(asc(appointmentSchema.id)).for('update');
      for (const appointment of appointments) {
        if (appointment.clientName === firstName) {
          continue;
        }
        const [updated] = await tx.update(appointmentSchema).set({
          clientName: firstName,
          updatedAt: new Date(Math.max(
            Date.now(),
            appointment.updatedAt.getTime() + 1,
          )),
        }).where(and(
          eq(appointmentSchema.id, appointment.id),
          eq(appointmentSchema.salonId, appointment.salonId),
          eq(appointmentSchema.updatedAt, appointment.updatedAt),
        )).returning();
        if (
          updated
          && !updated.deletedAt
          && ['pending', 'confirmed', 'in_progress'].includes(updated.status)
        ) {
          await enqueueGoogleCalendarAppointmentMutation(tx, {
            appointmentId: updated.id,
            salonId: updated.salonId,
            mutationVersion: updated.updatedAt,
          });
        }
      }
    });

    console.warn(`[Client] Updated name for ${phoneForDb}: ${firstName}`);

    return NextResponse.json({
      success: true,
      data: {
        client: {
          id: client.id,
          phone: client.phone,
          firstName: client.firstName,
        },
      },
    });
  } catch (error) {
    console.error('Update name error:', error);

    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      { status: 500 },
    );
  }
}
