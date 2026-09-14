/**
 * The live billing modules these P8a operator scripts reuse
 * (`grantStarterCredits`, `resolveOrCreateBusinessIdentity`,
 * `computeAvailableBalance`, ...) are guarded by the `server-only` marker
 * package. That package's `exports` map resolves to a real, THROWING module
 * under Node's default resolution conditions, and only resolves to a no-op
 * under the `react-server` condition — the condition Next.js's own bundler
 * sets when compiling Server Component code. A plain `npx tsx scripts/x.ts`
 * invocation never sets it, so importing any of those live modules directly
 * would crash immediately, before argument parsing even runs (ES module
 * imports are hoisted ahead of everything else in the file).
 *
 * Stripping `server-only` from those modules is not an option — they are
 * untouched live code. Instead, once a script is past its guard/--help
 * fast paths (which never touch a live module and so never need this), it
 * re-execs ITSELF as a child process with the `react-server` condition
 * applied via NODE_OPTIONS, exactly once (a marker env var prevents a
 * second hop). This mirrors `scripts/database-command.ts`'s own
 * child-process pattern (`runDrizzleCommand` / `runFixedTypeScript`
 * spawning `node_modules/.bin/drizzle-kit` / `.bin/tsx` directly).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CONDITION_APPLIED_ENV = 'LUSTER_BILLING_SCRIPT_SERVER_CONDITION_APPLIED';

/**
 * Returns `true` when the current process already has the `react-server`
 * condition applied — the caller should proceed straight to importing
 * live modules. Otherwise, re-execs the given script (with the ORIGINAL
 * CLI arguments) as a child process that does have it, waits for it, and
 * exits this process with the child's status. This function never returns
 * `false`: a caller that receives control back always has the condition.
 */
export function ensureServerOnlyConditionOrReExec(scriptPath: string): true {
  if (process.env[CONDITION_APPLIED_ENV] === 'true') {
    return true;
  }

  const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );

  const result = spawnSync(executable, [scriptPath, ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server'].filter(Boolean).join(' '),
      [CONDITION_APPLIED_ENV]: 'true',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
