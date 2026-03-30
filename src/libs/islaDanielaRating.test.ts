import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ISLA_DANIELA_TARGET_RATING,
  ISLA_DANIELA_TARGET_REVIEW_COUNT,
  backfillIslaDanielaRating,
  IslaDanielaRatingAmbiguityError,
} from './islaDanielaRating';

const {
  updateSetSpy,
  setSelectPlan,
  db,
} = vi.hoisted(() => {
  let selectPlan: unknown[] = [];
  const updateSetSpy = vi.fn();

  return {
    updateSetSpy,
    setSelectPlan: (plan: unknown[]) => {
      selectPlan = plan;
    },
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => selectPlan.shift() ?? []),
            then: undefined,
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: updateSetSpy.mockImplementation(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    },
  };
});

describe('backfillIslaDanielaRating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when isla-nail-studio does not exist', async () => {
    setSelectPlan([[]]);

    const result = await backfillIslaDanielaRating({ db: db as never });

    expect(result).toEqual(expect.objectContaining({
      status: 'salon_missing',
      updated: false,
      technicianId: null,
    }));
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does nothing when Daniela is missing in the target salon', async () => {
    setSelectPlan([
      [{ id: 'salon_isla', slug: 'isla-nail-studio' }],
      [],
    ]);

    const result = await backfillIslaDanielaRating({ db: db as never });

    expect(result).toEqual(expect.objectContaining({
      status: 'technician_missing',
      updated: false,
      technicianId: null,
    }));
    expect(db.update).not.toHaveBeenCalled();
  });

  it('fails loudly without mutation when multiple Daniela matches exist in isla-nail-studio', async () => {
    setSelectPlan([
      [{ id: 'salon_isla', slug: 'isla-nail-studio' }],
      [
        { id: 'tech_1', name: 'Daniela', rating: '4.9', reviewCount: 12 },
        { id: 'tech_2', name: 'Daniela', rating: '4.8', reviewCount: 9 },
      ],
    ]);

    await expect(backfillIslaDanielaRating({ db: db as never })).rejects.toMatchObject({
      name: 'IslaDanielaRatingAmbiguityError',
      status: 'multiple_matches',
      matchedTechnicianCount: 2,
    } satisfies Partial<IslaDanielaRatingAmbiguityError>);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates only the target Daniela record when the stored aggregate differs', async () => {
    setSelectPlan([
      [{ id: 'salon_isla', slug: 'isla-nail-studio' }],
      [{ id: 'tech_daniela', name: 'Daniela', rating: '4.9', reviewCount: 12 }],
    ]);

    const result = await backfillIslaDanielaRating({ db: db as never });

    expect(result).toEqual(expect.objectContaining({
      status: 'updated',
      updated: true,
      technicianId: 'tech_daniela',
    }));
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({
      rating: ISLA_DANIELA_TARGET_RATING,
      reviewCount: ISLA_DANIELA_TARGET_REVIEW_COUNT,
    }));
  });

  it('leaves another salons Daniela untouched because only the target salon row is selected', async () => {
    setSelectPlan([
      [{ id: 'salon_isla', slug: 'isla-nail-studio' }],
      [{ id: 'tech_daniela', name: 'Daniela', rating: '5.0', reviewCount: 37 }],
    ]);

    const result = await backfillIslaDanielaRating({ db: db as never });

    expect(result).toEqual(expect.objectContaining({
      status: 'unchanged',
      updated: false,
      technicianId: 'tech_daniela',
    }));
    expect(db.update).not.toHaveBeenCalled();
  });
});
