/**
 * Communications dispatcher cron — GET/POST /api/communications/dispatch.
 *
 * CRON_SECRET-gated exactly like /api/reminders/process. DARK BY DEFAULT:
 * without COMMUNICATIONS_SMS_ENABLED + an enabled platform control row +
 * pilot allowlisting + credits, every claimed intent defers or suppresses —
 * deploying this route sends nothing. The provider send function is a
 * fail-closed stub in Gate B (no Twilio import anywhere in the pipeline);
 * Gate C wires the real Messaging Service sender.
 */
import { processDueCommunications } from '@/libs/communicationDispatcher';
import { releaseExpiredInboundEvidence } from '@/libs/smsInboundRetention';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const header = request.headers.get('x-cron-secret');
  const bearer = request.headers.get('authorization');
  return header === secret || bearer === `Bearer ${secret}`;
}

async function run(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const summary = await processDueCommunications({
    workerId: `cron_${crypto.randomUUID().slice(0, 8)}`,
    // Gate B ships NO provider path: the stub fails closed, which the
    // dispatcher records as a sync provider rejection (release, no debit).
    providerSend: async () => {
      throw new Error('PROVIDER_NOT_WIRED');
    },
  });
  const retention = await releaseExpiredInboundEvidence();
  return Response.json({ summary, retention });
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
