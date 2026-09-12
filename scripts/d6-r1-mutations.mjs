/** Local/disposable only. Each mutant must fail its targeted financial/evidence assertion. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.LUSTER_DISPOSABLE_DATABASE !== 'true'
  || process.env.D6_R1_CONCURRENCY_REQUIRED !== 'true'
  || !process.env.CONCURRENCY_TEST_DATABASE_URL) {
  throw new Error('Required guarded disposable PostgreSQL test environment is absent');
}
const output = process.env.D6_R1_EVIDENCE_DIR;
if (!output || !path.isAbsolute(output)) {
  throw new Error('An explicit absolute D6_R1_EVIDENCE_DIR is required');
}
mkdirSync(output, { recursive: true });
const test = 'src/libs/deposits/shadow.concurrency.integration.test.ts';
const store = 'src/libs/deposits/shadowStore.ts';
const route = 'src/app/api/webhooks/stripe-connect/route.ts';
const projection = 'src/libs/deposits/shadowProjection.ts';
const replace = (source, from, to) => {
  if (!source.includes(from)) {
    throw new Error(`Mutation anchor missing: ${from}`);
  }
  return source.replace(from, to);
};
const mutants = [
  { id: 'receipt', file: route, test: 'signed receipt survives legacy crash', edit: s => replace(s, 'if (isShadowEvent(event.type))', 'if (false && isShadowEvent(event.type))') },
  { id: 'replay', file: store, test: 'unattributed receipts remain visible', edit: s => replace(s, 'if (locked.length)', 'if (false && locked.length)') },
  { id: 'fence', file: store, test: 'old fence cannot replace', edit: s => replace(replace(replace(s, ' && s.fence === claim.fence', ''), ' && s.version === claim.version', ''), ' && s.lease_valid', '') },
  { id: 'dirty', file: store, test: 'receipt during provider read', edit: s => replace(s, 's.generation === claim.generation && ', '') },
  { id: 'pagination', file: projection, test: 'capped refund or dispute pages', edit: s => replace(s, 'if (!o.pagesComplete || !o.disputePagesComplete)', 'if (false)') },
  { id: 'fairness', file: store, test: 'noisy tenant exceeds batch', edit: s => replace(s, 'ORDER BY r.fair_rank,r.tenant_served NULLS FIRST,r.next_due_at,s.deposit_id', 'ORDER BY r.next_due_at,s.deposit_id') },
  { id: 'scope', file: store, test: 'provider account and mode mismatch', edit: s => replace(s, 'observation.account !== claim.account || observation.livemode !== claim.livemode', 'false') },
  { id: 'dispute-capture', file: route, test: 'every dispute event family', edit: s => replace(s, 'if (isShadowEvent(event.type))', 'if (isShadowEvent(event.type) && !event.type.startsWith(\'charge.dispute.\'))') },
  { id: 'account-lock', file: store, test: 'charge-only receipt serialized', edit: (s) => {
    const line = s.split('\n').find(line => line.includes('pg_advisory_xact_lock(hashtextextended'));
    if (!line) {
      throw new Error('Account-lock mutation anchor missing');
    }
    return replace(s, line, '  void account; void livemode;');
  } },
];
const sha = text => createHash('sha256').update(text).digest('hex');
function assertRestored(file, original) {
  if (sha(readFileSync(file, 'utf8')) !== sha(original)) {
    throw new Error('Restoration failed');
  }
}
function run(name, testName) {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', test, ...(testName ? ['-t', testName] : [])], { encoding: 'utf8', timeout: 180_000, env: process.env });
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(path.join(output, `${name}.log`), log);
  return { code: result.status, log, signal: result.signal };
}
const baseline = run('baseline');
if (baseline.code !== 0) {
  throw new Error('Baseline failed; no mutations executed');
}
const results = [];
for (const mutant of mutants) {
  const original = readFileSync(mutant.file, 'utf8');
  let result;
  try {
    const changed = mutant.edit(original);
    writeFileSync(mutant.file, changed);
    result = run(mutant.id, mutant.test);
    const killed = result.code !== 0 && result.signal === null && result.log.includes('AssertionError:');
    results.push({ id: mutant.id, test: mutant.test, originalSha256: sha(original), mutantSha256: sha(changed), killed, exitCode: result.code, assertion: result.log.match(/AssertionError:[^\n]*/)?.[0] ?? null });
    if (!killed) {
      throw new Error(`Mutation ${mutant.id} did not produce the required assertion failure`);
    }
  } finally {
    writeFileSync(mutant.file, original);
    assertRestored(mutant.file, original);
    writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  }
  const green = run(`${mutant.id}-restored`, mutant.test);
  if (green.code !== 0) {
    throw new Error(`Restored ${mutant.id} did not re-green`);
  }
  process.stdout.write(`${mutant.id}: assertion failed as required; restored control passed\n`);
}
const final = run('final-restored');
if (final.code !== 0) {
  throw new Error('Final restored suite failed');
}
process.stdout.write(`D6_R1_MUTANTS_KILLED=${results.length} RESTORED_GREEN=true\n`);
