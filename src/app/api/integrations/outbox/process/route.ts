import { pingCronHeartbeat } from '@/libs/cronHeartbeat';
import { withTransientDatabaseRetry } from '@/libs/databaseRetry';
import { processGoogleCalendarInboundSync } from '@/libs/googleCalendarInbound';
import { processIntegrationOutbox } from '@/libs/integrationOutbox';

// Work is aborted at 240 seconds and the route stops waiting at 250. Provider
// duration configuration is deliberately outside this scope-clean D5 change.
const WORK_BUDGET_MS = 240_000;
const HARD_STOP_MS = 250_000;

class IntegrationWorkerBudgetError extends Error {
  constructor() {
    super('INTEGRATION_WORKER_BUDGET_EXCEEDED');
    this.name = 'IntegrationWorkerBudgetError';
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  return (
    request.headers.get('x-cron-secret') === secret
    || request.headers.get('authorization') === `Bearer ${secret}`
  );
}

async function handleProcess(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const controller = new AbortController();
  const budgetError = new IntegrationWorkerBudgetError();
  const budgetTimer = setTimeout(() => controller.abort(budgetError), WORK_BUDGET_MS);
  budgetTimer.unref();
  let hardStopTimer: ReturnType<typeof setTimeout> | undefined;
  const hardStop = new Promise<never>((_resolve, reject) => {
    hardStopTimer = setTimeout(() => reject(budgetError), HARD_STOP_MS);
    hardStopTimer.unref();
  });
  const work = Promise.all([
    withTransientDatabaseRetry(() => processIntegrationOutbox(2, {
      signal: controller.signal,
    })),
    withTransientDatabaseRetry(() => processGoogleCalendarInboundSync(
      2,
      undefined,
      { signal: controller.signal },
    )),
  ]).then(async (result) => {
    if (controller.signal.aborted) {
      throw budgetError;
    }
    await pingCronHeartbeat('integration_outbox');
    return result;
  });

  try {
    const [outbound, inbound] = await Promise.race([work, hardStop]);
    return Response.json({ data: { outbound, inbound } });
  } finally {
    clearTimeout(budgetTimer);
    clearTimeout(hardStopTimer);
    controller.abort();
  }
}

export const GET = handleProcess;
export const POST = handleProcess;
