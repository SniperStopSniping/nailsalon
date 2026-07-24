import { z } from 'zod';

import {
  archiveSalonClient,
  getClientDependencySummary,
} from '@/libs/clientLifecycle';
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
            message: 'Invalid archive request',
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
    const client = await archiveSalonClient({
      salonId: guard.salon.id,
      clientId,
      expectedUpdatedAt: validated.data.expectedUpdatedAt,
      actor: guard.actor,
    });
    const dependencies = await getClientDependencySummary({
      salonId: guard.salon.id,
      clientId,
    });
    return privateClientJson({
      data: {
        client: {
          id: client.id,
          archivedAt: client.archivedAt?.toISOString() ?? null,
          mergedIntoClientId: client.mergedIntoClientId,
          updatedAt: client.updatedAt.toISOString(),
        },
        canPermanentlyDelete: dependencies.hardDeleteEligible,
      },
    });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to archive client');
  }
}
