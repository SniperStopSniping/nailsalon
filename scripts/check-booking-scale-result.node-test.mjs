import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkBookingScaleResult } from './check-booking-scale-result.mjs';

const marker = 'CUSTOMER_CREATOR_POSTGRES_TESTS_EXECUTED=62 CUSTOMER_CREATOR_POSTGRES_TESTS_SKIPPED=0';
const rows = [5, 10, 25].flatMap(size => [1, 2, 3, 4, 5].map(round => `SCALE_BOOKING salons=${size} round=${round} initial_201=${size} initial_503=0 recovery_waves=0 recovery_attempts=0 first_wave_ms=1.0 total_ms=2.0`));
const valid = [marker, ...rows].join('\n');
const options = { mode: 'candidate', exitCode: 0 };

test('validates all original rounds and zero-skip guard', () => {
  const result = checkBookingScaleResult(valid, options);
  assert.equal(result.initial201, 200);
  assert.equal(result.rows.length, 15);
});

test('rejects missing, duplicate, malformed and inconsistent rows', () => {
  for (const text of [
    [marker, ...rows.slice(1)].join('\n'),
    [marker, ...rows.slice(0, -1), rows[0]].join('\n'),
    valid.replace('round=1', 'round=6'),
    valid.replace('initial_201=5', 'initial_201=4'),
  ]) {
    assert.throws(() => checkBookingScaleResult(text, options));
  }
});

test('requires guard, zero exit, bounded input and valid metadata', () => {
  assert.throws(() => checkBookingScaleResult(rows.join('\n'), options));
  assert.throws(() => checkBookingScaleResult(`${marker}\n${valid}`, options));
  assert.throws(() => checkBookingScaleResult(valid, { ...options, exitCode: 1 }));
  assert.throws(() => checkBookingScaleResult('x'.repeat(4 * 1024 * 1024 + 1), options));
  assert.throws(() => checkBookingScaleResult(valid, { ...options, mode: 'other' }));
});

test('measures baseline 503 while refusing it for candidate', () => {
  const partial = valid.replace('initial_201=5 initial_503=0 recovery_waves=0 recovery_attempts=0', 'initial_201=4 initial_503=1 recovery_waves=1 recovery_attempts=1');
  assert.equal(checkBookingScaleResult(partial, { mode: 'baseline', exitCode: 0 }).initial503, 1);
  assert.throws(() => checkBookingScaleResult(partial, options), /CANDIDATE_INITIAL_503/);
});

test('CLI retains candidate failure measurements and sanitized guard failures', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'booking-scale-cli-'));
  try {
    const input = join(scratch, 'input.txt');
    const output = join(scratch, 'summary.json');
    const invoke = (text) => {
      writeFileSync(input, text);
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('./check-booking-scale-result.mjs', import.meta.url)), input, output, 'candidate', '0'], { encoding: 'utf8', timeout: 10000 });
      return { exit: child.status, summary: JSON.parse(readFileSync(output, 'utf8')) };
    };
    const passed = invoke(valid);
    assert.equal(passed.exit, 0);
    assert.equal(passed.summary.validationPassed, true);
    const failed = invoke(valid.replace('initial_201=5 initial_503=0 recovery_waves=0 recovery_attempts=0', 'initial_201=4 initial_503=1 recovery_waves=1 recovery_attempts=1'));
    assert.equal(failed.exit, 1);
    assert.equal(failed.summary.validationPassed, false);
    assert.equal(failed.summary.reasonCode, 'CANDIDATE_INITIAL_503');
    assert.equal(failed.summary.initial503, 1);
    assert.equal(failed.summary.rows.length, 15);
    const guard = invoke(`${rows.join('\n')}\nPRIVATE_ERROR_SHOULD_NOT_ESCAPE`);
    assert.equal(guard.exit, 1);
    assert.deepEqual(guard.summary, { mode: 'candidate', exitCode: 0, validationPassed: false, reasonCode: 'FULL_SUITE_GUARD_MISSING_OR_DUPLICATE' });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
