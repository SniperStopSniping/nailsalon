import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import { depositsTransaction, isInsideDepositsTransaction } from './depositsTransaction';
/* eslint-enable import/first */

/**
 * Harness H5 — THE META-TEST for the in-transaction provider-call detector.
 *
 * §13 requires the detector to ship WITH its own meta-test, and the reason is
 * that a detector which silently stops detecting is worse than none: every
 * subsequent "no Stripe call inside a transaction" assertion in the suite would
 * pass vacuously. These legs prove the flag is actually raised, actually
 * lowered, and actually survives an `await`.
 */

const ROOT = process.cwd();
const DEPOSITS_DIR = path.join(ROOT, 'src', 'libs', 'deposits');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return /\.(?:ts|tsx)$/.test(full) ? [full] : [];
  });
}

function isTestFile(file: string): boolean {
  return /\.(?:test|spec)\.tsx?$/.test(file);
}

/** Strip comments so prose about `db.transaction` cannot trip the scan. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

/**
 * A fake database whose `transaction` just runs the callback. The seam's job is
 * the AsyncLocalStorage scope, not the SQL, so a real connection would only
 * make the meta-test slower and less deterministic.
 */
const fakeDb = {
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
} as unknown as Parameters<typeof depositsTransaction>[0];

describe('depositsTransaction — H5 detector meta-test', () => {
  it('reports false outside any deposits transaction', () => {
    expect(isInsideDepositsTransaction()).toBe(false);
  });

  it('reports true inside the callback', async () => {
    let observed: boolean | null = null;
    await depositsTransaction(fakeDb, async () => {
      observed = isInsideDepositsTransaction();
    });

    expect(observed).toBe(true);
  });

  it('keeps the flag raised across an await boundary', async () => {
    // Without this leg an AsyncLocalStorage regression that only survives
    // synchronous code would go unnoticed, and every provider call in the real
    // routines happens after at least one await.
    let observed: boolean | null = null;
    await depositsTransaction(fakeDb, async () => {
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
      observed = isInsideDepositsTransaction();
    });

    expect(observed).toBe(true);
  });

  it('lowers the flag after the callback resolves', async () => {
    await depositsTransaction(fakeDb, async () => {
      expect(isInsideDepositsTransaction()).toBe(true);
    });

    expect(isInsideDepositsTransaction()).toBe(false);
  });

  it('lowers the flag after the callback throws', async () => {
    await expect(
      depositsTransaction(fakeDb, async () => {
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(isInsideDepositsTransaction()).toBe(false);
  });

  it('does not leak the flag into a sibling async task', async () => {
    const sibling = (async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return isInsideDepositsTransaction();
    })();

    await depositsTransaction(fakeDb, async () => {
      await new Promise(resolve => setTimeout(resolve, 2));
    });

    await expect(sibling).resolves.toBe(false);
  });

  it('an instrumented provider mock throws when called under the flag', async () => {
    // This is the shape every routine-level test relies on. Proving it here
    // means a later "zero Stripe calls in a transaction" assertion is a real
    // assertion rather than a mock that never fires.
    const guardedStripeCall = vi.fn(() => {
      if (isInsideDepositsTransaction()) {
        throw new Error('stripe call inside a deposits transaction');
      }
      return 'ok';
    });

    expect(guardedStripeCall()).toBe('ok');

    await expect(
      depositsTransaction(fakeDb, async () => {
        guardedStripeCall();
      }),
    ).rejects.toThrow('stripe call inside a deposits transaction');
  });
});

describe('deposits library transaction discipline (H6)', () => {
  it('routes every transaction in src/libs/deposits through the seam', () => {
    // A bare `db.transaction` in this directory is invisible to the detector,
    // so every assertion built on the detector would weaken silently. The scan
    // is what makes "all deposits transactions are instrumented" checkable
    // rather than remembered.
    const offenders = walk(DEPOSITS_DIR)
      .filter(file => !isTestFile(file))
      .filter(file => path.basename(file) !== 'depositsTransaction.ts')
      .filter(file => /\bdb\s*\.\s*transaction\s*\(/.test(codeOnly(readFileSync(file, 'utf8'))));

    expect(offenders.map(file => path.relative(ROOT, file))).toEqual([]);
  });
});
