import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const evidenceDirectory = '/tmp/luster-onboarding-zero-findings-correction';
await mkdir(evidenceDirectory, { recursive: true });

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'playwright',
    'test',
    '--config=playwright.onboarding-zero-findings.config.ts',
    '--headed',
  ],
  {
    env: {
      ...process.env,
      LUSTER_CAPTURE_EVIDENCE: '1',
    },
    stdio: 'inherit',
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
}
