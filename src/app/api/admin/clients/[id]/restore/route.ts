import { z } from 'zod';

import { restoreSalonClient } from '@/libs/clientLifecycle';
import {
  clientLifecycleErrorResponse,
  privateClientJson,
} from '@/libs/clientLifecycleHttp';
import { requireClientManagerSalon } from '@/libs/clientManagementAuth';

export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  salonSlug: z.string().min(1),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: clientId } = await params;
    const validated = actionSchema.safeParse(await request.json());
    if (!validated.success) {
      return privateClientJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid restore request',
            details: validated.error.flatten(),
          },
        },
        { status: 400 },
      );
    }
    const guard = await requireClientManagerSalon(validated.data.salonSlug);
    if (!guard.ok) {
      return guard.response;
    }
    const client = await restoreSalonClient({
      salonId: guard.salon.id,
      clientId,
      expectedUpdatedAt: validated.data.expectedUpdatedAt,
      actor: guard.actor,
    });
    return privateClientJson({
      data: {
        client: {
          id: client.id,
          archivedAt: null,
          mergedIntoClientId: client.mergedIntoClientId,
          updatedAt: client.updatedAt.toISOString(),
        },
        canPermanentlyDelete: false,
      },
    });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to restore client');
  }
}
