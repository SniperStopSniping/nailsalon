import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { getSuperAdminInfo, requireSuperAdmin } from '@/libs/superAdmin';
import { isValidSalonSlug } from '@/libs/tenantSlug';
import { salonAuditLogSchema, salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const changeSalonSlugSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1, 'Slug is required'),
  expectedCurrentSlug: z.string().trim().toLowerCase().min(1, 'Current slug is required'),
});

type SlugChangeResult =
  | { kind: 'not_found' }
  | { kind: 'stale'; salon: typeof salonSchema.$inferSelect }
  | {
    kind: 'success';
    changed: boolean;
    previousSlug: string;
    salon: typeof salonSchema.$inferSelect;
  };

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === '23505') {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

function serializeSalon(salon: typeof salonSchema.$inferSelect) {
  return {
    id: salon.id,
    name: salon.name,
    slug: salon.slug,
    customDomain: salon.customDomain,
    slugLockedAt: salon.slugLockedAt?.toISOString() ?? null,
    updatedAt: salon.updatedAt.toISOString(),
  };
}

function buildCanonicalUrls(salon: typeof salonSchema.$inferSelect) {
  return {
    publicUrl: buildSalonTenantPublicUrl('/', salon),
    bookingUrl: buildSalonTenantPublicUrl('/book', salon),
    findBookingUrl: buildSalonTenantPublicUrl('/find-booking', salon),
  };
}

// PATCH /api/super-admin/organizations/[id]/slug - Change a salon's public slug.
//
// This intentionally lives outside the general salon update endpoint. Published
// salons lock their slug against ordinary edits, while this explicit operation
// is the audited super-admin escape hatch for a business rename.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSuperAdmin();
  if (guard) {
    return guard;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validated = changeSalonSlugSchema.safeParse(body);
  if (!validated.success) {
    return Response.json(
      { error: 'Invalid request data', details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const { slug, expectedCurrentSlug } = validated.data;
  if (!isValidSalonSlug(slug)) {
    return Response.json(
      { error: 'This slug is invalid or reserved by Luster' },
      { status: 400 },
    );
  }

  const adminInfo = await getSuperAdminInfo();
  if (!adminInfo) {
    return Response.json({ error: 'Super admin session not found' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const result = await db.transaction<SlugChangeResult>(async (tx) => {
      const [existing] = await tx
        .select()
        .from(salonSchema)
        .where(eq(salonSchema.id, id))
        .limit(1);

      if (!existing) {
        return { kind: 'not_found' };
      }

      // A retry after a lost response is successful when the requested target
      // state is already present, even if expectedCurrentSlug names the old
      // value from the first attempt. Do not create a duplicate audit row.
      if (existing.slug === slug) {
        return {
          kind: 'success',
          changed: false,
          previousSlug: existing.slug,
          salon: existing,
        };
      }

      if (existing.slug !== expectedCurrentSlug) {
        return { kind: 'stale', salon: existing };
      }

      // The slug predicate is the optimistic-concurrency control. If another
      // request wins after the read above, this update returns no row and no
      // audit entry is written.
      const [updated] = await tx
        .update(salonSchema)
        .set({ slug })
        .where(and(
          eq(salonSchema.id, id),
          eq(salonSchema.slug, expectedCurrentSlug),
        ))
        .returning();

      if (!updated) {
        const [current] = await tx
          .select()
          .from(salonSchema)
          .where(eq(salonSchema.id, id))
          .limit(1);

        return current
          ? { kind: 'stale', salon: current }
          : { kind: 'not_found' };
      }

      await tx.insert(salonAuditLogSchema).values({
        id: crypto.randomUUID(),
        salonId: id,
        action: 'updated',
        performedBy: adminInfo.userId,
        performedByEmail: adminInfo.email,
        metadata: {
          field: 'slug',
          previousValue: existing.slug,
          newValue: updated.slug,
          details: `Changed salon slug from ${existing.slug} to ${updated.slug}`,
        },
      });

      return {
        kind: 'success',
        changed: true,
        previousSlug: existing.slug,
        salon: updated,
      };
    });

    if (result.kind === 'not_found') {
      return Response.json({ error: 'Salon not found' }, { status: 404 });
    }

    if (result.kind === 'stale') {
      return Response.json(
        {
          error: 'The salon slug changed since this page was loaded',
          currentSlug: result.salon.slug,
          salon: serializeSalon(result.salon),
          canonicalUrls: buildCanonicalUrls(result.salon),
        },
        { status: 409 },
      );
    }

    return Response.json({
      changed: result.changed,
      previousSlug: result.previousSlug,
      salon: serializeSalon(result.salon),
      canonicalUrls: buildCanonicalUrls(result.salon),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json(
        { error: 'A salon with this slug already exists' },
        { status: 409 },
      );
    }

    console.error('Error changing salon slug:', error);
    return Response.json({ error: 'Failed to change salon slug' }, { status: 500 });
  }
}
