import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { getAdminSession } from '@/libs/adminAuth';
import { readNoShowProtection } from '@/libs/networkNoShow';
import { getNetworkNoShowParticipation, readNetworkNoShowRisk } from '@/libs/networkNoShow.server';
import { normalizePhone } from '@/libs/phone';
import { appointmentSchema, networkNoShowAuditSchema, networkNoShowBookingBindingSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

/** The caller has authorized this salon client. A manually entered contact alone grants no network lookup. */
export async function getClientProfileBookingRisk(args: {
  salonId: string;
  clientId: string;
  phone: string;
  email: string | null;
  settings: SalonSettings | null;
}) {
  if (process.env.NETWORK_NO_SHOW_ENABLED !== 'true') {
    return undefined;
  }
  try {
    if (!await getNetworkNoShowParticipation(args.salonId)) {
      return undefined;
    }
    const actor = await getAdminSession();
    if (!actor) {
      return { state: 'unavailable' as const };
    }
    const { db } = await import('@/libs/DB');
    return await db.transaction(async (tx) => {
      // Database-scoped budget works across application instances. The key is tenant-local.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`network-profile:${args.salonId}`}, 0))`);
      const [usage] = await tx.select({
        tenant: sql<number>`count(*)::int`,
        actor: sql<number>`count(*) filter (where ${networkNoShowAuditSchema.actorId} = ${actor.id})::int`,
      }).from(networkNoShowAuditSchema).where(and(
        eq(networkNoShowAuditSchema.salonId, args.salonId),
        sql`${networkNoShowAuditSchema.action} like 'profile_read:%'`,
        gt(networkNoShowAuditSchema.createdAt, new Date(Date.now() - 60_000)),
      ));
      if ((usage?.tenant ?? 0) >= 120 || (usage?.actor ?? 0) >= 60) {
        return { state: 'unavailable' as const };
      }
      await tx.insert(networkNoShowAuditSchema).values({
        id: randomUUID(),
        salonId: args.salonId,
        actorId: actor.id,
        actorRole: 'admin',
        action: `profile_read:${args.clientId}`,
      });
      const [relationship] = await tx.select({ id: appointmentSchema.id })
        .from(networkNoShowBookingBindingSchema)
        .innerJoin(appointmentSchema, and(
          eq(appointmentSchema.salonId, networkNoShowBookingBindingSchema.salonId),
          eq(appointmentSchema.id, networkNoShowBookingBindingSchema.appointmentId),
        ))
        .where(and(
          eq(networkNoShowBookingBindingSchema.salonId, args.salonId),
          eq(appointmentSchema.salonClientId, args.clientId),
          eq(networkNoShowBookingBindingSchema.state, 'eligible'),
          isNull(networkNoShowBookingBindingSchema.invalidatedAt),
          isNull(appointmentSchema.deletedAt),
          eq(appointmentSchema.clientPhone, normalizePhone(args.phone)),
          sql`lower(trim(${appointmentSchema.clientEmail})) = ${(args.email ?? '').trim().toLowerCase()}`,
        )).limit(1);
      if (!relationship) {
        return { state: 'unavailable' as const };
      }
      const signal = await readNetworkNoShowRisk({ ...args, handle: tx });
      if (signal.state === 'inactive') {
        return undefined;
      }
      return signal.state === 'available'
        ? { ...signal, protection: readNoShowProtection(args.settings) }
        : signal;
    });
  } catch {
    // An optional profile read failure is never a clean history.
    return { state: 'unavailable' as const };
  }
}
