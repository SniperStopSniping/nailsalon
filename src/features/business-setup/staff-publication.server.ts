import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { technicianSchema, technicianServicesSchema } from '@/models/Schema';

import { type SetupDocument, SetupError } from './contracts';
import type { readSetupSnapshot, SetupTransaction } from './drafts.server';
import { stableJson } from './drafts.server';
import { setupStaffSchedule } from './staff';

/** Caller holds the authorized salon row lock and exact publication approval. */
export async function publishSetupStaff(tx: SetupTransaction, salonId: string, current: Awaited<ReturnType<typeof readSetupSnapshot>>, draft: SetupDocument, serviceIds: Record<string, string>, locationId: string, resolveIdentity: (kind: 'services' | 'staff', id: string) => string | null) {
  const staffIds: Record<string, string> = {};
  const targets = new Set<string>();
  for (const person of draft.staff ?? []) {
    const recordId = resolveIdentity('staff', person.id);
    const baseline = current.document.staff?.find(saved => saved.id === recordId);
    if (recordId && !baseline) {
      throw new SetupError('INVALID', 'A team member is no longer part of this business. Reload your current team.');
    }
    const id = recordId ?? randomUUID();
    if (targets.has(id)) {
      throw new SetupError('INVALID', 'This draft contains the same team member twice. Review your team before publishing.');
    }
    targets.add(id);
    staffIds[person.id] = id;
    if (!baseline) {
      if (!person.id.startsWith('draft_') || (person.isActive && !person.hours)) {
        throw new SetupError('INVALID', 'A new team member needs reviewed working hours.');
      }
      await tx.insert(technicianSchema).values({ id, salonId, name: person.name, isActive: person.isActive, weeklySchedule: setupStaffSchedule(person), primaryLocationId: locationId, onboardingStatus: 'completed' });
    } else {
      const values: Partial<typeof technicianSchema.$inferInsert> = {};
      if (person.name !== baseline.name) {
        values.name = person.name;
      }
      if (person.isActive !== baseline.isActive) {
        values.isActive = person.isActive;
      }
      if (person.hours && stableJson(person.hours) !== stableJson(baseline.hours)) {
        values.weeklySchedule = setupStaffSchedule(person);
        // Old fallback fields must not resurrect a schedule the owner replaced.
        values.workDays = null;
        values.startTime = null;
        values.endTime = null;
      }
      if (Object.keys(values).length) {
        await tx.update(technicianSchema).set(values).where(and(eq(technicianSchema.id, id), eq(technicianSchema.salonId, salonId)));
      }
    }
    const enabled = person.serviceIds.map(serviceId => serviceIds[serviceId]);
    if (enabled.some(id => !id)) {
      throw new SetupError('INVALID', 'A team service is missing from this approved menu.');
    }
    if (person.assignmentMode === 'explicit' && (!baseline || baseline.assignmentMode !== 'explicit' || stableJson([...enabled].sort()) !== stableJson([...baseline.serviceIds].sort()))) {
      // Write disabled rows too: an intentionally empty choice must not fall
      // back to unrestricted legacy eligibility. Keep existing priorities.
      for (const serviceId of Object.values(serviceIds)) {
        await tx.insert(technicianServicesSchema).values({ technicianId: id, serviceId, enabled: enabled.includes(serviceId), priority: 0 }).onConflictDoUpdate({ target: [technicianServicesSchema.technicianId, technicianServicesSchema.serviceId], set: { enabled: enabled.includes(serviceId) } });
      }
    }
  }
  return staffIds;
}
