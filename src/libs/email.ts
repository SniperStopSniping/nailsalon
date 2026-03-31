import 'server-only';

import { Env } from '@/libs/Env';

type SendTransactionalEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendTransactionalEmail(params: SendTransactionalEmailParams): Promise<boolean> {
  if (!Env.RESEND_API_KEY || !Env.RESEND_FROM_EMAIL) {
    console.warn('[EMAIL DISABLED] Resend is not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Env.RESEND_FROM_EMAIL,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(Env.RESEND_REPLY_TO_EMAIL
          ? { reply_to: Env.RESEND_REPLY_TO_EMAIL }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[EMAIL ERROR] Resend request failed:', response.status, body);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[EMAIL ERROR] Failed to send transactional email:', error);
    return false;
  }
}
