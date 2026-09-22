import { randomUUID } from 'node:crypto';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { getBusinessHoursForDate, getDayKeyFromDateKey } from '@/libs/calendarSchedule';
import { getSalonById } from '@/libs/queries';
import { getVoiceRuntimeConfig } from '@/libs/voiceReceptionist/config.server';
import { readVoiceForm, verifyVoiceTwilio, voiceRouteToken, voiceTokenHash } from '@/libs/voiceReceptionist/security.server';
import { createVoiceCall, getVoiceSettings, resolveVoiceNumber } from '@/libs/voiceReceptionist/storage.server';
import { twimlUnavailable, voiceDialTwiml } from '@/libs/voiceReceptionist/transport.server';
import type { SalonSettings } from '@/types/salonPolicy';

export const runtime = 'nodejs';
export const maxDuration = 800;

const CALL_SID = /^CA[0-9a-f]{32}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;

function localTime(salon: { businessHours: Parameters<typeof getBusinessHoursForDate>[0]; settings: unknown }) {
  const timeZone = resolveBookingConfigFromSettings(salon.settings as SalonSettings).timezone;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const dateKey = `${part('year')}-${part('month')}-${part('day')}`;
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  return { dateKey, minutes };
}

function salonIsOpenNow(salon: { businessHours: Parameters<typeof getBusinessHoursForDate>[0]; settings: unknown }): boolean | null {
  const current = localTime(salon);
  const dayKey = getDayKeyFromDateKey(current.dateKey);
  if (!salon.businessHours || !dayKey) {
    return null;
  }
  // A published `null` weekday is an explicit owner closure. An absent or
  // malformed weekday is unknown, so after-hours mode stays conservative.
  if (salon.businessHours[dayKey] === null) {
    return false;
  }
  const hours = getBusinessHoursForDate(salon.businessHours, current.dateKey);
  if (!hours) {
    return null;
  }
  return current.minutes >= hours.openMinutes && current.minutes < hours.closeMinutes;
}

export async function POST(request: Request) {
  const config = getVoiceRuntimeConfig('phone');
  if (!config) {
    return twimlUnavailable();
  }
  const form = await readVoiceForm(request);
  if (!form || !verifyVoiceTwilio(request, form, config) || form.Direction !== 'inbound' || !CALL_SID.test(form.CallSid ?? '') || !E164.test(form.To ?? '')) {
    return new Response(null, { status: 403 });
  }
  const route = await resolveVoiceNumber(form.AccountSid!, form.To!);
  if (!route) {
    return new Response(null, { status: 404 });
  }
  const salon = await getSalonById(route.salonId);
  if (!salon || salon.publicationStatus !== 'published' || !salon.onlineBookingEnabled) {
    return twimlUnavailable();
  }
  const settings = await getVoiceSettings(salon.id);
  if (!settings.enabled || (settings.answerMode === 'after_hours' && salonIsOpenNow(salon) !== false)) {
    return twimlUnavailable();
  }
  const id = randomUUID();
  const routeExpiresAt = new Date(Date.now() + 180_000);
  const draft = { id, salonId: salon.id, providerCallId: form.CallSid!, routeExpiresAt };
  const token = voiceRouteToken(draft, config.signingSecret);
  try {
    const created = await createVoiceCall({ id, salonId: salon.id, provider: 'twilio', providerCallId: form.CallSid!, providerAccountSid: form.AccountSid!, callerNumber: E164.test(form.From ?? '') ? form.From : null, routeTokenHash: voiceTokenHash(token), routeExpiresAt });
    return new Response(voiceDialTwiml(created.call, config), { headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    return twimlUnavailable();
  }
}
