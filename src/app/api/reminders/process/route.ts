import { processAppointmentReminders } from '@/libs/appointmentReminders';

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export async function POST(request: Request): Promise<Response> {
  try {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      return Response.json(
        {
          error: {
            code: 'MISCONFIGURED',
            message: 'Server misconfiguration',
          },
        } satisfies ErrorResponse,
        { status: 500 },
      );
    }

    const providedSecret = getCronSecret(request);
    if (!providedSecret || providedSecret !== expectedSecret) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or missing cron secret',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    const result = await processAppointmentReminders();
    return Response.json({ data: result });
  } catch (error) {
    console.error('[REMINDERS] Failed to process appointment reminders:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process appointment reminders',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

function getCronSecret(request: Request): string | null {
  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret) {
    return headerSecret;
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  return null;
}
