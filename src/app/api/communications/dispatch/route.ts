/**
 * Communications dispatcher cron — GET/POST /api/communications/dispatch.
 *
 * CRON_SECRET-gated like /api/reminders/process. The dispatcher checks salon
 * preferences and the configured sender before sending. Shared Luster sends
 * additionally require platform enablement, pilot eligibility and credits.
 */
import { processDueCommunications } from '@/libs/communicationDispatcher';
import { evaluateLowBalanceWarnings, sendLowBalanceWarningEmail } from '@/libs/lowBalanceWarnings';
import { materializeCompletedReviewTriggers, scanScheduledEndReviewTriggers } from '@/libs/reviewRequests.server';
import { releaseExpiredInboundEvidence } from '@/libs/smsInboundRetention';
import { sendIntentEmail, sendViaTwilio } from '@/libs/twilioMessagingSend';
import { resolveUnknownOutcomes } from '@/libs/unknownOutcomeResolver';

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
    // Both configured Twilio sender modes use the same guarded provider seam.
    providerSend: sendViaTwilio,
    emailSend: sendIntentEmail,
  });
  const retention = await releaseExpiredInboundEvidence();
  // §7.5 resolver: adopt SIDs from signed callback evidence, alert on
  // over-budget unknowns. Never resends, never releases without proof.
  const unknownOutcomes = await resolveUnknownOutcomes();
  // §10.3 low-balance sweep: email + in-app only, once per tier per epoch.
  const lowBalance = await evaluateLowBalanceWarnings({
    sendWarningEmail: sendLowBalanceWarningEmail,
  });
  // Keep review automation after every established dispatcher/maintenance
  // phase. Its own bounded failures are observable but cannot delay reminders.
  let reviewTriggers;
  const reviewDeadlineMs = performance.now() + 15_000;
  try {
    reviewTriggers = await materializeCompletedReviewTriggers({ deadlineMs: reviewDeadlineMs });
  } catch {
    reviewTriggers = { materialized: 0, pending: 0, skipped: 0, deferred: 0, phaseError: true };
  }
  // Existing pending triggers keep priority within one admission budget.
  // A scan failure does not erase successfully materialized trigger counts.
  let scheduledEnd;
  try {
    scheduledEnd = await scanScheduledEndReviewTriggers({ deadlineMs: reviewDeadlineMs });
  } catch {
    scheduledEnd = { recorded: 0, skipped: 0, deferred: 0, phaseError: true };
  }
  return Response.json({ summary, reviewTriggers: { ...reviewTriggers, scheduledEnd }, retention, unknownOutcomes, lowBalance });
}

export const GET = run;
export const POST = run;
export const dynamic = 'force-dynamic';
