import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { sendStaffInvite } from '@/libs/SMS';
import { technicianSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const inviteSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// POST /api/admin/technicians/[id]/invite - Send SMS invite to technician
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: technicianId } = await params;
    const body = await request.json();

    // Validate request
    const validated = inviteSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug } = validated.data;

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Get technician
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, technicianId),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Check if technician has a phone number
    if (!technician.phone) {
      return Response.json(
        {
          error: {
            code: 'NO_PHONE_NUMBER',
            message: 'Technician does not have a phone number. Cannot send invite.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Normalize phone to 10 digits
    const normalizedPhone = technician.phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

    // Send the invite SMS
    const sent = await sendStaffInvite(salon.id, {
      phone: normalizedPhone,
      techName: technician.name,
      salonName: salon.name,
      salonSlug: salon.slug,
    });

    return Response.json({
      data: {
        sent,
        phone: normalizedPhone,
        technicianId: technician.id,
      },
    });
  } catch (error) {
    console.error('Error sending staff invite:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to send staff invite',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
