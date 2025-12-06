/**
 * Client Preferences API Route
 *
 * GET /api/client/preferences?phone=1234567890&salonSlug=nail-salon-no5
 * PUT /api/client/preferences
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import {
  clientPreferencesSchema,
  technicianSchema,
  type ClientPreferences,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const getPreferencesSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const putPreferencesSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
  // All preference fields are optional
  favoriteTechId: z.string().nullable().optional(),
  favoriteServices: z.array(z.string()).nullable().optional(),
  nailShape: z.string().nullable().optional(),
  nailLength: z.string().nullable().optional(),
  finishes: z.array(z.string()).nullable().optional(),
  colorFamilies: z.array(z.string()).nullable().optional(),
  preferredBrands: z.array(z.string()).nullable().optional(),
  sensitivities: z.array(z.string()).nullable().optional(),
  musicPreference: z.string().nullable().optional(),
  conversationLevel: z.string().nullable().optional(),
  beveragePreference: z.array(z.string()).nullable().optional(),
  techNotes: z.string().nullable().optional(),
  appointmentNotes: z.string().nullable().optional(),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface PreferencesData {
  id: string;
  salonId: string;
  normalizedClientPhone: string;
  favoriteTechId: string | null;
  favoriteServices: string[] | null;
  nailShape: string | null;
  nailLength: string | null;
  finishes: string[] | null;
  colorFamilies: string[] | null;
  preferredBrands: string[] | null;
  sensitivities: string[] | null;
  musicPreference: string | null;
  conversationLevel: string | null;
  beveragePreference: string[] | null;
  techNotes: string | null;
  appointmentNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SuccessResponse {
  data: {
    preferences: PreferencesData | null;
  };
  meta: {
    timestamp: string;
  };
}

// =============================================================================
// Helper: Normalize phone number to 10 digits
// =============================================================================

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

// =============================================================================
// GET /api/client/preferences - Get preferences for a client
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Parse query parameters
    const { searchParams } = new URL(request.url);
    const rawPhone = searchParams.get('phone');
    const salonSlug = searchParams.get('salonSlug');

    // 2. Normalize phone if provided
    const phone = rawPhone ? normalizePhone(rawPhone) : '';

    // 3. Validate parameters
    const parsed = getPreferencesSchema.safeParse({ phone, salonSlug });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      let userMessage = 'Invalid request parameters';

      if (fieldErrors.phone) {
        userMessage = 'Your phone number is invalid.';
      } else if (fieldErrors.salonSlug) {
        userMessage = 'Unable to identify salon.';
      }

      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: userMessage,
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Resolve salon from slug
    const salon = await getSalonBySlug(parsed.data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon with slug "${parsed.data.salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 5. Fetch preferences for this phone and salon
    const results = await db
      .select()
      .from(clientPreferencesSchema)
      .where(
        and(
          eq(clientPreferencesSchema.salonId, salon.id),
          eq(clientPreferencesSchema.normalizedClientPhone, parsed.data.phone),
        ),
      )
      .limit(1);

    const preferences = results[0] ?? null;

    // 6. Return response
    const response: SuccessResponse = {
      data: {
        preferences: preferences
          ? {
              id: preferences.id,
              salonId: preferences.salonId,
              normalizedClientPhone: preferences.normalizedClientPhone,
              favoriteTechId: preferences.favoriteTechId,
              favoriteServices: preferences.favoriteServices,
              nailShape: preferences.nailShape,
              nailLength: preferences.nailLength,
              finishes: preferences.finishes,
              colorFamilies: preferences.colorFamilies,
              preferredBrands: preferences.preferredBrands,
              sensitivities: preferences.sensitivities,
              musicPreference: preferences.musicPreference,
              conversationLevel: preferences.conversationLevel,
              beveragePreference: preferences.beveragePreference,
              techNotes: preferences.techNotes,
              appointmentNotes: preferences.appointmentNotes,
              createdAt: preferences.createdAt.toISOString(),
              updatedAt: preferences.updatedAt.toISOString(),
            }
          : null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error fetching preferences:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching preferences',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/client/preferences - Upsert preferences for a client
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    // 1. Parse request body
    const body = await request.json();

    // Normalize phone if provided
    if (body.phone) {
      body.phone = normalizePhone(body.phone);
    }

    // 2. Validate body
    const parsed = putPreferencesSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 3. Resolve salon from slug
    const salon = await getSalonBySlug(parsed.data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon with slug "${parsed.data.salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 4. Validate favoriteTechId belongs to this salon (if provided)
    if (parsed.data.favoriteTechId) {
      const techs = await db
        .select()
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.id, parsed.data.favoriteTechId),
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.isActive, true),
          ),
        )
        .limit(1);

      if (techs.length === 0) {
        return Response.json(
          {
            error: {
              code: 'INVALID_TECHNICIAN',
              message: 'Selected technician is not available at this salon',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 5. Check if preferences already exist
    const existing = await db
      .select()
      .from(clientPreferencesSchema)
      .where(
        and(
          eq(clientPreferencesSchema.salonId, salon.id),
          eq(clientPreferencesSchema.normalizedClientPhone, parsed.data.phone),
        ),
      )
      .limit(1);

    let preferences: ClientPreferences;

    if (existing.length > 0) {
      // Update existing preferences
      const [updated] = await db
        .update(clientPreferencesSchema)
        .set({
          favoriteTechId: parsed.data.favoriteTechId ?? null,
          favoriteServices: parsed.data.favoriteServices ?? null,
          nailShape: parsed.data.nailShape ?? null,
          nailLength: parsed.data.nailLength ?? null,
          finishes: parsed.data.finishes ?? null,
          colorFamilies: parsed.data.colorFamilies ?? null,
          preferredBrands: parsed.data.preferredBrands ?? null,
          sensitivities: parsed.data.sensitivities ?? null,
          musicPreference: parsed.data.musicPreference ?? null,
          conversationLevel: parsed.data.conversationLevel ?? null,
          beveragePreference: parsed.data.beveragePreference ?? null,
          techNotes: parsed.data.techNotes ?? null,
          appointmentNotes: parsed.data.appointmentNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(clientPreferencesSchema.id, existing[0]!.id))
        .returning();

      preferences = updated!;
    } else {
      // Insert new preferences
      const newId = `pref_${crypto.randomUUID()}`;
      const [inserted] = await db
        .insert(clientPreferencesSchema)
        .values({
          id: newId,
          salonId: salon.id,
          normalizedClientPhone: parsed.data.phone,
          favoriteTechId: parsed.data.favoriteTechId ?? null,
          favoriteServices: parsed.data.favoriteServices ?? null,
          nailShape: parsed.data.nailShape ?? null,
          nailLength: parsed.data.nailLength ?? null,
          finishes: parsed.data.finishes ?? null,
          colorFamilies: parsed.data.colorFamilies ?? null,
          preferredBrands: parsed.data.preferredBrands ?? null,
          sensitivities: parsed.data.sensitivities ?? null,
          musicPreference: parsed.data.musicPreference ?? null,
          conversationLevel: parsed.data.conversationLevel ?? null,
          beveragePreference: parsed.data.beveragePreference ?? null,
          techNotes: parsed.data.techNotes ?? null,
          appointmentNotes: parsed.data.appointmentNotes ?? null,
        })
        .returning();

      preferences = inserted!;
    }

    // 6. Return response
    const response: SuccessResponse = {
      data: {
        preferences: {
          id: preferences.id,
          salonId: preferences.salonId,
          normalizedClientPhone: preferences.normalizedClientPhone,
          favoriteTechId: preferences.favoriteTechId,
          favoriteServices: preferences.favoriteServices,
          nailShape: preferences.nailShape,
          nailLength: preferences.nailLength,
          finishes: preferences.finishes,
          colorFamilies: preferences.colorFamilies,
          preferredBrands: preferences.preferredBrands,
          sensitivities: preferences.sensitivities,
          musicPreference: preferences.musicPreference,
          conversationLevel: preferences.conversationLevel,
          beveragePreference: preferences.beveragePreference,
          techNotes: preferences.techNotes,
          appointmentNotes: preferences.appointmentNotes,
          createdAt: preferences.createdAt.toISOString(),
          updatedAt: preferences.updatedAt.toISOString(),
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error('Error saving preferences:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while saving preferences',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
