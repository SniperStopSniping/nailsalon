import { getDanielaConfig } from '@/libs/danielaAutomation/config';
import { validateSignature } from '@/libs/danielaAutomation/providers';
import { recordStatus } from '@/libs/danielaAutomation/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const config = getDanielaConfig();
  if (!config) {
    return new Response('Not found', { status: 404 });
  }
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('Invalid content type', { status: 415 });
  }
  const body = await request.text();
  if (body.length > 32_000) {
    return new Response('Payload too large', { status: 413 });
  }
  const params = Object.fromEntries(new URLSearchParams(body));
  if (!validateSignature(config, request, params) || !/^SM[\da-f]{32}$/iu.test(params.MessageSid || '')) {
    return new Response('Forbidden', { status: 403 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return new Response('Missing id', { status: 400 });
  }
  try {
    const found = await recordStatus(config, id, params);
    return new Response(null, { status: found ? 204 : 403 });
  } catch {
    return new Response('Temporarily unavailable', { status: 503 });
  }
}
