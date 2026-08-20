import 'server-only';

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// VALUE import of `addOnGroupBoundsSchema` from the catalog module set —
// this file is an authorized edge in `architecturalInvariants.test.ts`
// (invariant 5). Reused, not reimplemented: it mirrors the exact
// `add_on_group_min_selections_check` / `_max_selections_check` /
// `_min_max_compatible_check` CHECKs migration 0073 enforces in the
// database (`catalogRuleContract.ts`'s own doc comment).
import { addOnGroupBoundsSchema } from '@/libs/catalogRuleContract';
import { db } from '@/libs/DB';
import { OwnerCatalogConfigError } from '@/libs/ownerCatalogErrors.server';
import type { AddOnGroup } from '@/models/Schema';
import { addOnGroupSchema, addOnSchema } from '@/models/Schema';

/**
 * Luster L1 PR6 — add-on group CRUD (owner/admin configuration surface).
 *
 * `add_on_group` is the FIRST writer this table has ever had (migration
 * 0073 created it empty and dark). Every write below is tenant-scoped and
 * transactional; nothing here activates any public rendering path — see
 * `resolveCatalogDomainView` (`bookingCatalog.ts`), which stays gated by the
 * dark `catalog.*` feature keys this PR does not touch.
 */

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform(value => (typeof value === 'string' ? (value.trim() || null) : null));

const addOnGroupRequestBaseSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  name: z.string().trim().min(1, 'Group name is required').max(120, 'Group name is too long'),
  description: optionalText,
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type ParsedAddOnGroupWrite = {
  salonSlug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  minSelections: number;
  maxSelections: number | null;
};

/**
 * Validates a create/update body against BOTH the group's own fields and the
 * reused `addOnGroupBoundsSchema` (min/max selection bounds). Throws a
 * single `OwnerCatalogConfigError` describing whichever half failed first —
 * an owner never needs to know these are two schemas internally.
 */
export function parseAddOnGroupWrite(raw: unknown): ParsedAddOnGroupWrite {
  const base = addOnGroupRequestBaseSchema.safeParse(raw);
  const bounds = addOnGroupBoundsSchema.safeParse(raw);

  if (!base.success || !bounds.success) {
    const issue = !base.success ? base.error.issues[0] : bounds.error?.issues[0];
    throw new OwnerCatalogConfigError({
      code: 'VALIDATION_ERROR',
      message: issue?.message ?? 'Invalid add-on group details.',
      anchor: { kind: 'relationship' },
      status: 400,
    });
  }

  return { ...base.data, ...bounds.data };
}

function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'group';
  return `${base}-${nanoid(6).toLowerCase()}`;
}

export async function createAddOnGroup(
  salonId: string,
  input: Omit<ParsedAddOnGroupWrite, 'salonSlug'>,
): Promise<AddOnGroup> {
  const id = `grp_${nanoid()}`;
  const [created] = await db
    .insert(addOnGroupSchema)
    .values({
      id,
      salonId,
      name: input.name,
      slug: slugFromName(input.name),
      description: input.description,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    })
    .returning();

  if (!created) {
    throw new OwnerCatalogConfigError({
      code: 'CREATE_FAILED',
      message: 'The add-on group could not be created. Try again.',
      anchor: { kind: 'relationship' },
      status: 500,
    });
  }

  return created;
}

export async function updateAddOnGroup(
  salonId: string,
  groupId: string,
  input: Omit<ParsedAddOnGroupWrite, 'salonSlug'>,
): Promise<AddOnGroup> {
  const [updated] = await db
    .update(addOnGroupSchema)
    .set({
      name: input.name,
      description: input.description,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(addOnGroupSchema.id, groupId), eq(addOnGroupSchema.salonId, salonId)))
    .returning();

  if (!updated) {
    throw new OwnerCatalogConfigError({
      code: 'GROUP_NOT_FOUND',
      message: 'Add-on group not found.',
      anchor: { kind: 'group', groupId },
      status: 404,
    });
  }

  return updated;
}

/**
 * Confirms `groupId` names a REAL group belonging to THIS salon before an
 * add-on write is allowed to point `group_id` at it. The composite foreign
 * key (`add_on_group_salon_fk`, migration 0073) would reject a cross-tenant
 * reference at the database layer regardless, but failing here first
 * produces the owner-facing `GROUP_NOT_FOUND` error instead of a raw
 * constraint violation surfacing as a generic 409/500.
 */
export async function assertAddOnGroupBelongsToSalon(salonId: string, groupId: string): Promise<void> {
  const [group] = await db
    .select({ id: addOnGroupSchema.id })
    .from(addOnGroupSchema)
    .where(and(eq(addOnGroupSchema.salonId, salonId), eq(addOnGroupSchema.id, groupId)))
    .limit(1);

  if (!group) {
    throw new OwnerCatalogConfigError({
      code: 'GROUP_NOT_FOUND',
      message: 'The selected add-on group does not belong to this salon.',
      anchor: { kind: 'group', groupId },
      status: 400,
    });
  }
}

/**
 * Deletion is deliberately BLOCKED while the group still has members —
 * matching migration 0073's own stated design ("un-grouping an add-on...
 * is an EXPLICIT application operation, never a cascade side effect"). The
 * owner must move or unlink every member add-on first; nothing here does
 * that silently on their behalf.
 */
export async function deleteAddOnGroup(salonId: string, groupId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const members = await tx
      .select({ id: addOnSchema.id })
      .from(addOnSchema)
      .where(and(eq(addOnSchema.salonId, salonId), eq(addOnSchema.groupId, groupId)));

    if (members.length > 0) {
      throw new OwnerCatalogConfigError({
        code: 'GROUP_HAS_MEMBERS',
        message: `This group still has ${members.length} add-on${members.length === 1 ? '' : 's'} in it. Move or unlink them before deleting the group.`,
        anchor: { kind: 'group', groupId },
        status: 409,
      });
    }

    const deleted = await tx
      .delete(addOnGroupSchema)
      .where(and(eq(addOnGroupSchema.id, groupId), eq(addOnGroupSchema.salonId, salonId)))
      .returning();

    if (deleted.length === 0) {
      throw new OwnerCatalogConfigError({
        code: 'GROUP_NOT_FOUND',
        message: 'Add-on group not found.',
        anchor: { kind: 'group', groupId },
        status: 404,
      });
    }
  });
}
