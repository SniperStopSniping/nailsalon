import 'server-only';

import { Env } from '@/libs/Env';

type SendTransactionalEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendTransactionalEmailOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type TransactionalEmailResult = {
  ok: boolean;
  errorCode: string | null;
  providerMessageId: string | null;
};

export async function sendTransactionalEmailDetailed(
  params: SendTransactionalEmailParams,
  options: SendTransactionalEmailOptions = {},
): Promise<TransactionalEmailResult> {
  if (!Env.RESEND_API_KEY || !Env.RESEND_FROM_EMAIL) {
    console.warn('[EMAIL DISABLED] Resend is not configured');
    return { ok: false, errorCode: 'RESEND_NOT_CONFIGURED', providerMessageId: null };
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 30_000, 30_000));
  const timeout = setTimeout(
    () => controller.abort(new Error('RESEND_TIMEOUT')),
    timeoutMs,
  );
  timeout?.unref?.();

  try {
    if (controller.signal.aborted) {
      return { ok: false, errorCode: 'RESEND_ABORTED', providerMessageId: null };
    }
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
      signal: controller.signal,
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
    const errorCode = controller.signal.aborted
      ? options.signal?.aborted
        ? 'RESEND_ABORTED'
        : 'RESEND_TIMEOUT'
      : 'RESEND_NETWORK_ERROR';
    console.error('[EMAIL ERROR] Resend request failed', errorCode);
    return { ok: false, errorCode, providerMessageId: null };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function sendTransactionalEmail(
  params: SendTransactionalEmailParams,
  options: SendTransactionalEmailOptions = {},
): Promise<boolean> {
  return (await sendTransactionalEmailDetailed(params, options)).ok;
}
