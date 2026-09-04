import 'server-only';

import { and, eq, or } from 'drizzle-orm';

import {
  type CanonicalOnboardingProfileMedia,
  CanonicalOnboardingProfileMediaError,
  type CanonicalOnboardingProfileMediaRole,
  deleteCanonicalOnboardingProfileMedia,
  saveCanonicalOnboardingProfileMedia,
} from '@/features/onboarding-v1-integration/canonical-profile-media.server';
import { readOnboardingMediaFile } from '@/features/onboarding-v1-integration/media-storage.server';
import { db } from '@/libs/DB';
import {
  onboardingSiteMediaSchema,
  onboardingSiteRevisionSchema,
  onboardingSiteSchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';

type CanonicalMediaTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type IdentityMediaRow = typeof onboardingSiteMediaSchema.$inferSelect;

type PreparedRole = {
  expectedLocalItemId: string | null;
  generated: boolean;
  mediaId: string | null;
  previous: CanonicalOnboardingProfileMedia[];
  projection: CanonicalOnboardingProfileMedia | null;
  removeCanonical: boolean;
  role: CanonicalOnboardingProfileMediaRole;
  technicianId: string | null;
};

export type PreparedCanonicalProfileMediaPromotion = {
  revisionId: string;
  roles: PreparedRole[];
  salonId: string;
  siteId: string;
};

const canonicalMetadata = (
  media: IdentityMediaRow,
): CanonicalOnboardingProfileMedia | null => {
  const publicUrl = media.metadata.canonicalPublicUrl;
  const storageKey = media.metadata.canonicalStorageKey;
  const storageProvider = media.metadata.canonicalStorageProvider;
  return typeof publicUrl === 'string'
    && typeof storageKey === 'string'
    && (storageProvider === 'cloudinary' || storageProvider === 'development_public')
    ? { publicUrl, storageKey, storageProvider }
    : null;
};

const uniqueProjections = (
  projections: CanonicalOnboardingProfileMedia[],
): CanonicalOnboardingProfileMedia[] => [...new Map(
  projections.map(projection => [
    `${projection.storageProvider}:${projection.storageKey}`,
    projection,
  ]),
).values()];

async function preparePromotion(input: {
  mediaId?: string;
  requireDraftSalon?: boolean;
  roles: readonly CanonicalOnboardingProfileMediaRole[];
  salonId: string;
}): Promise<PreparedCanonicalProfileMediaPromotion | null> {
  const [salon] = await db.select({
    logoUrl: salonSchema.logoUrl,
    publicationStatus: salonSchema.publicationStatus,
  }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).limit(1);
  if (!salon || (input.requireDraftSalon && salon.publicationStatus !== 'draft')) {
    return null;
  }

  const [site] = await db.select().from(onboardingSiteSchema).where(and(
    eq(onboardingSiteSchema.salonId, input.salonId),
    eq(onboardingSiteSchema.isCurrent, true),
  )).limit(1);
  if (!site || site.currentRevision < 1) {
    return null;
  }
  const [revision] = await db.select().from(onboardingSiteRevisionSchema).where(and(
    eq(onboardingSiteRevisionSchema.salonId, input.salonId),
    eq(onboardingSiteRevisionSchema.siteId, site.id),
    eq(onboardingSiteRevisionSchema.revision, site.currentRevision),
  )).limit(1);
  if (!revision) {
    return null;
  }

  const allIdentityMedia = await db.select().from(onboardingSiteMediaSchema).where(and(
    eq(onboardingSiteMediaSchema.salonId, input.salonId),
    eq(onboardingSiteMediaSchema.siteId, site.id),
    or(
      eq(onboardingSiteMediaSchema.role, 'logo'),
      eq(onboardingSiteMediaSchema.role, 'profile'),
    ),
  ));
  const currentMedia = allIdentityMedia.filter(media => media.revisionId === revision.id);
  const managedByUrl = new Map(
    allIdentityMedia.flatMap((media) => {
      const projection = canonicalMetadata(media);
      return media.claimStatus === 'ready' && projection
        ? [[projection.publicUrl, projection] as const]
        : [];
    }),
  );
  const technicians = await db.select({
    avatarUrl: technicianSchema.avatarUrl,
    id: technicianSchema.id,
    isActive: technicianSchema.isActive,
  }).from(technicianSchema).where(eq(technicianSchema.salonId, input.salonId));

  const roles: PreparedRole[] = [];
  for (const role of input.roles) {
    const expectedLocalItemId = role === 'logo'
      ? revision.snapshot.profile.logoItemId
      : revision.snapshot.profile.profilePhotoItemId;
    const media = expectedLocalItemId
      ? currentMedia.find(candidate => (
        candidate.role === role
        && candidate.localItemId === expectedLocalItemId
        && (!input.mediaId || candidate.id === input.mediaId)
      ))
      : null;
    if (expectedLocalItemId && (
      !media
      || media.claimStatus !== 'ready'
      || !media.storageKey
    )) {
      throw new CanonicalOnboardingProfileMediaError(
        'CANONICAL_MEDIA_NOT_READY',
        `The saved ${role === 'logo' ? 'logo' : 'profile photo'} is not ready to publish.`,
      );
    }
    if (input.mediaId && media?.id !== input.mediaId) {
      throw new CanonicalOnboardingProfileMediaError(
        'CANONICAL_MEDIA_REVISION_STALE',
        'A newer profile image has already been saved.',
      );
    }

    const activeTechnicians = technicians.filter(technician => technician.isActive);
    const technicianId = role === 'profile' && activeTechnicians.length === 1
      ? activeTechnicians[0]!.id
      : null;
    if (role === 'profile' && media && !technicianId) {
      throw new CanonicalOnboardingProfileMediaError(
        'CANONICAL_PROFILE_OWNER_UNRESOLVED',
        'Choose which team member this profile photo belongs to, then try again.',
      );
    }

    const previous = role === 'logo'
      ? salon.logoUrl && managedByUrl.has(salon.logoUrl)
        ? [managedByUrl.get(salon.logoUrl)!]
        : []
      : technicians.flatMap(technician => (
        technician.avatarUrl && managedByUrl.has(technician.avatarUrl)
          ? [managedByUrl.get(technician.avatarUrl)!]
          : []
      ));
    const existingProjection = media ? canonicalMetadata(media) : null;
    const projection = media && !existingProjection
      ? await saveCanonicalOnboardingProfileMedia({
        bytes: await readOnboardingMediaFile(media.storageKey!, { salonId: input.salonId, siteId: site.id }),
        mediaId: media.id,
        role,
        salonId: input.salonId,
        technicianId,
      })
      : existingProjection;
    // Absence is a removal only when the current Product field still points
    // at a READY onboarding projection. Historical pending/failed rows do not
    // establish ownership, and a later manual Product replacement wins.
    const removeCanonical = expectedLocalItemId === null && previous.length > 0;
    roles.push({
      expectedLocalItemId,
      generated: Boolean(media && !existingProjection),
      mediaId: media?.id ?? null,
      previous: uniqueProjections(previous),
      projection,
      removeCanonical,
      role,
      technicianId,
    });
  }

  return {
    revisionId: revision.id,
    roles,
    salonId: input.salonId,
    siteId: site.id,
  };
}

const assertPromotionStillCurrent = async (
  tx: CanonicalMediaTransaction,
  prepared: PreparedCanonicalProfileMediaPromotion,
): Promise<void> => {
  const [site] = await tx.select({
    currentRevision: onboardingSiteSchema.currentRevision,
    id: onboardingSiteSchema.id,
  }).from(onboardingSiteSchema).where(and(
    eq(onboardingSiteSchema.id, prepared.siteId),
    eq(onboardingSiteSchema.salonId, prepared.salonId),
    eq(onboardingSiteSchema.isCurrent, true),
  )).for('update').limit(1);
  const [revision] = site
    ? await tx.select({
      id: onboardingSiteRevisionSchema.id,
      snapshot: onboardingSiteRevisionSchema.snapshot,
    }).from(onboardingSiteRevisionSchema).where(and(
      eq(onboardingSiteRevisionSchema.salonId, prepared.salonId),
      eq(onboardingSiteRevisionSchema.siteId, prepared.siteId),
      eq(onboardingSiteRevisionSchema.revision, site.currentRevision),
    )).limit(1)
    : [];
  if (!revision || revision.id !== prepared.revisionId) {
    throw new CanonicalOnboardingProfileMediaError(
      'CANONICAL_MEDIA_REVISION_STALE',
      'A newer profile image has already been saved.',
    );
  }
  for (const role of prepared.roles) {
    const expectedLocalItemId = role.role === 'logo'
      ? revision.snapshot.profile.logoItemId
      : revision.snapshot.profile.profilePhotoItemId;
    if (expectedLocalItemId !== role.expectedLocalItemId) {
      throw new CanonicalOnboardingProfileMediaError(
        'CANONICAL_MEDIA_REVISION_STALE',
        'A newer profile image has already been saved.',
      );
    }
    if (role.mediaId) {
      const [media] = await tx.select({
        claimStatus: onboardingSiteMediaSchema.claimStatus,
        id: onboardingSiteMediaSchema.id,
        localItemId: onboardingSiteMediaSchema.localItemId,
        role: onboardingSiteMediaSchema.role,
      }).from(onboardingSiteMediaSchema).where(and(
        eq(onboardingSiteMediaSchema.id, role.mediaId),
        eq(onboardingSiteMediaSchema.salonId, prepared.salonId),
        eq(onboardingSiteMediaSchema.siteId, prepared.siteId),
        eq(onboardingSiteMediaSchema.revisionId, prepared.revisionId),
      )).limit(1);
      if (
        !media
        || media.claimStatus !== 'ready'
        || media.localItemId !== role.expectedLocalItemId
        || media.role !== role.role
      ) {
        throw new CanonicalOnboardingProfileMediaError(
          'CANONICAL_MEDIA_REVISION_STALE',
          'A newer profile image has already been saved.',
        );
      }
    }
  }
};

export const applyPreparedCanonicalProfileMediaPromotion = async (
  tx: CanonicalMediaTransaction,
  prepared: PreparedCanonicalProfileMediaPromotion,
): Promise<void> => {
  await assertPromotionStillCurrent(tx, prepared);
  for (const role of prepared.roles) {
    if (role.role === 'logo') {
      if (role.projection) {
        await tx.update(salonSchema).set({
          logoUrl: role.projection.publicUrl,
        }).where(eq(salonSchema.id, prepared.salonId));
      } else if (role.removeCanonical) {
        for (const previous of role.previous) {
          await tx.update(salonSchema).set({ logoUrl: null }).where(and(
            eq(salonSchema.id, prepared.salonId),
            eq(salonSchema.logoUrl, previous.publicUrl),
          ));
        }
      }
    } else if (role.projection && role.technicianId) {
      await tx.update(technicianSchema).set({
        avatarUrl: role.projection.publicUrl,
      }).where(and(
        eq(technicianSchema.id, role.technicianId),
        eq(technicianSchema.salonId, prepared.salonId),
        eq(technicianSchema.isActive, true),
      ));
    } else if (!role.projection && role.removeCanonical && role.technicianId) {
      for (const previous of role.previous) {
        await tx.update(technicianSchema).set({ avatarUrl: null }).where(and(
          eq(technicianSchema.id, role.technicianId),
          eq(technicianSchema.salonId, prepared.salonId),
          eq(technicianSchema.avatarUrl, previous.publicUrl),
          eq(technicianSchema.isActive, true),
        ));
      }
    } else if (!role.projection && role.removeCanonical) {
      for (const previous of role.previous) {
        await tx.update(technicianSchema).set({ avatarUrl: null }).where(and(
          eq(technicianSchema.salonId, prepared.salonId),
          eq(technicianSchema.avatarUrl, previous.publicUrl),
        ));
      }
    }

    if (role.mediaId && role.projection) {
      const [media] = await tx.select({
        metadata: onboardingSiteMediaSchema.metadata,
      }).from(onboardingSiteMediaSchema)
        .where(eq(onboardingSiteMediaSchema.id, role.mediaId))
        .limit(1);
      await tx.update(onboardingSiteMediaSchema).set({
        metadata: {
          ...(media?.metadata ?? {}),
          canonicalPublicUrl: role.projection.publicUrl,
          canonicalStorageKey: role.projection.storageKey,
          canonicalStorageProvider: role.projection.storageProvider,
        },
      }).where(and(
        eq(onboardingSiteMediaSchema.id, role.mediaId),
        eq(onboardingSiteMediaSchema.revisionId, prepared.revisionId),
        eq(onboardingSiteMediaSchema.claimStatus, 'ready'),
      ));
    }
  }
};

export const prepareCanonicalProfileMediaForPublish = (
  salonId: string,
): Promise<PreparedCanonicalProfileMediaPromotion | null> => preparePromotion({
  roles: ['logo', 'profile'],
  salonId,
});

const removeProjections = async (
  projections: CanonicalOnboardingProfileMedia[],
): Promise<void> => {
  await Promise.allSettled(uniqueProjections(projections).map(projection =>
    deleteCanonicalOnboardingProfileMedia(projection)));
};

export const completeCanonicalProfileMediaPromotion = async (
  prepared: PreparedCanonicalProfileMediaPromotion,
): Promise<void> => {
  const activeKeys = new Set(prepared.roles.flatMap(role => (
    role.projection
      ? [`${role.projection.storageProvider}:${role.projection.storageKey}`]
      : []
  )));
  await removeProjections(prepared.roles.flatMap(role => role.previous).filter(previous => (
    !activeKeys.has(`${previous.storageProvider}:${previous.storageKey}`)
  )));
};

export const discardPreparedCanonicalProfileMediaPromotion = async (
  prepared: PreparedCanonicalProfileMediaPromotion,
): Promise<void> => removeProjections(prepared.roles.flatMap(role => (
  role.generated && role.projection ? [role.projection] : []
)));

export const promoteCurrentDraftCanonicalIdentityMedia = async (
  mediaId: string,
  role: CanonicalOnboardingProfileMediaRole,
  salonId: string,
): Promise<CanonicalOnboardingProfileMedia | null> => {
  const prepared = await preparePromotion({
    mediaId,
    requireDraftSalon: true,
    roles: [role],
    salonId,
  });
  if (!prepared) {
    return null;
  }
  try {
    await db.transaction(tx => applyPreparedCanonicalProfileMediaPromotion(tx, prepared));
    await completeCanonicalProfileMediaPromotion(prepared);
    return prepared.roles[0]?.projection ?? null;
  } catch (error) {
    await discardPreparedCanonicalProfileMediaPromotion(prepared);
    throw error;
  }
};
