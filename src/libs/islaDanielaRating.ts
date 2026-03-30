import { and, eq } from 'drizzle-orm';

import { db as liveDb } from '@/libs/DB';
import { salonSchema, technicianSchema } from '@/models/Schema';

export const ISLA_DANIELA_RATING_SALON_SLUG = 'isla-nail-studio';
export const ISLA_DANIELA_RATING_TECHNICIAN_NAME = 'Daniela';
export const ISLA_DANIELA_TARGET_RATING = '5.0';
export const ISLA_DANIELA_TARGET_REVIEW_COUNT = 37;

type DanielaRatingDb = Pick<typeof liveDb, 'select' | 'update'>;

export class IslaDanielaRatingAmbiguityError extends Error {
  readonly salonSlug = ISLA_DANIELA_RATING_SALON_SLUG;
  readonly status = 'multiple_matches' as const;
  readonly matchedTechnicianCount: number;
  readonly rating = ISLA_DANIELA_TARGET_RATING;
  readonly reviewCount = ISLA_DANIELA_TARGET_REVIEW_COUNT;

  constructor(matchedTechnicianCount: number) {
    super(`Multiple active Daniela technicians found in ${ISLA_DANIELA_RATING_SALON_SLUG}.`);
    this.name = 'IslaDanielaRatingAmbiguityError';
    this.matchedTechnicianCount = matchedTechnicianCount;
  }
}

export type IslaDanielaRatingResult =
  | {
      salonSlug: typeof ISLA_DANIELA_RATING_SALON_SLUG;
      status: 'salon_missing';
      updated: false;
      technicianId: null;
      matchedTechnicianCount: 0;
      rating: typeof ISLA_DANIELA_TARGET_RATING;
      reviewCount: typeof ISLA_DANIELA_TARGET_REVIEW_COUNT;
    }
  | {
      salonSlug: typeof ISLA_DANIELA_RATING_SALON_SLUG;
      status: 'technician_missing';
      updated: false;
      technicianId: null;
      matchedTechnicianCount: 0;
      rating: typeof ISLA_DANIELA_TARGET_RATING;
      reviewCount: typeof ISLA_DANIELA_TARGET_REVIEW_COUNT;
    }
  | {
      salonSlug: typeof ISLA_DANIELA_RATING_SALON_SLUG;
      status: 'updated' | 'unchanged';
      updated: boolean;
      technicianId: string;
      matchedTechnicianCount: 1;
      rating: typeof ISLA_DANIELA_TARGET_RATING;
      reviewCount: typeof ISLA_DANIELA_TARGET_REVIEW_COUNT;
    };

export async function backfillIslaDanielaRating(args: {
  db: DanielaRatingDb;
}): Promise<IslaDanielaRatingResult> {
  const salons = await args.db
    .select({
      id: salonSchema.id,
      slug: salonSchema.slug,
    })
    .from(salonSchema)
    .where(
      and(
        eq(salonSchema.slug, ISLA_DANIELA_RATING_SALON_SLUG),
        eq(salonSchema.isActive, true),
      ),
    )
    .limit(1);

  const salon = salons[0];
  if (!salon) {
    return {
      salonSlug: ISLA_DANIELA_RATING_SALON_SLUG,
      status: 'salon_missing',
      updated: false,
      technicianId: null,
      matchedTechnicianCount: 0,
      rating: ISLA_DANIELA_TARGET_RATING,
      reviewCount: ISLA_DANIELA_TARGET_REVIEW_COUNT,
    };
  }

  const technicians = await args.db
    .select({
      id: technicianSchema.id,
      name: technicianSchema.name,
      rating: technicianSchema.rating,
      reviewCount: technicianSchema.reviewCount,
    })
    .from(technicianSchema)
    .where(
      and(
        eq(technicianSchema.salonId, salon.id),
        eq(technicianSchema.name, ISLA_DANIELA_RATING_TECHNICIAN_NAME),
        eq(technicianSchema.isActive, true),
      ),
    )
    .limit(2);

  if (technicians.length === 0) {
    return {
      salonSlug: ISLA_DANIELA_RATING_SALON_SLUG,
      status: 'technician_missing',
      updated: false,
      technicianId: null,
      matchedTechnicianCount: 0,
      rating: ISLA_DANIELA_TARGET_RATING,
      reviewCount: ISLA_DANIELA_TARGET_REVIEW_COUNT,
    };
  }

  if (technicians.length > 1) {
    throw new IslaDanielaRatingAmbiguityError(technicians.length);
  }

  const technician = technicians[0]!;
  const needsUpdate = technician.rating !== ISLA_DANIELA_TARGET_RATING
    || technician.reviewCount !== ISLA_DANIELA_TARGET_REVIEW_COUNT;

  if (needsUpdate) {
    await args.db
      .update(technicianSchema)
      .set({
        rating: ISLA_DANIELA_TARGET_RATING,
        reviewCount: ISLA_DANIELA_TARGET_REVIEW_COUNT,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(technicianSchema.id, technician.id),
          eq(technicianSchema.salonId, salon.id),
        ),
      );
  }

  return {
    salonSlug: ISLA_DANIELA_RATING_SALON_SLUG,
    status: needsUpdate ? 'updated' : 'unchanged',
    updated: needsUpdate,
    technicianId: technician.id,
    matchedTechnicianCount: 1,
    rating: ISLA_DANIELA_TARGET_RATING,
    reviewCount: ISLA_DANIELA_TARGET_REVIEW_COUNT,
  };
}
