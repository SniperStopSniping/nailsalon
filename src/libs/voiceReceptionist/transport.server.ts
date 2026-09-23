import 'server-only';

import { VOICE_CALL_LIMIT_SECONDS, type VoiceRuntimeConfig } from './config.server';
import { voiceRouteToken } from './security.server';

type VoiceDialCall = {
  id: string;
  salonId: string;
  providerCallId: string;
  routeExpiresAt: Date;
  createdAt: Date;
};

function xml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;' })[char]!);
}

export function voiceDialTwiml(call: VoiceDialCall, config: VoiceRuntimeConfig): string {
  const token = voiceRouteToken(call, config.signingSecret);
  const action = `${config.origin}/api/voice/twilio/dial-ended`;
  const remaining = Math.max(1, Math.floor((call.createdAt.getTime() + VOICE_CALL_LIMIT_SECONDS * 1000 - Date.now()) / 1000));
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeLimit="${remaining}" answerOnBridge="true" action="${xml(action)}" method="POST"><Sip>sip:${xml(config.projectId)}@sip.api.openai.com;transport=tls;secure=true?X-Luster-Route=${xml(token)}</Sip></Dial></Response>`;
}

export function twimlUnavailable(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are unable to answer right now. Please try again shortly.</Say></Response>', {
    status: 503,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Deliberate pre-answer rejection must not invoke Twilio's failure fallback URL. */
export function twimlRejected(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
