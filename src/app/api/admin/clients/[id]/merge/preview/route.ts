import { z } from 'zod';

import { getClientMergePreview } from '@/libs/clientLifecycle';
import {
  clientLifecycleErrorResponse,
  privateClientJson,
} from '@/libs/clientLifecycleHttp';
import { requireClientManagerSalon } from '@/libs/clientManagementAuth';

export const dynamic = 'force-dynamic';

const previewSchema = z.object({
  salonSlug: z.string().min(1),
  primaryClientId: z.string().min(1).optional(),
  duplicateClientId: z.string().min(1),
});

function serializeClient(
  side: Awaited<ReturnType<typeof getClientMergePreview>>['primary'],
) {
  return {
    ...side.client,
    archivedAt: side.client.archivedAt?.toISOString() ?? null,
    updatedAt: side.client.updatedAt.toISOString(),
    aliases: side.aliases,
    externalPreferences: side.externalPreferences,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: primaryClientId } = await params;
    const validated = previewSchema.safeParse(await request.json());
    if (!validated.success) {
      return privateClientJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid merge preview request',
            details: validated.error.flatten(),
          },
        },
        { status: 400 },
      );
    }
    if (
      validated.data.primaryClientId
      && validated.data.primaryClientId !== primaryClientId
    ) {
      return privateClientJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The primary client does not match this profile.',
          },
        },
        { status: 400 },
      );
    }
    const guard = await requireClientManagerSalon(validated.data.salonSlug);
    if (!guard.ok) {
      return guard.response;
    }
    const preview = await getClientMergePreview({
      salonId: guard.salon.id,
      primaryClientId,
      duplicateClientId: validated.data.duplicateClientId,
    });
    return privateClientJson({
      data: {
        preview: {
          primary: serializeClient(preview.primary),
          duplicate: serializeClient(preview.duplicate),
          records: {
            primary: preview.primary.records,
            duplicate: preview.duplicate.records,
          },
          recordCounts: preview.duplicate.records,
          conflicts: preview.conflicts,
          versions: {
            primary: preview.primary.client.updatedAt.toISOString(),
            duplicate: preview.duplicate.client.updatedAt.toISOString(),
          },
        },
      },
    });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to preview client merge');
  }
}
