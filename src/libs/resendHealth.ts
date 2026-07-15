import 'server-only';

function senderDomain(from: string): string | null {
  const match = from.match(/@([a-z0-9.-]+)(?:>|\s|$)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function isResendSenderVerified(): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const domain = from ? senderDomain(from) : null;
  if (!apiKey || !domain) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  timeout.unref?.();
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.json().catch(() => null) as {
      data?: Array<{ name?: unknown; status?: unknown }>;
    } | null;
    return Boolean(body?.data?.some(item => (
      typeof item.name === 'string'
      && item.name.toLowerCase() === domain
      && item.status === 'verified'
    )));
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
