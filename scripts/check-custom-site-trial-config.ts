import path from 'node:path';

import pg from 'pg';

import { inspectDevelopmentConfig, readPrivateDevelopmentConfig } from './lib/custom-site-development-config';

// Intentionally load ONLY this worktree's explicitly configured development
// file. No production fallback, environment dump, or secret-bearing errors.
async function main() {
  const file = path.resolve('.env.development.local');
  const flags = new Set(process.argv.slice(2));
  if ([...flags].some(flag => !['--verify-provider', '--verify-budget', '--require-owner-credentials', '--require-payment-credentials'].includes(flag))) {
    throw new Error('Unsupported check.');
  }
  const env = readPrivateDevelopmentConfig(file);
  const configuration = inspectDevelopmentConfig(env);
  process.stdout.write(`${JSON.stringify({ file, ...configuration }, null, 2)}\n`);
  if (!configuration.aiConfigured) {
    process.exitCode = 1;
    return;
  }
  if (flags.has('--verify-budget')) {
    const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    let transactionStarted = false;
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      transactionStarted = true;
      const identity = (await client.query('SELECT current_database() AS name, inet_server_addr()::text AS host')).rows[0];
      const markers = (await client.query('SELECT environment FROM luster_environment LIMIT 2')).rows;
      if (identity?.name !== 'luster_ai_setup_development' || identity?.host !== '127.0.0.1/32' || markers.length !== 1 || markers[0].environment !== 'development') {
        throw new Error('Database isolation could not be attested.');
      }
      const budget = (await client.query(`SELECT b.cap_micro_cad, coalesce(sum(c.charged_micro_cad),0) charged_micro_cad,
        count(*) filter(where c.status='pending') pending FROM setup_ai_budget b LEFT JOIN setup_ai_call c ON c.budget_id=b.id
        WHERE b.id='initial-custom-website-trial' GROUP BY b.cap_micro_cad`)).rows[0];
      const cap = Number(budget?.cap_micro_cad);
      const charged = Number(budget?.charged_micro_cad);
      const valid = Boolean(budget) && Number.isSafeInteger(cap) && cap > 0 && cap <= configuration.approvedCombinedTestingCapCad * 1_000_000 && Number.isSafeInteger(charged) && charged >= 0;
      const effectiveCap = valid ? Math.min(cap, Math.floor(configuration.configuredLocalCapCad! * 1_000_000)) : null;
      process.stdout.write(`${JSON.stringify({ databaseAttested: true, existingBudgetVerified: valid, persistedLocalCapMicroCad: valid ? cap : null, effectiveLocalCapMicroCad: effectiveCap, fileCapExceedsPersistedAllocation: valid && configuration.configuredLocalCapCad! * 1_000_000 > cap, chargedOrRetainedMicroCad: valid ? charged : null, pendingCalls: valid ? Number(budget.pending) : null, remainingMicroCad: effectiveCap === null ? null : Math.max(0, effectiveCap - charged), budgetCreatedOrChanged: false })}\n`);
      if (!valid || charged >= effectiveCap!) {
        process.exitCode = 1;
      }
    } finally {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
      await client.end();
    }
  }
  if (flags.has('--verify-provider')) {
    // Read-only model availability check; never generates output or purchases.
    for (const model of Object.values(configuration.models)) {
      const response = await fetch(`https://api.openai.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY_CUSTOM_SITES}` }, signal: AbortSignal.timeout(15000) });
      const data = response.ok ? await response.json() as { id?: string } : null;
      process.stdout.write(`${JSON.stringify({ model, modelAccessVerified: response.ok && data?.id === model, httpStatus: response.status, generationStarted: false })}\n`);
      if (!response.ok || data?.id !== model) {
        process.exitCode = 1;
      }
    }
  }
  if ((flags.has('--require-owner-credentials') && !configuration.clerkDevelopmentCredentialsConfigured)
    || (flags.has('--require-payment-credentials') && (!configuration.clerkDevelopmentCredentialsConfigured || !configuration.stripeSandboxCredentialsConfigured))) {
    process.exitCode = 1;
  }
}
main().catch(() => {
  process.stderr.write('Configuration verification failed. No credentials were logged.\n');
  process.exitCode = 1;
});
