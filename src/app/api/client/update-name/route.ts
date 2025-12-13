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
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { upsertClient } from '@/libs/queries';
import { appointmentSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateNameSchema = z.object({
  phone: z.string().min(10, 'Phone number is required'),
  firstName: z.string().min(1, 'First name is required').max(50, 'Name too long'),
});

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: Request) {
  try {
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

    const { phone, firstName } = parsed.data;

    // Normalize phone to match how it's stored (with +1 prefix)
    const normalizedPhone = phone.replace(/\D/g, '');
    const phoneForDb = normalizedPhone.length === 10 ? `+1${normalizedPhone}` : phone;

    // 1. Upsert the client record
    const client = await upsertClient(phoneForDb, firstName);

    // 2. Update any pending/confirmed appointments for this phone
    // We check multiple phone formats since appointments might store phone differently
    await db
      .update(appointmentSchema)
      .set({ clientName: firstName })
      .where(eq(appointmentSchema.clientPhone, normalizedPhone));

    // Also try with +1 prefix
    await db
      .update(appointmentSchema)
      .set({ clientName: firstName })
      .where(eq(appointmentSchema.clientPhone, `+1${normalizedPhone}`));

    // 3. Set client_name cookie for client-side access
    const cookieStore = await cookies();
    cookieStore.set('client_name', firstName, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    console.log(`[Client] Updated name for ${phoneForDb}: ${firstName}`);

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
