type CronHeartbeat = 'deposit_reconcile' | 'integration_outbox';

const HEARTBEAT_ENV = {
  deposit_reconcile: 'CHECKLY_DEPOSIT_RECONCILE_HEARTBEAT_URL',
  integration_outbox: 'CHECKLY_INTEGRATION_OUTBOX_HEARTBEAT_URL',
} as const satisfies Record<CronHeartbeat, string>;

export type CronHeartbeatResult = 'sent' | 'skipped' | 'failed';

/**
 * Reports a completed cron invocation to its Checkly heartbeat.
 *
 * The generated heartbeat URL is configured after the Checkly-as-code resource
 * is deployed. Missing configuration deliberately skips the ping so the first
 * deployment can finish before the owner installs the generated URL. Once the
 * Checkly resource is active, a missing or failing ping is itself what causes
 * the out-of-band alert.
 *
 * A monitoring outage must never turn completed money work into another cron
 * attempt. This helper therefore has a bounded request and never throws.
 */
export async function pingCronHeartbeat(
  heartbeat: CronHeartbeat,
): Promise<CronHeartbeatResult> {
  const rawEndpoint = process.env[HEARTBEAT_ENV[heartbeat]]?.trim();
  if (!rawEndpoint) {
    return 'skipped';
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    return 'failed';
  }

  if (
    endpoint.protocol !== 'https:'
    || endpoint.hostname !== 'ping.checklyhq.com'
    || endpoint.username
    || endpoint.password
    || endpoint.hash
  ) {
    return 'failed';
  }

  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
