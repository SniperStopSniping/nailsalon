import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'dotenv';

// Intentionally load ONLY this worktree's explicitly configured development
// file. No production fallback, environment dump, or secret-bearing errors.
async function main() {
  const file = path.resolve('.env.development.local');
  const env = parse(readFileSync(file));
  const database = new URL(env.DATABASE_URL ?? 'file:///missing');
  const safe = env.APP_ENV === 'development' && database.hostname === '127.0.0.1'
    && database.port === '55432' && database.pathname === '/luster_ai_setup_development'
    && (statSync(file).mode & 0o077) === 0;
  const configured = Boolean(env.OPENAI_API_KEY_CUSTOM_SITES);
  const budget = Number(env.CUSTOM_SITE_TRIAL_BUDGET_CAD ?? 0);
  process.stdout.write(`${JSON.stringify({ file, isolatedLocalDatabase: safe, dedicatedKeyConfigured: configured, model: 'gpt-6-astra', approvedCadCap: budget, configured: safe && configured && budget > 0 && budget <= 40 }, null, 2)}\n`);
  if (!safe || !configured || !Number.isFinite(budget) || budget <= 0 || budget > 40) {
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--verify-provider')) {
    // Read-only model availability check; never generates output or purchases.
    const response = await fetch('https://api.openai.com/v1/models/gpt-6-astra', { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY_CUSTOM_SITES}` }, signal: AbortSignal.timeout(15000) });
    const data = response.ok ? await response.json() as { id?: string } : null;
    process.stdout.write(`${JSON.stringify({ modelAccessVerified: response.ok && data?.id === 'gpt-6-astra', httpStatus: response.status })}\n`);
    if (!response.ok || data?.id !== 'gpt-6-astra') {
      process.exitCode = 1;
    }
  }
}
main().catch(() => {
  process.stderr.write('Configuration verification failed. No credentials were logged.\n');
  process.exitCode = 1;
});
