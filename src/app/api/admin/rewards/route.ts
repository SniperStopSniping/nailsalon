import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { getRewardDisplayContent } from '@/libs/rewardRules';
import { rewardSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const listRewardsSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = listRewardsSchema.safeParse(Object.fromEntries(searchParams.entries()));

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, limit, offset } = parsed.data;
    const { error, salon } = await requireAdminSalon(salonSlug);

    if (error || !salon) {
      return error!;
    }

    const rewards = await db
      .select()
      .from(rewardSchema)
      .where(eq(rewardSchema.salonId, salon.id))
      .orderBy(desc(rewardSchema.createdAt))
      .limit(limit)
      .offset(offset);

    return Response.json({
      data: {
        rewards: rewards.map((reward) => {
          const display = getRewardDisplayContent(reward);
          return {
            ...reward,
            displayTitle: display.title,
            displaySubtitle: display.subtitle,
            kindLabel: display.kindLabel,
            valueLabel: display.valueLabel,
          };
        }),
      },
      meta: {
        timestamp: new Date().toISOString(),
        limit,
        offset,
        total: rewards.length,
      },
    });
  } catch (error) {
    console.error('Error listing admin rewards:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load rewards',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
