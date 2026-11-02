import 'server-only';

import type { CallerContext } from './alerts';
import { formatOwnerAlert } from './alerts';
import { getCallerContext } from './callerContext.server';
import type { DanielaConfig } from './config';
import { sendSms, sendTelegram } from './providers';
import { parseSheets, readSheets, syncContact } from './sheets';
import type { AlertTarget } from './store';
import { claimAlert, claimSend, dirtyContacts, finishAlert, finishSend, importContacts, markContactSynced, queueCampaign, scrubOldBodies } from './store';

/** Runs after the webhook response for prompt text-back; cron recovers interrupted work. */
export async function dispatchPending(config: DanielaConfig): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const item = await claimSend(config);
    if (!item) {
      break;
    }
    await finishSend(config, item, await sendSms(config, item));
  }
}

/** Immediate event-specific delivery; the cron drain recovers pending work. */
export async function dispatchOwnerAlerts(config: DanielaConfig, target?: AlertTarget, deadline = Date.now() + 25_000): Promise<number> {
  if (config.mode !== 'live') {
    return 0;
  }
  let sentCount = 0;
  for (let i = 0; i < (target ? 1 : 10) && Date.now() < deadline; i += 1) {
    const event = await claimAlert(config, new Date(), target);
    if (!event) {
      break;
    }
    let context: CallerContext;
    try {
      context = await getCallerContext(config, event.phone);
    } catch {
      // Optional booking context must never prevent the basic owner alert.
      context = { match: 'unavailable', name: null, nextAppointment: null };
    }
    const sent = await sendTelegram(config, formatOwnerAlert(event, context));
    await finishAlert(config, event.id, sent);
    if (sent) {
      sentCount += 1;
    }
  }
  return sentCount;
}

/** Network failures never replay SMS; they leave durable per-provider outcome evidence. */
export async function processDaniela(config: DanielaConfig): Promise<Record<string, number | boolean>> {
  const deadline = Date.now() + 75_000;
  const summary = { imported: 0, campaignQueued: false, smsAttempts: 0, synced: 0, alerts: 0, sheetsFailed: false };
  let sheets: Awaited<ReturnType<typeof readSheets>> | null = null;
  try {
    sheets = await readSheets(config);
    const rows = parseSheets(sheets.snapshots);
    summary.imported = await importContacts(config, rows);
    summary.campaignQueued = await queueCampaign(config);
  } catch {
    // Skip campaign admission if we cannot refresh its suppression/attempt state.
    summary.sheetsFailed = true;
  }
  for (let i = 0; i < 10 && Date.now() < deadline; i += 1) {
    const item = await claimSend(config);
    if (!item) {
      break;
    }
    const result = await sendSms(config, item);
    await finishSend(config, item, result);
    summary.smsAttempts += 1;
  }
  if (config.mode === 'live' && sheets) {
    for (const contact of await dirtyContacts(config)) {
      if (Date.now() >= deadline) {
        break;
      }
      try {
        await syncContact(contact, sheets);
        await markContactSynced(config, contact);
        summary.synced += 1;
      } catch {
        summary.sheetsFailed = true;
        break;
      }
    }
  }
  summary.alerts = await dispatchOwnerAlerts(config, undefined, deadline);
  await scrubOldBodies(config);
  return summary;
}
