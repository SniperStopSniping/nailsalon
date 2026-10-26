import { timingSafeEqual } from 'node:crypto';

import { getDanielaConfig } from '@/libs/danielaAutomation/config';
import { processDaniela } from '@/libs/danielaAutomation/service';
import { acquireWorker, releaseWorker } from '@/libs/danielaAutomation/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function run(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get('authorization') || '';
  const supplied = Buffer.from(bearer);
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const config = getDanielaConfig();
  if (!config) {
    return Response.json({ enabled: false });
  }
  const token = crypto.randomUUID();
  try {
    if (!await acquireWorker(config, token)) {
      return Response.json({ busy: true });
    }
    const summary = await processDaniela(config);
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Private automation unavailable' }, { status: 503 });
  } finally {
    await releaseWorker(config, token).catch(() => {});
  }
}

export const GET = run;
export const POST = run;
