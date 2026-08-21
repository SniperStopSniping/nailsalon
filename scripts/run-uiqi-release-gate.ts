import { spawnSync } from 'node:child_process';

import {
  UIQI_AUTOMATED_EVIDENCE,
  UIQI_CONDITIONS,
  type UIQIAutomatedEvidence,
} from '../src/libs/uiqi/uiqiContract';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const evidenceCatalog: Readonly<Record<string, UIQIAutomatedEvidence>>
  = UIQI_AUTOMATED_EVIDENCE;
const currentEvidenceIds = new Set(
  UIQI_CONDITIONS
    .filter(condition => (
      condition.applicability === 'AUTOMATED_CURRENT'
      || condition.applicability === 'STRUCTURAL_INVARIANT'
    ))
    .flatMap(condition => condition.automatedEvidenceIds),
);
const currentEvidenceTests = [...currentEvidenceIds]
  .flatMap((evidenceId) => {
    const evidence = evidenceCatalog[evidenceId];
    if (!evidence) {
      process.stderr.write(`Unknown current UIQI evidence: ${evidenceId}\n`);
      process.exit(1);
    }
    return evidence.paths;
  })
  .filter(evidencePath => /\.test\.[cm]?[jt]sx?$/.test(evidencePath));
const vitestFiles = [
  'src/libs/uiqi/uiqiGate.test.ts',
  ...new Set(currentEvidenceTests),
];

if (process.argv.includes('--require-ci-evidence')) {
  const requiredResults = {
    'Full Vitest Suite': process.env.UIQI_FULL_VITEST_RESULT,
    'Run all tests': process.env.UIQI_RUN_ALL_TESTS_RESULT,
  };
  for (const [context, result] of Object.entries(requiredResults)) {
    if (result !== 'success') {
      process.stderr.write(`${context} did not supply successful UIQI evidence (result: ${result ?? 'missing'}).\n`);
      process.exit(1);
    }
  }
}

const commands: Array<[string, string[]]> = [
  [npx, ['vitest', 'run', ...vitestFiles]],
  [npx, ['tsx', 'scripts/check-uiqi-release-conditions.ts', '--check']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
