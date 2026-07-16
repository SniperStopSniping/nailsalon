/**
 * Admin Me API Route
 *
 * Returns the current admin user's profile and salon memberships.
 * Reads from session cookie.
 *
 * SECURITY: Real authenticated session ALWAYS wins over dev role override.
 * Dev role mock only applies when there is NO real session.
 *
 * Optional query param: salonSlug
 * - If provided, validates user has membership in that salon
 * - Returns 401 if not a member
 * - Filters salons array to only that salon entry
 */

import { NextResponse } from 'next/server';

import { getAdminImpersonationForAdmin, getAdminSession } from '@/libs/adminAuth';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getSalonById, getSalonBySlug } from '@/libs/queries';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Parse optional salonSlug query param
  const { searchParams } = new URL(request.url);
  const salonSlug = searchParams.get('salonSlug')?.trim().toLowerCase() ?? null;

  try {
    // ==========================================================================
    // STEP 1: Try real session FIRST (always wins over dev override)
    // ==========================================================================
    const admin = await getAdminSession();

    if (admin) {
      // Real session exists - use it (ignore any dev role override)
      const profileComplete = Boolean(admin.name && admin.email);
      const impersonation = await getAdminImpersonationForAdmin(admin);
      const impersonationSalon = impersonation
        ? await getSalonById(impersonation.salonId)
        : null;

      // Build salons array
      let salons = admin.salons.map(s => ({
        id: s.salonId,
        slug: s.salonSlug,
        name: s.salonName,
        status: s.status ?? null,
        role: s.role,
        freeSoloEnabled: s.freeSoloEnabled ?? false,
        publicUrl: buildSalonTenantPublicUrl('/', { slug: s.salonSlug, customDomain: s.customDomain }),
        bookingUrl: buildSalonTenantPublicUrl('/book/service', { slug: s.salonSlug, customDomain: s.customDomain }),
      }));
      const availableSalons = [...salons];

      if (impersonation) {
        salons = [{
          id: impersonation.salonId,
          slug: impersonation.salonSlug,
          name: impersonation.salonName,
          status: impersonationSalon?.status ?? null,
          role: 'impersonation',
          freeSoloEnabled: impersonationSalon?.freeSoloEnabled ?? false,
          publicUrl: buildSalonTenantPublicUrl('/', { slug: impersonation.salonSlug, customDomain: impersonationSalon?.customDomain }),
          bookingUrl: buildSalonTenantPublicUrl('/book/service', { slug: impersonation.salonSlug, customDomain: impersonationSalon?.customDomain }),
        }];
      }

      // If salonSlug provided, validate membership and filter
      if (salonSlug) {
        if (impersonation && salonSlug !== impersonation.salonSlug.toLowerCase()) {
          return NextResponse.json(
            { error: 'Impersonation is locked to a different salon' },
            { status: 403 },
          );
        }

        const hasMembership = salons.some(
          s => s.slug?.toLowerCase() === salonSlug,
        );

        // Super admins can access any salon without explicit membership
        if (!hasMembership && !admin.isSuperAdmin) {
          return NextResponse.json(
            { error: 'You do not have access to this salon' },
            { status: 401 },
          );
        }

        // Filter to only the requested salon (if they have membership).
        // A super-admin opening a salon directly may not have a membership;
        // load that exact tenant instead of silently displaying their first
        // membership under the requested salon URL.
        if (hasMembership) {
          salons = salons.filter(s => s.slug?.toLowerCase() === salonSlug);
        } else if (admin.isSuperAdmin && !impersonation) {
          const requestedSalon = await getSalonBySlug(salonSlug);
          if (!requestedSalon) {
            return NextResponse.json(
              { error: 'Salon not found' },
              { status: 404 },
            );
          }
          salons = [{
            id: requestedSalon.id,
            slug: requestedSalon.slug,
            name: requestedSalon.name,
            status: requestedSalon.status ?? null,
            role: 'super_admin',
            freeSoloEnabled: requestedSalon.freeSoloEnabled ?? false,
            publicUrl: buildSalonTenantPublicUrl('/', requestedSalon),
            bookingUrl: buildSalonTenantPublicUrl('/book/service', requestedSalon),
          }];
        }
      }

      return NextResponse.json({
        user: {
          id: admin.id,
          phone: admin.phoneE164,
          name: admin.name,
          email: admin.email,
          isSuperAdmin: admin.isSuperAdmin,
          profileComplete,
          salons,
          availableSalons: impersonation ? salons : availableSalons,
          impersonation: impersonation
            ? {
                isActive: true,
                salonId: impersonation.salonId,
                salonSlug: impersonation.salonSlug,
                salonName: impersonation.salonName,
                startedAt: impersonation.startedAt,
              }
            : null,
        },
      }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // ==========================================================================
    // STEP 2: No real session - check for dev role override (DEV ONLY)
    // ==========================================================================
    if (process.env.NODE_ENV !== 'production') {
      const { isDevModeServer, readDevRoleFromCookies, getMockAdminMeResponse }
        = await import('@/libs/devRole.server');

      if (isDevModeServer()) {
        const devRole = readDevRoleFromCookies();

        if (devRole === 'super_admin' || devRole === 'admin') {
          const mockResponse = getMockAdminMeResponse(devRole);

          // If salonSlug provided, validate and filter (dev mode)
          if (salonSlug && mockResponse.user) {
            const hasMembership = mockResponse.user.salons.some(
              (s: { slug?: string }) => s.slug?.toLowerCase() === salonSlug,
            );
            if (!hasMembership && devRole !== 'super_admin') {
              return NextResponse.json(
                { error: 'You do not have access to this salon' },
                { status: 401 },
              );
            }
            // Filter to only the requested salon (or keep all for super admin)
            if (hasMembership) {
              mockResponse.user.salons = mockResponse.user.salons.filter(
                (s: { slug?: string }) => s.slug?.toLowerCase() === salonSlug,
              );
            }
          }

          return NextResponse.json(mockResponse, {
            headers: { 'Cache-Control': 'no-store' },
          });
        }

        // If a different dev role is set (staff/client), return unauthorized for admin route
        if (devRole) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
      }
    }

    // ==========================================================================
    // STEP 3: No real session and no dev override - not authenticated
    // ==========================================================================
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 },
    );
  } catch (error) {
    console.error('Admin me error:', error);

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    );
  }
}
