/**
 * Complete Profile API Route
 *
 * Updates client profile with name and email, granting a one-time $5 reward
 * for profile completion.
 *
 * POST /api/client/complete-profile
 * Body: { phone: string, firstName: string, email: string, salonSlug: string }
 */

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { clientSchema, rewardSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const completeProfileSchema = z.object({
  phone: z.string().min(10, 'Phone number is required'),
  firstName: z.string().min(1, 'First name is required').max(50, 'Name too long'),
  email: z.string().email('Please enter a valid email address'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// CONSTANTS
// =============================================================================

// $5 reward = 500 points (based on 2500 pts = $5 tier, so 100 pts = $1)
const PROFILE_COMPLETION_REWARD_POINTS = 500;

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

    // 2. Upsert client with name and email
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

    // 3. Check if profile completion reward was already granted
    let rewardGranted = false;
    if (!client.profileCompletionRewardGranted) {
      // Grant the one-time $5 reward
      const rewardId = `reward_${crypto.randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90); // 90-day expiration

      await db.insert(rewardSchema).values({
        id: rewardId,
        salonId: salon.id,
        clientPhone: normalizedPhone,
        clientName: firstName,
        type: 'referral_referee', // Using existing type for profile completion bonus
        points: PROFILE_COMPLETION_REWARD_POINTS,
        eligibleServiceName: 'Any Service',
        status: 'active',
        expiresAt,
      });

      // Mark profile completion reward as granted
      await db
        .update(clientSchema)
        .set({ profileCompletionRewardGranted: true })
        .where(eq(clientSchema.id, client.id));

      rewardGranted = true;
      console.log(`[Profile] Granted $5 profile completion reward to ${phoneForDb}`);
    }

    // 4. Set cookies for client-side access
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

    console.log(`[Profile] Completed profile for ${phoneForDb}: ${firstName}, ${email}`);

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
        rewardPoints: rewardGranted ? PROFILE_COMPLETION_REWARD_POINTS : 0,
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
