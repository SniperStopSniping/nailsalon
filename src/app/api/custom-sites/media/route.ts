import { readAuthorizedCanvaNativeMedia } from '@/features/custom-sites/native-media-access.server';
import { getAdminSession } from '@/libs/adminAuth';
import { checkEndpointRateLimit, getClientIp } from '@/libs/rateLimit';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response(null, { status: 403, headers });
  }
  const rate = checkEndpointRateLimit('custom-sites/media', getClientIp(request), 'MEDIA_READ');
  if (!rate.allowed) {
    return new Response(null, { status: 429, headers: { ...headers, 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 1024 || !request.body) {
    return new Response(null, { status: 413, headers });
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > 1024) {
        return new Response(null, { status: 413, headers });
      }
      chunks.push(chunk.value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const admin = await getAdminSession();
    const bytes = await readAuthorizedCanvaNativeMedia(input, admin?.id);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/webp', 'Content-Length': String(bytes.length), 'Content-Security-Policy': 'default-src \'none\'; sandbox' } }) : new Response(null, { status: 404, headers });
  } catch {
    return new Response(null, { status: 404, headers });
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
