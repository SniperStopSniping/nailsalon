/** Private Isla automation policy. No provider calls or database access. */
export const DANIELA_SALON_SLUG = 'isla-nail-studio';
export const BOOKING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizePhone(value: string): string | null {
  if (/[^\d\s()+.-]/u.test(value)) {
    return null;
  }
  const digits = value.replace(/\D/gu, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/u.test(national) ? `+1${national}` : null;
}

export function inboundKeyword(body: string, optOutType = ''): 'stop' | 'start' | 'help' | 'other' {
  const text = body.trim().toUpperCase();
  const provider = optOutType.trim().toUpperCase();
  if (provider === 'STOP' || /^(?:STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/u.test(text)) {
    return 'stop';
  }
  if (provider === 'START' || /^(?:START|UNSTOP)$/u.test(text)) {
    return 'start';
  }
  return provider === 'HELP' || text === 'HELP' ? 'help' : 'other';
}

export function torontoParts(now: Date): { date: string; time: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** 16 daily slots, 11:00–18:30 Toronto; allow <5 minutes of scheduler jitter, no catch-up burst. */
export function campaignSlot(now: Date): string | null {
  const p = torontoParts(now);
  if (p.hour < 11 || p.hour > 18 || p.minute % 30 >= 5) {
    return null;
  }
  return `${p.date}T${String(p.hour).padStart(2, '0')}:${p.minute < 30 ? '00' : '30'}`;
}

export function xmlEscape(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

export function greetingTwiml(greeting: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${xmlEscape(greeting)}</Say><Hangup/></Response>`;
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
