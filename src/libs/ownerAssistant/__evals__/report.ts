/**
 * Eval report rendering and writing (A1-4, deliverable F).
 *
 * `renderEvalMarkdown` is PURE — it is the half worth unit-testing, and the
 * half a reviewer reads. `writeEvalReport` is the thin filesystem wrapper the
 * real-model run calls.
 *
 * Report output is never committed: the default directory (`eval-reports/`) is
 * gitignored, and a run may be pointed anywhere else with `--out`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { EvalAggregate, EvalCaseRecord, EvalTurnRecord } from './harness';

export type EvalReportSkip = {
  id: string;
  group: string;
  title: string;
  reason: string;
};

export type EvalReportInput = {
  model: string;
  records: readonly EvalCaseRecord[];
  summary: EvalAggregate;
  skipped: readonly EvalReportSkip[];
  fixtureSlug: string;
  frozenNow: string;
  /** Injected so a rendered report is byte-stable in a test. */
  generatedAt?: string;
};

export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6)}`;
}

function markdownRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function executedToolNames(turn: EvalTurnRecord): string[] {
  return turn.toolCalls.filter(call => call.executed && call.ok).map(call => call.name);
}

export function renderEvalMarkdown(input: EvalReportInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const lines: string[] = [
    '# Owner Assistant — real-model eval run',
    '',
    `- Generated: ${generatedAt}`,
    `- Model: \`${input.model}\``,
    `- Fixture: synthetic salon \`${input.fixtureSlug}\` on an in-memory PGlite database`,
    `- Frozen clock: ${input.frozenNow}`,
    '',
    '## Summary',
    '',
    `- Cases passed: **${input.summary.passed}/${input.summary.cases}** over ${input.summary.turns} turns`,
    `- Latency: p50 ${input.summary.latencyP50Ms} ms · p95 ${input.summary.latencyP95Ms} ms`,
    `- Cost per turn: mean ${formatMicros(input.summary.meanCostMicrosPerTurn)} · median ${formatMicros(input.summary.medianCostMicrosPerTurn)} (total ${formatMicros(input.summary.totalCostMicros)})`,
    `- Grounded turns: ${input.summary.groundedTurns}/${input.summary.turns} · unsupported facts: ${input.summary.unsupportedFactCount}`,
    '',
    markdownRow(['Group', 'Passed', 'Cases', 'Rate']),
    markdownRow(['---', '---', '---', '---']),
  ];

  for (const [group, bucket] of Object.entries(input.summary.passRateByGroup)) {
    lines.push(markdownRow([
      group,
      String(bucket.passed),
      String(bucket.cases),
      `${(bucket.rate * 100).toFixed(0)}%`,
    ]));
  }

  lines.push(
    '',
    '## Turns',
    '',
    markdownRow(['Turn', 'Group', 'Result', 'Tools expected', 'Tools run', 'Grounding', 'Model calls', 'in/cached/out', 'Latency', 'Cost']),
    markdownRow(Array.from({ length: 10 }, () => '---')),
  );

  for (const record of input.records) {
    for (const turn of record.turns) {
      lines.push(markdownRow([
        `${record.caseId}.${turn.index + 1}`,
        record.group,
        turn.failures.length === 0 ? 'pass' : 'FAIL',
        turn.expectedTools.join(' + ') || 'none',
        executedToolNames(turn).join(' + ') || 'none',
        turn.grounding.ok
          ? 'grounded'
          : turn.grounding.unsupported.map(fact => `${fact.kind}:${fact.value}`).join('; '),
        String(turn.modelCalls),
        `${turn.usage.inputTokens}/${turn.usage.cachedInputTokens}/${turn.usage.outputTokens}`,
        `${turn.latencyMs} ms`,
        turn.priceKnown ? formatMicros(turn.costMicros) : 'unpriced',
      ]));
    }
  }

  const failing = input.records.filter(record => !record.passed);
  if (failing.length > 0) {
    lines.push('', '## Failures', '');
    for (const record of failing) {
      lines.push(`### ${record.caseId} — ${record.title}`, '');
      for (const failure of record.failures) {
        lines.push(`- ${failure}`);
      }
      for (const turn of record.turns) {
        lines.push(`- turn ${turn.index + 1} answer: ${JSON.stringify(turn.answer)}`);
      }
      lines.push('');
    }
  }

  lines.push('', '## Not run', '');
  for (const entry of input.skipped) {
    lines.push(`- **${entry.id}** (${entry.group}) ${entry.title} — ${entry.reason}`);
  }
  lines.push(
    '',
    'Security and failure cases are proved in CI by `src/libs/ownerAssistant/__evals__/evals.test.ts`.',
    '',
  );

  return lines.join('\n');
}

export function writeEvalReport(
  input: EvalReportInput & { outputDirectory: string },
): { jsonPath: string; markdownPath: string } {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const timestamp = generatedAt.replace(/[:.]/g, '-');
  const directory = path.resolve(process.cwd(), input.outputDirectory);
  mkdirSync(directory, { recursive: true });

  const jsonPath = path.join(directory, `owner-assistant-eval-${timestamp}.json`);
  writeFileSync(
    jsonPath,
    `${JSON.stringify({
      generatedAt,
      model: input.model,
      fixture: { salon: input.fixtureSlug, frozenNow: input.frozenNow },
      summary: input.summary,
      records: input.records,
      skipped: input.skipped,
    }, null, 2)}\n`,
    'utf8',
  );

  const markdownPath = path.join(directory, `owner-assistant-eval-${timestamp}.md`);
  writeFileSync(markdownPath, renderEvalMarkdown({ ...input, generatedAt }), 'utf8');

  return { jsonPath, markdownPath };
}
