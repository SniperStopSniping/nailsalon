import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export function checkBookingScaleResult(text, { mode, exitCode }) {
  if (!['baseline', 'candidate'].includes(mode) || !Number.isInteger(exitCode)) {
    throw new Error('INVALID_RUN_METADATA');
  }
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) {
    throw new Error('INPUT_SIZE_LIMIT');
  }
  const clean = stripVTControlCharacters(text);
  const lines = clean.split(/\r?\n/);
  const marker = 'CUSTOMER_CREATOR_POSTGRES_TESTS_EXECUTED=62 CUSTOMER_CREATOR_POSTGRES_TESTS_SKIPPED=0';
  if (lines.filter(line => line.trim() === marker).length !== 1) {
    throw new Error('FULL_SUITE_GUARD_MISSING_OR_DUPLICATE');
  }
  const pattern = /^SCALE_BOOKING salons=(5|10|25) round=([1-5]) initial_201=(\d+) initial_503=(\d+) recovery_waves=(\d+) recovery_attempts=(\d+) first_wave_ms=(\d+(?:\.\d+)?) total_ms=(\d+(?:\.\d+)?)$/;
  const rows = lines.filter(line => line.includes('SCALE_BOOKING')).map((line) => {
    const match = pattern.exec(line.trim());
    if (!match) {
      throw new Error('INVALID_SCALE_ROW');
    }
    const [salons, round, initial201, initial503, recoveryWaves, recoveryAttempts, firstWaveMs, totalMs] = match.slice(1).map(Number);
    if (![salons, round, initial201, initial503, recoveryWaves, recoveryAttempts, firstWaveMs, totalMs].every(Number.isFinite)
      || initial201 + initial503 !== salons || recoveryAttempts < initial503 || totalMs < firstWaveMs) {
      throw new Error('INVALID_SCALE_NUMBERS');
    }
    return { salons, round, initial201, initial503, recoveryWaves, recoveryAttempts, firstWaveMs, totalMs };
  });
  if (rows.length !== 15 || new Set(rows.map(row => `${row.salons}:${row.round}`)).size !== 15) {
    throw new Error('FIFTEEN_DISTINCT_ROUNDS_REQUIRED');
  }
  if (exitCode !== 0) {
    throw new Error('VITEST_FAILED');
  }
  const initial503 = rows.reduce((sum, row) => sum + row.initial503, 0);
  const summary = { mode, testsExecuted: 62, testsSkipped: 0, exitCode, scaleRows: 15, initial201: rows.reduce((sum, row) => sum + row.initial201, 0), initial503, rows };
  if (mode === 'candidate' && initial503 !== 0) {
    throw Object.assign(new Error('CANDIDATE_INITIAL_503'), { summary });
  }
  return { ...summary, validationPassed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, mode, exit] = process.argv.slice(2);
  const writeSummary = (summary) => {
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > 16384) {
      throw new Error('OUTPUT_SIZE_LIMIT');
    }
    writeFileSync(output, serialized);
  };
  try {
    if (!input || !output || !/^\d+$/.test(exit || '') || statSync(input).size > 4 * 1024 * 1024) {
      throw new Error('INVALID_INPUT');
    }
    const result = checkBookingScaleResult(readFileSync(input, 'utf8'), { mode, exitCode: Number(exit) });
    writeSummary(result);
    process.stdout.write(`BOOKING_SCALE_VALIDATED mode=${mode} tests=62 rows=15 initial_201=${result.initial201} initial_503=${result.initial503}\n`);
  } catch (error) {
    const reasons = ['INVALID_RUN_METADATA', 'INPUT_SIZE_LIMIT', 'FULL_SUITE_GUARD_MISSING_OR_DUPLICATE', 'INVALID_SCALE_ROW', 'INVALID_SCALE_NUMBERS', 'FIFTEEN_DISTINCT_ROUNDS_REQUIRED', 'VITEST_FAILED', 'CANDIDATE_INITIAL_503', 'INVALID_INPUT', 'OUTPUT_SIZE_LIMIT'];
    const reasonCode = reasons.includes(error.message) ? error.message : 'INPUT_OR_OUTPUT_ERROR';
    const metadata = { mode: ['baseline', 'candidate'].includes(mode) ? mode : 'invalid', exitCode: /^\d+$/.test(exit || '') && Number.isSafeInteger(Number(exit)) ? Number(exit) : null, validationPassed: false, reasonCode };
    try {
      writeSummary(reasonCode === 'CANDIDATE_INITIAL_503' ? { ...error.summary, ...metadata } : metadata);
    } catch {
      console.error('BOOKING_SCALE_FAILURE_ARTIFACT_UNAVAILABLE');
    }
    console.error(`BOOKING_SCALE_VALIDATION_FAILED ${reasonCode}`);
    process.exitCode = 1;
  }
}
