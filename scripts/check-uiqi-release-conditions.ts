import fs from 'node:fs';
import path from 'node:path';

import { UIQI_CONTRACT_METADATA } from '../src/libs/uiqi/uiqiContract';
import { evaluateUIQIGate, renderUIQIStatusReport } from '../src/libs/uiqi/uiqiGate';

const args = new Set(process.argv.slice(2));
const reportPath = path.join(process.cwd(), UIQI_CONTRACT_METADATA.generatedReport);
const evaluation = evaluateUIQIGate();
const report = renderUIQIStatusReport(evaluation);

if (args.has('--write')) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
}

if (args.has('--check')) {
  if (!fs.existsSync(reportPath)) {
    process.stderr.write(`Generated UIQI report is missing: ${UIQI_CONTRACT_METADATA.generatedReport}\n`);
    process.exitCode = 1;
  } else if (fs.readFileSync(reportPath, 'utf8') !== report) {
    process.stderr.write(`Generated UIQI report is stale. Run: npx tsx ${process.argv[1]} --write\n`);
    process.exitCode = 1;
  }
}

for (const issue of evaluation.issues) {
  process.stderr.write(`[${issue.code}]${issue.conditionId ? ` ${issue.conditionId}:` : ''} ${issue.message}\n`);
}

const { classifications, statuses } = evaluation.counts;
process.stdout.write([
  `UIQI contract ${evaluation.contractVersion}`,
  `fingerprint=${evaluation.fingerprint}`,
  `total=${evaluation.counts.total}`,
  `AUTOMATED_CURRENT=${classifications.AUTOMATED_CURRENT}`,
  `MANUAL_CURRENT=${classifications.MANUAL_CURRENT}`,
  `FUTURE_TRIGGERED=${classifications.FUTURE_TRIGGERED}`,
  `STRUCTURAL_INVARIANT=${classifications.STRUCTURAL_INVARIANT}`,
  `NOT_CURRENTLY_APPLICABLE=${classifications.NOT_CURRENTLY_APPLICABLE}`,
  `PASS=${statuses.PASS}`,
  `FAIL=${statuses.FAIL}`,
  `PENDING_MANUAL=${statuses.PENDING_MANUAL}`,
  `FUTURE_TRIGGERED_STATUS=${statuses.FUTURE_TRIGGERED}`,
  `NOT_APPLICABLE=${statuses.NOT_APPLICABLE}`,
  `foundation=${evaluation.foundationIntegrityPass ? 'PASS' : 'FAIL'}`,
  `currentCompliance=${evaluation.currentProductCompliancePass ? 'PASS' : 'FAIL'}`,
].join('\n'));
process.stdout.write('\n');

if (!evaluation.releaseGatePass) {
  process.exitCode = 1;
}
