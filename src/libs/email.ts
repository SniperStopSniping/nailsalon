import 'server-only';

import { Env } from '@/libs/Env';

type SendTransactionalEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type TransactionalEmailResult = {
  ok: boolean;
  errorCode: string | null;
  providerMessageId: string | null;
};

export async function sendTransactionalEmailDetailed(
  params: SendTransactionalEmailParams,
): Promise<TransactionalEmailResult> {
  if (!Env.RESEND_API_KEY || !Env.RESEND_FROM_EMAIL) {
    console.warn('[EMAIL DISABLED] Resend is not configured');
    return { ok: false, errorCode: 'RESEND_NOT_CONFIGURED', providerMessageId: null };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Env.RESEND_API_KEY}`,
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
      // Do not log provider response bodies: they can contain recipient data.
      console.error('[EMAIL ERROR] Resend request failed with status', response.status);
      return {
        ok: false,
        errorCode: `RESEND_HTTP_${response.status}`,
        providerMessageId: null,
      };
    }

    const body = await response.json().catch(() => null) as { id?: unknown } | null;
    return {
      ok: true,
      errorCode: null,
      providerMessageId: typeof body?.id === 'string' ? body.id : null,
    };
  } catch {
    console.error('[EMAIL ERROR] Resend request failed with a network error');
    return { ok: false, errorCode: 'RESEND_NETWORK_ERROR', providerMessageId: null };
  }
}

export async function sendTransactionalEmail(params: SendTransactionalEmailParams): Promise<boolean> {
  return (await sendTransactionalEmailDetailed(params)).ok;
}
