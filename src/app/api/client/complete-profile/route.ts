/**
 * Complete Profile API Route
 *
 * Updates client profile with name and email.
 *
 * POST /api/client/complete-profile
 * Body: { phone: string, firstName: string, email: string, salonSlug: string }
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  requireClientApiSession,
  requireClientSalonFromBody,
} from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { upsertSalonClient } from '@/libs/queries';
import { clientSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const completeProfileSchema = z.object({
  firstName: z.string()
    .min(1, 'First name is required')
    .max(50, 'Name too long')
    .transform(s => s.trim())
    .refine(s => s.length > 0, 'First name cannot be empty'),
  email: z.string()
    .email('Please enter a valid email address')
    .transform(s => s.trim().toLowerCase()),
  salonSlug: z.string().min(1, 'Salon slug is required'),
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
    const parsed = completeProfileSchema.safeParse(body);

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

    const { firstName, email, salonSlug } = parsed.data;
    const normalizedPhone = auth.normalizedPhone;
    const phoneForDb = auth.session.phone;

    // 1. Resolve salon
    const salonGuard = await requireClientSalonFromBody(salonSlug);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    // 2. Ensure salonClient exists (starts at 0 loyalty points if new)
    await upsertSalonClient(salon.id, normalizedPhone, firstName, email);

    // 3. Upsert global client with name and email
    const clientId = `client_${crypto.randomUUID()}`;
    const [client] = await db
      .insert(clientSchema)
      .values({
        id: clientId,
        phone: phoneForDb,
        firstName,
        email,
      })
      .onConflictDoUpdate({
        target: clientSchema.phone,
        set: {
          firstName,
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!client) {
      throw new Error('Failed to upsert client');
    }

    // Profile completion no longer grants any reward; keep the legacy flag false.
    await db
      .update(clientSchema)
      .set({
        profileCompletionRewardGranted: false,
        updatedAt: new Date(),
      })
      .where(eq(clientSchema.id, client.id));

    // eslint-disable-next-line no-console
    console.warn(`[Profile] Completed profile for ${phoneForDb}: ${firstName}, ${email}`);

    return NextResponse.json({
      success: true,
      data: {
        client: {
          id: client.id,
          phone: client.phone,
          firstName,
          email,
        },
        rewardGranted: false,
        rewardPoints: 0,
      },
    });
  } catch (error) {
    console.error('Complete profile error:', error);

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
