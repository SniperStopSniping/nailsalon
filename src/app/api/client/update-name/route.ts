/**
 * Update Client Name API Route
 *
 * Upserts a client record with their first name.
 * Also updates any pending appointments for this phone number.
 *
 * POST /api/client/update-name
 * Body: { phone: string, firstName: string }
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireClientApiSession } from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
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

    // 2. Update any pending/confirmed appointments for this phone
    // We check multiple phone formats since appointments might store phone differently
    await db
      .update(appointmentSchema)
      .set({ clientName: firstName })
      .where(eq(appointmentSchema.clientPhone, normalizedPhone));

    await db
      .update(appointmentSchema)
      .set({ clientName: firstName })
      .where(eq(appointmentSchema.clientPhone, phoneForDb));

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
