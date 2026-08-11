import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * §14 test 21, closing leg — THE MODULE BOUNDARY (invariant I3).
 *
 * This is deliberately a PATH assertion, not a count of writers. A count is
 * false the moment D6 ships `waiveDeposit` and `releaseHold`: it would reject
 * them at review time for being the fourth and fifth, so the fence has to be
 * "where does this live", not "how many are there".
 *
 * The property: every writer that moves an appointment row OUT of
 * 'awaiting_payment' — i.e. an `.update(appointmentSchema)` chain whose CAS
 * asserts `eq(appointmentSchema.status, 'awaiting_payment')` — must live inside
 * `src/libs/deposits/**`.
 *
 * A `ne(appointmentSchema.status, 'awaiting_payment')` conjunct is the OPPOSITE
 * of a mover: it is a refusal, forbidding a writer from touching a hold at all.
 * Those are expected outside the boundary (the transition route carries one) and
 * are not flagged.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const BOUNDARY = path.join(SRC, 'libs', 'deposits');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' ? [] : walk(full);
    }
    return /\.(?:ts|tsx)$/.test(full) ? [full] : [];
  });
}

function isTestFile(file: string): boolean {
  return /\.(?:test|spec)\.tsx?$/.test(file);
}

/** Strip comments so prose about 'awaiting_payment' cannot trip the scan. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

/**
 * Every `.update(appointmentSchema)` chain in a file, as source text, up to the
 * end of the statement.
 */
function appointmentUpdateChains(code: string): string[] {
  const chains: string[] = [];
  const marker = '.update(appointmentSchema)';
  let index = code.indexOf(marker);
  while (index !== -1) {
    // A chain ends at `.returning()` where present, otherwise at the first
    // statement terminator that follows the closing `.where(...)`.
    const rest = code.slice(index);
    const returningAt = rest.indexOf('.returning(');
    const end = returningAt !== -1 ? returningAt + 20 : 1500;
    chains.push(rest.slice(0, end));
    index = code.indexOf(marker, index + marker.length);
  }
  return chains;
}

/** True when the chain CASes on the row currently being a hold. */
function movesAHold(chain: string): boolean {
  return /eq\(\s*appointmentSchema\.status\s*,\s*'awaiting_payment'\s*\)/.test(chain);
}

describe('the deposit hold-writer module boundary (§14 test 21, closing leg)', () => {
  const runtimeFiles = walk(SRC).filter(file => !isTestFile(file));

  it('every writer that moves a row out of awaiting_payment lives in src/libs/deposits/**', () => {
    const offenders = runtimeFiles.filter((file) => {
      const code = codeOnly(readFileSync(file, 'utf8'));
      return appointmentUpdateChains(code).some(movesAHold)
        && !file.startsWith(`${BOUNDARY}${path.sep}`);
    });

    expect(offenders.map(file => path.relative(ROOT, file))).toEqual([]);
  });

  it('the boundary really does contain at least one such writer', () => {
    // Otherwise the assertion above passes vacuously — for example if the CAS
    // were rewritten as raw SQL and the scan silently stopped matching anything.
    const writers = walk(BOUNDARY)
      .filter(file => !isTestFile(file))
      .filter(file => appointmentUpdateChains(codeOnly(readFileSync(file, 'utf8'))).some(movesAHold));

    expect(writers.length).toBeGreaterThan(0);
  });

  it('a refusal conjunct outside the boundary is NOT treated as a writer', () => {
    // The transition route carries ne(status, 'awaiting_payment') in its final
    // CAS. That forbids touching a hold; it must not be mistaken for a mover, or
    // the fence would push guards into the deposits directory.
    const transitionRoute = path.join(
      SRC,
      'app/api/appointments/[id]/transition/route.ts',
    );
    const code = codeOnly(readFileSync(transitionRoute, 'utf8'));

    expect(code).toContain('ne(appointmentSchema.status, \'awaiting_payment\')');
    expect(appointmentUpdateChains(code).some(movesAHold)).toBe(false);
  });

  it('the boundary\'s writers are all status-guarded and transactional', () => {
    const writerSources = walk(BOUNDARY)
      .filter(file => !isTestFile(file))
      .map(file => readFileSync(file, 'utf8'))
      .filter(source => movesAHold(codeOnly(source)));

    for (const source of writerSources) {
      // ONE transaction containing BOTH statements: a crash between two loose
      // statements would leave a permanently non-terminal deposit row attached
      // to a cancelled appointment that no sweep could ever find, because every
      // eligibility scan keys on the APPOINTMENT status.
      expect(source).toContain('db.transaction');
      // The deposit CAS is guarded on 'checkout_created', so a deposit that has
      // become 'paid' is never overwritten.
      expect(source).toContain('\'checkout_created\'');
    }
  });
});
