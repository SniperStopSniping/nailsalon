import 'server-only';

import { z } from 'zod';

import { normalizePhone } from './policy';

const phone = z.string().refine(value => normalizePhone(value) === value);
const definition = z.object({
  salonId: z.string().min(1),
  accountSid: z.string().regex(/^AC[\da-f]{32}$/iu),
  fromNumber: phone,
  publicOrigin: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  }),
  greeting: z.string().trim().min(1).max(2000),
  bookingMessage: z.string().trim().min(1).max(1600),
  promoMessage: z.string().trim().min(1).max(1600),
  blockedPhones: z.array(phone),
  preferredPhones: z.array(phone).max(10),
  sheets: z.array(z.object({
    spreadsheetId: z.string().regex(/^[\w-]+$/u),
    tab: z.string().min(1).max(100),
    role: z.enum(['primary', 'inbound']),
  })).length(2).refine(items => items.filter(item => item.role === 'primary').length === 1),
  telegramChatId: z.string().regex(/^-?\d+$/u),
});

export type DanielaConfig = z.infer<typeof definition> & {
  mode: 'shadow' | 'live';
  authToken: string;
  campaignEnabled: boolean;
};

/** No defaults for business copy, sender, credentials, or migration identity. */
export function getDanielaConfig(): DanielaConfig | null {
  const mode = process.env.DANIELA_AUTOMATION_MODE;
  if (mode !== 'shadow' && mode !== 'live') {
    return null;
  }
  try {
    const parsed = definition.safeParse(JSON.parse(process.env.DANIELA_AUTOMATION_CONFIG || '{}'));
    const authToken = process.env.DANIELA_TWILIO_AUTH_TOKEN;
    if (!parsed.success || !authToken) {
      return null;
    }
    if (mode === 'live' && (process.env.VERCEL_ENV !== 'production'
      || process.env.DANIELA_N8N_CUTOVER_CONFIRMED !== 'true'
      || !process.env.DANIELA_GOOGLE_CLIENT_ID || !process.env.DANIELA_GOOGLE_CLIENT_SECRET
      || !process.env.DANIELA_GOOGLE_REFRESH_TOKEN || !process.env.DANIELA_TELEGRAM_BOT_TOKEN)) {
      return null;
    }
    return { ...parsed.data, mode, authToken, campaignEnabled: process.env.DANIELA_CAMPAIGN_ENABLED === 'true' };
  } catch {
    return null;
  }
}
