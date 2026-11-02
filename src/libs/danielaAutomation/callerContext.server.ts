import 'server-only';

import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';

import { resolveCanonicalSalonClientIdentityOutcomeWithHandle } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { appointmentSchema, appointmentServicesSchema, salonClientSchema, salonSchema, serviceSchema } from '@/models/Schema';

import type { CallerContext } from './alerts';
import type { DanielaConfig } from './config';
import { DANIELA_SALON_SLUG, normalizePhone } from './policy';

const empty = (match: CallerContext['match']): CallerContext => ({ match, name: null, nextAppointment: null });

/** Optional, read-only enrichment. Never identify a caller from another salon. */
export async function getCallerContext(config: DanielaConfig, phone: string | null, now = new Date()): Promise<CallerContext> {
  const normalized = phone && normalizePhone(phone);
  if (!normalized) {
    return empty('not_found');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '1500ms'`);
    const [salon] = await tx.select({ id: salonSchema.id }).from(salonSchema).where(and(
      eq(salonSchema.id, config.salonId),
      eq(salonSchema.slug, DANIELA_SALON_SLUG),
      eq(salonSchema.isActive, true),
      isNull(salonSchema.deletedAt),
    )).limit(1);
    if (!salon) {
      return empty('unavailable');
    }
    const resolved = await resolveCanonicalSalonClientIdentityOutcomeWithHandle(tx, { salonId: salon.id, phone: normalized });
    if (resolved.status !== 'resolved_terminal') {
      return empty(resolved.status === 'zero_identity_candidates' ? 'not_found' : 'ambiguous');
    }
    // Old aliases can resolve a lineage, but a reassigned historical number is
    // insufficient evidence to attach the current client's name/appointments.
    if (normalizePhone(resolved.identity.terminal.phone) !== normalized) {
      return empty('not_found');
    }
    const [profile] = await tx.select({ name: salonClientSchema.fullName }).from(salonClientSchema).where(and(
      eq(salonClientSchema.salonId, salon.id),
      eq(salonClientSchema.id, resolved.identity.terminal.id),
      isNull(salonClientSchema.archivedAt),
      isNull(salonClientSchema.mergedIntoClientId),
    )).limit(1);
    if (!profile) {
      return empty('not_found');
    }
    const national = normalized.slice(2);
    const [appointment] = await tx.select({
      id: appointmentSchema.id,
      name: appointmentSchema.clientName,
      startTime: appointmentSchema.startTime,
      status: appointmentSchema.status,
    }).from(appointmentSchema).where(and(
      eq(appointmentSchema.salonId, salon.id),
      isNull(appointmentSchema.deletedAt),
      gte(appointmentSchema.startTime, now),
      inArray(appointmentSchema.status, ['pending', 'confirmed']),
      or(
        inArray(appointmentSchema.salonClientId, resolved.identity.clientIds),
        and(isNull(appointmentSchema.salonClientId), sql`regexp_replace(${appointmentSchema.clientPhone}, '[^0-9]', '', 'g') in (${national}, ${`1${national}`})`),
      ),
    )).orderBy(asc(appointmentSchema.startTime), asc(appointmentSchema.id)).limit(1);
    const services = appointment
      ? await tx.select({ snapshot: appointmentServicesSchema.nameSnapshot, name: serviceSchema.name })
        .from(appointmentServicesSchema)
        .leftJoin(serviceSchema, and(eq(serviceSchema.id, appointmentServicesSchema.serviceId), eq(serviceSchema.salonId, salon.id)))
        .where(eq(appointmentServicesSchema.appointmentId, appointment.id))
        .orderBy(asc(appointmentServicesSchema.id)).limit(4)
      : [];
    return {
      match: 'matched',
      name: profile.name?.trim() || appointment?.name?.trim() || null,
      nextAppointment: appointment
        ? {
            startTime: appointment.startTime,
            status: appointment.status,
            services: [...new Set(services.map(s => s.snapshot?.trim() || s.name?.trim()).filter((s): s is string => !!s))],
          }
        : null,
    };
  });
}
