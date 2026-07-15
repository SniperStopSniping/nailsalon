import { processGoogleCalendarInboundSync } from '@/libs/googleCalendarInbound';
import { processIntegrationOutbox } from '@/libs/integrationOutbox';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  return request.headers.get('x-cron-secret') === secret || request.headers.get('authorization') === `Bearer ${secret}`;
}

async function handleProcess(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [outbound, inbound] = await Promise.all([
    processIntegrationOutbox(),
    processGoogleCalendarInboundSync(),
  ]);
  return Response.json({ data: { outbound, inbound } });
}

export const GET = handleProcess;
export const POST = handleProcess;
