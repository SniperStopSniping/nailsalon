import { z } from 'zod';

import { mergeSalonClients } from '@/libs/clientLifecycle';
import {
  clientLifecycleErrorResponse,
  privateClientJson,
} from '@/libs/clientLifecycleHttp';
import { requireClientManagerSalon } from '@/libs/clientManagementAuth';

export const dynamic = 'force-dynamic';

const selection = z.enum(['primary', 'duplicate']);
const mergeSchema = z.object({
  salonSlug: z.string().min(1),
  primaryClientId: z.string().min(1).optional(),
  duplicateClientId: z.string().min(1),
  expectedPrimaryUpdatedAt: z.string().datetime({ offset: true }),
  expectedDuplicateUpdatedAt: z.string().datetime({ offset: true }),
  selections: z.object({
    fullName: selection.optional(),
    phone: selection.optional(),
    email: selection.optional(),
    birthday: selection.optional(),
    preferredTechnicianId: selection.optional(),
    sensitivities: selection.optional(),
    nailPreferences: selection.optional(),
    rebookIntervalDays: selection.optional(),
    notes: selection.optional(),
  }).optional(),
});

function serializeClient(
  client: Awaited<ReturnType<typeof mergeSalonClients>>['primary'],
) {
  const nameParts = client.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    id: client.id,
    fullName: client.fullName,
    firstName: nameParts[0] ?? '',
    lastName: nameParts.slice(1).join(' '),
    phone: client.phone,
    email: client.email,
    birthday: client.birthday,
    archivedAt: client.archivedAt?.toISOString() ?? null,
    mergedIntoClientId: client.mergedIntoClientId,
    updatedAt: client.updatedAt.toISOString(),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: primaryClientId } = await params;
    const validated = mergeSchema.safeParse(await request.json());
    if (!validated.success) {
      return privateClientJson(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid merge request',
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
    const result = await mergeSalonClients({
      salonId: guard.salon.id,
      primaryClientId,
      duplicateClientId: validated.data.duplicateClientId,
      expectedPrimaryUpdatedAt: validated.data.expectedPrimaryUpdatedAt,
      expectedDuplicateUpdatedAt: validated.data.expectedDuplicateUpdatedAt,
      actor: guard.actor,
      selections: validated.data.selections,
    });
    return privateClientJson({
      data: {
        primaryClientId: result.primary.id,
        primary: serializeClient(result.primary),
        duplicate: serializeClient(result.duplicate),
        idempotent: result.idempotent,
      },
    });
  } catch (error) {
    return clientLifecycleErrorResponse(error, 'Failed to merge clients');
  }
}
