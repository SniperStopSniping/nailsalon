import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { requireSuperAdmin } from '@/libs/superAdmin';
import {
  salonSchema,
  serviceSchema,
  technicianSchema,
  appointmentSchema,
  referralSchema,
  rewardSchema,
  clientPreferencesSchema,
  salonLocationSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/super-admin/organizations/[id]/export - Export salon data
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) return guard;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';

    // Check salon exists
    const [salon] = await db
      .select()
      .from(salonSchema)
      .where(eq(salonSchema.id, id))
      .limit(1);

    if (!salon) {
      return Response.json(
        { error: 'Salon not found' },
        { status: 404 },
      );
    }

    // Fetch all related data
    const [services, technicians, appointments, referrals, rewards, clientPreferences, locations] = await Promise.all([
      db.select().from(serviceSchema).where(eq(serviceSchema.salonId, id)),
      db.select().from(technicianSchema).where(eq(technicianSchema.salonId, id)),
      db.select().from(appointmentSchema).where(eq(appointmentSchema.salonId, id)),
      db.select().from(referralSchema).where(eq(referralSchema.salonId, id)),
      db.select().from(rewardSchema).where(eq(rewardSchema.salonId, id)),
      db.select().from(clientPreferencesSchema).where(eq(clientPreferencesSchema.salonId, id)),
      db.select().from(salonLocationSchema).where(eq(salonLocationSchema.salonId, id)),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        plan: salon.plan,
        status: salon.status,
        ownerEmail: salon.ownerEmail,
        phone: salon.phone,
        email: salon.email,
        address: salon.address,
        city: salon.city,
        state: salon.state,
        zipCode: salon.zipCode,
        businessHours: salon.businessHours,
        socialLinks: salon.socialLinks,
        createdAt: salon.createdAt.toISOString(),
        updatedAt: salon.updatedAt.toISOString(),
      },
      locations: locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        zipCode: loc.zipCode,
        phone: loc.phone,
        email: loc.email,
        isPrimary: loc.isPrimary,
        isActive: loc.isActive,
        businessHours: loc.businessHours,
      })),
      services: services.map(svc => ({
        id: svc.id,
        name: svc.name,
        description: svc.description,
        price: svc.price,
        durationMinutes: svc.durationMinutes,
        category: svc.category,
        isActive: svc.isActive,
      })),
      technicians: technicians.map(tech => ({
        id: tech.id,
        name: tech.name,
        email: tech.email,
        phone: tech.phone,
        bio: tech.bio,
        role: tech.role,
        specialties: tech.specialties,
        weeklySchedule: tech.weeklySchedule,
        isActive: tech.isActive,
      })),
      appointments: appointments.map(appt => ({
        id: appt.id,
        clientPhone: appt.clientPhone,
        clientName: appt.clientName,
        technicianId: appt.technicianId,
        startTime: appt.startTime.toISOString(),
        endTime: appt.endTime.toISOString(),
        status: appt.status,
        totalPrice: appt.totalPrice,
        totalDurationMinutes: appt.totalDurationMinutes,
        notes: appt.notes,
        createdAt: appt.createdAt.toISOString(),
      })),
      referrals: referrals.map(ref => ({
        id: ref.id,
        referrerPhone: ref.referrerPhone,
        referrerName: ref.referrerName,
        refereePhone: ref.refereePhone,
        refereeName: ref.refereeName,
        status: ref.status,
        claimedAt: ref.claimedAt?.toISOString(),
        createdAt: ref.createdAt.toISOString(),
      })),
      rewards: rewards.map(rew => ({
        id: rew.id,
        clientPhone: rew.clientPhone,
        clientName: rew.clientName,
        type: rew.type,
        points: rew.points,
        status: rew.status,
        createdAt: rew.createdAt.toISOString(),
      })),
      clientPreferences: clientPreferences.map(pref => ({
        id: pref.id,
        normalizedClientPhone: pref.normalizedClientPhone,
        favoriteTechId: pref.favoriteTechId,
        favoriteServices: pref.favoriteServices,
        nailShape: pref.nailShape,
        nailLength: pref.nailLength,
        finishes: pref.finishes,
        colorFamilies: pref.colorFamilies,
      })),
      summary: {
        servicesCount: services.length,
        techniciansCount: technicians.length,
        appointmentsCount: appointments.length,
        referralsCount: referrals.length,
        rewardsCount: rewards.length,
        clientPreferencesCount: clientPreferences.length,
        locationsCount: locations.length,
      },
    };

    if (format === 'csv') {
      // Convert to CSV format (simplified - just appointments for now)
      const csvRows: string[] = [];
      
      // Header
      csvRows.push('type,id,name,email,phone,status,created_at');
      
      // Salon info
      csvRows.push(`salon,${salon.id},${salon.name},${salon.email || ''},${salon.phone || ''},${salon.status},${salon.createdAt.toISOString()}`);
      
      // Technicians
      for (const tech of technicians) {
        csvRows.push(`technician,${tech.id},"${tech.name}",${tech.email || ''},${tech.phone || ''},${tech.isActive ? 'active' : 'inactive'},${tech.createdAt.toISOString()}`);
      }
      
      // Services
      for (const svc of services) {
        csvRows.push(`service,${svc.id},"${svc.name}",,,${svc.isActive ? 'active' : 'inactive'},${svc.createdAt.toISOString()}`);
      }
      
      // Appointments
      for (const appt of appointments) {
        csvRows.push(`appointment,${appt.id},"${appt.clientName || ''}",${appt.clientPhone},${appt.clientPhone},${appt.status},${appt.createdAt.toISOString()}`);
      }

      const csvContent = csvRows.join('\n');
      
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${salon.slug}-export-${Date.now()}.csv"`,
        },
      });
    }

    // Default: JSON format
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${salon.slug}-export-${Date.now()}.json"`,
      },
    });
  } catch (error) {
    console.error('Error exporting salon data:', error);
    return Response.json(
      { error: 'Failed to export salon data' },
      { status: 500 },
    );
  }
}
