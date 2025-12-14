/**
 * Complete Profile API Route
 *
 * Updates client profile with name and email, granting a one-time points reward
 * for profile completion. Uses atomic conditional update to prevent race conditions.
 *
 * POST /api/client/complete-profile
 * Body: { phone: string, firstName: string, email: string, salonSlug: string }
 */

import { and, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { resolveSalonLoyaltyPoints } from '@/libs/loyalty';
import { getSalonBySlug, upsertSalonClient } from '@/libs/queries';
import { clientSchema, rewardSchema, salonClientSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const completeProfileSchema = z.object({
  phone: z.string().min(10, 'Phone number is required'),
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

    const { phone, firstName, email, salonSlug } = parsed.data;

    // Normalize phone to 10-digit format
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    if (normalizedPhone.length !== 10) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_PHONE',
            message: 'Phone number must be 10 digits',
          },
        },
        { status: 400 },
      );
    }

    // Phone format for DB storage (with +1 prefix)
    const phoneForDb = `+1${normalizedPhone}`;

    // 1. Resolve salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return NextResponse.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon not found`,
          },
        },
        { status: 404 },
      );
    }

    // Resolve effective loyalty points for this salon
    const loyaltyPoints = resolveSalonLoyaltyPoints(salon);

    // 2. Ensure salonClient exists (creates with welcome bonus if new)
    await upsertSalonClient(salon.id, normalizedPhone, firstName, email, undefined, loyaltyPoints.welcomeBonus);

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

    // 4. ATOMIC: Grant profile completion reward only if not already granted
    // This uses a conditional UPDATE that only affects rows where the flag is false
    // If 0 rows affected = already granted, if 1 row affected = just granted
    let rewardGranted = false;

    const rewardResult = await db.transaction(async (tx) => {
      // Atomic conditional update: only flip flag if currently false
      const updateResult = await tx
        .update(clientSchema)
        .set({
          profileCompletionRewardGranted: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clientSchema.id, client.id),
            eq(clientSchema.profileCompletionRewardGranted, false),
          ),
        )
        .returning();

      // If no rows updated, reward was already granted (race condition or repeat call)
      if (updateResult.length === 0) {
        return { granted: false, points: 0 };
      }

      // Flag was flipped - now grant the reward within same transaction
      const rewardId = `reward_${crypto.randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90-day expiration

      // Insert reward record
      await tx.insert(rewardSchema).values({
        id: rewardId,
        salonId: salon.id,
        clientPhone: normalizedPhone,
        clientName: firstName,
        type: 'profile_completion',
        points: loyaltyPoints.profileCompletion,
        eligibleServiceName: 'Any Service',
        status: 'active',
        expiresAt,
      });

      // Increment salonClient loyalty points
      await tx
        .update(salonClientSchema)
        .set({
          loyaltyPoints: sql`COALESCE(${salonClientSchema.loyaltyPoints}, 0) + ${loyaltyPoints.profileCompletion}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(salonClientSchema.salonId, salon.id),
            eq(salonClientSchema.phone, normalizedPhone),
          ),
        );

      return { granted: true, points: loyaltyPoints.profileCompletion };
    });

    rewardGranted = rewardResult.granted;

    if (rewardGranted) {
      console.warn(`[Profile] Granted ${rewardResult.points} point profile completion reward to ${phoneForDb}`);
    }

    // 5. Set cookies for client-side access
    const cookieStore = await cookies();

    cookieStore.set('client_name', firstName, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    cookieStore.set('client_email', email, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

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
        rewardGranted,
        rewardPoints: rewardResult.points,
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
