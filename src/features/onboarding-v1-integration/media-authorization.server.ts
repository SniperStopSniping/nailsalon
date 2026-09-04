import { and, eq } from 'drizzle-orm';

import { getAdminSession } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  onboardingSiteRevisionSchema,
  onboardingSiteSchema,
} from '@/models/Schema';

export type AuthorizedOnboardingSite = {
  adminId: string;
  revision: number;
  revisionId: string;
  salonId: string;
  siteId: string;
};

export const authorizeOnboardingSite = async (
  siteId: string,
  options: { ownerOnly?: boolean } = {},
): Promise<AuthorizedOnboardingSite | null> => {
  const admin = await getAdminSession();
  if (!admin) {
    return null;
  }

  const [site] = await db
    .select({
      currentRevision: onboardingSiteSchema.currentRevision,
      id: onboardingSiteSchema.id,
      salonId: onboardingSiteSchema.salonId,
    })
    .from(onboardingSiteSchema)
    .where(eq(onboardingSiteSchema.id, siteId))
    .limit(1);
  if (
    !site
    || !admin.salons.some(salon => (
      salon.salonId === site.salonId
      && (!options.ownerOnly || salon.role === 'owner')
    ))
  ) {
    return null;
  }

  const [revision] = await db
    .select({ id: onboardingSiteRevisionSchema.id })
    .from(onboardingSiteRevisionSchema)
    .where(and(
      eq(onboardingSiteRevisionSchema.siteId, site.id),
      eq(onboardingSiteRevisionSchema.salonId, site.salonId),
      eq(onboardingSiteRevisionSchema.revision, site.currentRevision),
    ))
    .limit(1);
  if (!revision) {
    return null;
  }

  return {
    adminId: admin.id,
    revision: site.currentRevision,
    revisionId: revision.id,
    salonId: site.salonId,
    siteId: site.id,
  };
};
