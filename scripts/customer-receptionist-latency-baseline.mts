/**
 * Explicit live baseline sampler for the public Isla Customer AI.
 *
 * It talks only to /session and /chat. It deliberately has no booking,
 * handoff, confirmation, review, payment, messaging, or credential inputs.
 * A live run spends the Customer AI pilot budget, so --run-live is required.
 * The response endpoint does not expose model-stage timings or usage; those
 * fields are intentionally reported as unavailable rather than estimated.
 *
 * Example:
 *   node --import tsx scripts/customer-receptionist-latency-baseline.mts \
 *     --run-live --repeat 1 --out artifacts/customer-receptionist-latency-baseline
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://www.lustergel.app';
const SLUG = 'isla-nail-studio';
const BASE_URL = `${ORIGIN}/api/public/customer-assistant/${SLUG}`;

type Options = { runLive: boolean; repeat: number; out: string; help: boolean };
type TurnResult = {
  scenario: string;
  repetition: number;
  turn: number;
  message: string;
  latencyMs: number;
  httpStatus: number;
  serverTiming: string | null;
  resultKind: string | null;
  resultReason: string | null;
  responseMessage: string | null;
  modelUsage: 'unavailable_from_public_response';
  stageTimings: 'unavailable_from_public_response';
};

const SCENARIOS: Array<{ id: string; messages: string[] }> = [
  { id: 'welcome_book_action_current_label', messages: ['Book an appointment'] },
  { id: 'price_question', messages: ['What does Gel-X Extensions cost?'] },
  { id: 'recommendation', messages: ['I want extensions but I am not sure what would suit me. What do you recommend?'] },
  { id: 'unsupported_hard_gel', messages: ['I want hard gel extensions'] },
  { id: 'unsupported_acrylic', messages: ['I want acrylic extensions'] },
  { id: 'length_and_design_consultation', messages: ['I would like medium Gel-X with French tips, and I have nothing on my nails.'] },
  { id: 'availability_intent', messages: ['I would like Gel-X Extensions. What is your next availability?'] },
];

function usage(): string {
  return 'Usage: node --import tsx scripts/customer-receptionist-latency-baseline.mts --run-live [--repeat 1..20] [--out <directory>]';
}

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = { runLive: false, repeat: 1, out: 'artifacts/customer-receptionist-latency-baseline', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run-live') {
      options.runLive = true;
    } else if (argument === '--help') {
      options.help = true;
    } else if (argument === '--repeat' || argument === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        return null;
      }
      if (argument === '--repeat') {
        const repeat = Number(value);
        if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 20) {
          return null;
        }
        options.repeat = repeat;
      } else {
        options.out = value;
      }
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))]!;
}

async function requestJson(url: string, body: unknown): Promise<{ response: Response; payload: unknown; latencyMs: number }> {
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Origin': ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload, latencyMs: performance.now() - started };
}

function resultRecord(payload: unknown): { conversation: string | null; kind: string | null; reason: string | null; message: string | null } {
  if (!payload || typeof payload !== 'object') {
    return { conversation: null, kind: null, reason: null, message: null };
  }
  const data = payload as { conversation?: unknown; result?: { kind?: unknown; reason?: unknown; message?: unknown } };
  return {
    conversation: typeof data.conversation === 'string' ? data.conversation : null,
    kind: typeof data.result?.kind === 'string' ? data.result.kind : null,
    reason: typeof data.result?.reason === 'string' ? data.result.reason : null,
    message: typeof data.result?.message === 'string' ? data.result.message : null,
  };
}

function markdown(results: TurnResult[]): string {
  const byScenario = SCENARIOS.map((scenario) => {
    const rows = results.filter(result => result.scenario === scenario.id);
    const measured = rows.filter(row => row.httpStatus === 200 && row.resultReason !== 'rate_limited');
    const times = measured.map(row => row.latencyMs);
    const rateLimited = rows.filter(row => row.resultReason === 'rate_limited').length;
    return `| ${scenario.id} | ${measured.length} | ${percentile(times, 0.5)?.toFixed(0) ?? '—'} | ${percentile(times, 0.95)?.toFixed(0) ?? '—'} | ${times.length ? Math.max(...times).toFixed(0) : '—'} | ${rateLimited} | ${measured.at(-1)?.resultKind ?? '—'} | ${measured.at(-1)?.resultReason ?? '—'} |`;
  }).join('\n');
  return `# Customer receptionist live latency baseline\n\nTarget: ${ORIGIN}/${SLUG}/book/service. This is public chat-only sampling: no booking, handoff, confirmation, payment, review, or messaging endpoints were called. Each scenario starts a fresh signed session.\n\nThe timing is client fetch start through response-body parsing, so it includes public-route processing and network transfer. It does not measure browser rendering. The baseline endpoint exposes no Server-Timing header, model-stage timings, provider token usage, or provider cost; those are reported as unavailable, not inferred.\n\n| Scenario | Non-rate-limited samples | p50 ms | p95 ms | Max ms | Rate limited | Last result | Last reason |\n| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |\n${byScenario}\n\nRaw observations are in the adjacent JSON file.\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options || options.help) {
    process.stdout.write(`${usage()}\n`);
    if (!options) {
      process.exitCode = 1;
    }
    return;
  }
  if (!options.runLive) {
    process.stderr.write(`Refused: --run-live is required because this samples the live public Customer AI and consumes its model budget.\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }
  const results: TurnResult[] = [];
  for (let repetition = 1; repetition <= options.repeat; repetition += 1) {
    for (const scenario of SCENARIOS) {
      const session = await requestJson(`${BASE_URL}/session`, {});
      const initial = resultRecord(session.payload);
      if (!session.response.ok || !initial.conversation) {
        results.push({ scenario: scenario.id, repetition, turn: 0, message: '', latencyMs: session.latencyMs, httpStatus: session.response.status, serverTiming: session.response.headers.get('server-timing'), resultKind: null, resultReason: 'session_unavailable', responseMessage: null, modelUsage: 'unavailable_from_public_response', stageTimings: 'unavailable_from_public_response' });
        continue;
      }
      let conversation = initial.conversation;
      for (const [index, message] of scenario.messages.entries()) {
        const response = await requestJson(`${BASE_URL}/chat`, { conversation, message, locale: 'en' });
        const parsed = resultRecord(response.payload);
        results.push({ scenario: scenario.id, repetition, turn: index + 1, message, latencyMs: response.latencyMs, httpStatus: response.response.status, serverTiming: response.response.headers.get('server-timing'), resultKind: parsed.kind, resultReason: parsed.reason, responseMessage: parsed.message, modelUsage: 'unavailable_from_public_response', stageTimings: 'unavailable_from_public_response' });
        if (!response.response.ok || !parsed.conversation) {
          break;
        }
        conversation = parsed.conversation;
      }
    }
  }
  const outputDirectory = path.resolve(REPOSITORY_ROOT, options.out);
  await mkdir(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = { generatedAt: new Date().toISOString(), target: `${ORIGIN}/${SLUG}/book/service`, sourceBaselineRevision: '952dadc23bace8ff0f43e7158e1eef02efec39c8', liveDeploymentRevision: 'not exposed by inspected deployment metadata or health', repeat: options.repeat, scope: 'public session/chat only; no bookings, payments, reviews, messaging, or handoffs', timings: { fetchStartToParsedResponse: 'measured', browserRendering: 'not_measured', serverStageBreakdown: 'not_exposed_by_current endpoint', modelUsageAndCost: 'not_exposed_by_current endpoint' }, results };
  await writeFile(path.join(outputDirectory, `customer-receptionist-latency-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(path.join(outputDirectory, `customer-receptionist-latency-${stamp}.md`), markdown(results), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Wrote ${results.length} public-chat observations under ${path.relative(REPOSITORY_ROOT, outputDirectory)}.\n`);
}

void main();
