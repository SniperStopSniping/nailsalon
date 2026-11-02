import 'server-only';

import type { DanielaConfig } from './config';
import { sendSms, sendTelegram } from './providers';
import { parseSheets, readSheets, syncContact } from './sheets';
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
  if (config.mode === 'live') {
    for (let i = 0; i < 10 && Date.now() < deadline; i += 1) {
      const event = await claimAlert(config);
      if (!event) {
        break;
      }
      const text = `Isla ${event.kind === 'call' ? 'call' : 'text'} from ${event.phone || 'unavailable number'}\n${event.body || ''}\nBooking reply: ${event.outcome}.\nReceived: ${event.receivedAt.toISOString()}\nEvent: ${event.providerSid}`;
      const sent = await sendTelegram(config, text);
      await finishAlert(config, event.id, sent);
      if (sent) {
        summary.alerts += 1;
      }
    }
  }
  await scrubOldBodies(config);
  return summary;
}
