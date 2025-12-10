import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/libs/DB';
import { salonSchema, type SalonStatus } from '@/models/Schema';

// =============================================================================
// Salon Status Types
// =============================================================================

export interface SalonStatusCheck {
  exists: boolean;
  isActive: boolean;
  status: SalonStatus | null;
  isDeleted: boolean;
  redirectPath: string | null;
}

// =============================================================================
// Check Salon Status
// =============================================================================

/**
 * Check if a salon is accessible (not suspended, cancelled, or deleted)
 * Returns status information and redirect path if needed
 */
export async function checkSalonStatus(salonId: string): Promise<SalonStatusCheck> {
  const [salon] = await db
    .select({
      status: salonSchema.status,
      deletedAt: salonSchema.deletedAt,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return {
      exists: false,
      isActive: false,
      status: null,
      isDeleted: false,
      redirectPath: '/not-found',
    };
  }

  const status = (salon.status || 'active') as SalonStatus;
  const isDeleted = !!salon.deletedAt;

  // Check for deleted salon
  if (isDeleted) {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: true,
      redirectPath: '/cancelled',
    };
  }

  // Check for suspended status
  if (status === 'suspended') {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: false,
      redirectPath: '/suspended',
    };
  }

  // Check for cancelled status
  if (status === 'cancelled') {
    return {
      exists: true,
      isActive: false,
      status,
      isDeleted: false,
      redirectPath: '/cancelled',
    };
  }

  // Active or trial status - allowed
  return {
    exists: true,
    isActive: true,
    status,
    isDeleted: false,
    redirectPath: null,
  };
}

/**
 * Check salon status by slug
 */
export async function checkSalonStatusBySlug(slug: string): Promise<SalonStatusCheck> {
  const [salon] = await db
    .select({
      id: salonSchema.id,
      status: salonSchema.status,
      deletedAt: salonSchema.deletedAt,
    })
    .from(salonSchema)
    .where(eq(salonSchema.slug, slug))
    .limit(1);

  if (!salon) {
    return {
      exists: false,
      isActive: false,
      status: null,
      isDeleted: false,
      redirectPath: '/not-found',
    };
  }

  return checkSalonStatus(salon.id);
}

/**
 * Require salon to be active - redirects if not
 * Use in server components or API routes
 */
export async function requireActiveSalon(salonId: string): Promise<void> {
  const status = await checkSalonStatus(salonId);
  
  if (status.redirectPath) {
    redirect(status.redirectPath);
  }
}

/**
 * Require salon to be active by slug - redirects if not
 */
export async function requireActiveSalonBySlug(slug: string): Promise<void> {
  const status = await checkSalonStatusBySlug(slug);
  
  if (status.redirectPath) {
    redirect(status.redirectPath);
  }
}

// =============================================================================
// API Response Helpers
// =============================================================================

/**
 * Create an error response for inactive salons (for API routes)
 */
export function createInactiveSalonResponse(status: SalonStatusCheck): Response {
  if (!status.exists) {
    return Response.json(
      { error: 'Salon not found' },
      { status: 404 }
    );
  }

  if (status.status === 'suspended') {
    return Response.json(
      { error: 'Salon is temporarily suspended', status: 'suspended' },
      { status: 403 }
    );
  }

  if (status.status === 'cancelled' || status.isDeleted) {
    return Response.json(
      { error: 'Salon is no longer active', status: 'cancelled' },
      { status: 410 } // Gone
    );
  }

  return Response.json(
    { error: 'Salon is not accessible' },
    { status: 403 }
  );
}

/**
 * Guard API route - returns error response if salon is inactive
 */
export async function guardSalonApiRoute(salonId: string): Promise<Response | null> {
  const status = await checkSalonStatus(salonId);
  
  if (!status.isActive) {
    return createInactiveSalonResponse(status);
  }
  
  return null;
}
