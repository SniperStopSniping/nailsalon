import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  UIQI_APPLICABILITY_CLASSES,
  UIQI_AUTOMATED_EVIDENCE,
  UIQI_CONDITIONS,
  UIQI_CONTRACT_METADATA,
  UIQI_CONTRACT_VERSION,
  UIQI_DEFAULT_FUTURE_CAPABILITIES,
  UIQI_FUTURE_TRIGGERS,
  UIQI_MANUAL_EVIDENCE,
  UIQI_MANUAL_PROTOCOLS,
  UIQI_STATUS_VALUES,
  type UIQIApplicability,
  type UIQIAutomatedEvidence,
  type UIQICondition,
  type UIQIFutureCapabilities,
  type UIQIFutureTrigger,
  type UIQIManualEvidenceRecord,
  type UIQIManualProtocol,
  type UIQIStatus,
} from './uiqiContract';

export type UIQIGateIssue = {
  code: string;
  message: string;
  conditionId?: string;
};

export type UIQIEvaluatedCondition = {
  condition: UIQICondition;
  status: UIQIStatus;
  triggerActive: boolean;
};

export type UIQIGateCounts = {
  total: number;
  classifications: Record<UIQIApplicability, number>;
  statuses: Record<UIQIStatus, number>;
};

export type UIQIGateEvaluation = {
  contractVersion: typeof UIQI_CONTRACT_VERSION;
  fingerprint: string;
  issues: readonly UIQIGateIssue[];
  conditions: readonly UIQIEvaluatedCondition[];
  counts: UIQIGateCounts;
  foundationIntegrityPass: boolean;
  currentProductCompliancePass: boolean;
  releaseGatePass: boolean;
};

export type UIQIGateInput = {
  conditions?: readonly UIQICondition[];
  evidenceCatalog?: Readonly<Record<string, UIQIAutomatedEvidence>>;
  manualProtocols?: Readonly<Record<string, UIQIManualProtocol>>;
  manualEvidence?: readonly UIQIManualEvidenceRecord[];
  futureTriggers?: Readonly<Record<string, UIQIFutureTrigger>>;
  futureCapabilities?: Partial<UIQIFutureCapabilities>;
  automatedFailures?: readonly string[];
  repoRoot?: string;
};

const STATUS_BY_MANUAL_RESULT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  PENDING: 'PENDING_MANUAL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const satisfies Record<UIQIManualEvidenceRecord['result'], UIQIStatus>;

function emptyCounts(): UIQIGateCounts {
  return {
    total: 0,
    classifications: Object.fromEntries(
      UIQI_APPLICABILITY_CLASSES.map(classification => [classification, 0]),
    ) as Record<UIQIApplicability, number>,
    statuses: Object.fromEntries(
      UIQI_STATUS_VALUES.map(status => [status, 0]),
    ) as Record<UIQIStatus, number>,
  };
}

function normalizedRequirement(requirement: string): string {
  return requirement.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

export function calculateUIQIContractFingerprint(conditions: readonly UIQICondition[]): string {
  const canonical = [...conditions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(condition => ({
      id: condition.id,
      requirement: condition.requirement,
      category: condition.category,
      applicability: condition.applicability,
      severity: condition.severity,
      evidenceType: condition.evidenceType,
      automatedEvidenceIds: [...condition.automatedEvidenceIds].sort(),
      manualProtocolId: condition.manualProtocolId,
      futureTriggerId: condition.futureTriggerId,
      surface: condition.surface,
      version: condition.version,
    }));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function validateConditionStatus(condition: UIQICondition): UIQIGateIssue[] {
  const issues: UIQIGateIssue[] = [];
  const allowedStatuses: Record<UIQIApplicability, readonly UIQIStatus[]> = {
    AUTOMATED_CURRENT: ['PASS', 'FAIL'],
    MANUAL_CURRENT: ['PASS', 'FAIL', 'PENDING_MANUAL', 'NOT_APPLICABLE'],
    FUTURE_TRIGGERED: ['FUTURE_TRIGGERED'],
    STRUCTURAL_INVARIANT: ['PASS', 'FAIL'],
    NOT_CURRENTLY_APPLICABLE: ['NOT_APPLICABLE'],
  };

  if (!allowedStatuses[condition.applicability].includes(condition.currentStatus)) {
    issues.push({
      code: 'INVALID_STATUS_FOR_CLASSIFICATION',
      conditionId: condition.id,
      message: `${condition.currentStatus} is not valid for ${condition.applicability}.`,
    });
  }

  return issues;
}

function validateManualEvidenceRecord(
  condition: UIQICondition,
  record: UIQIManualEvidenceRecord,
): UIQIGateIssue[] {
  const issues: UIQIGateIssue[] = [];
  const completed = record.result !== 'PENDING';
  const hasValidSha = record.testedBuildSha !== null && /^[0-9a-f]{40}$/.test(record.testedBuildSha);
  const hasCompletedMetadata = hasValidSha && Boolean(record.date?.trim()) && Boolean(record.artifact?.trim());

  if (record.contractVersion !== UIQI_CONTRACT_VERSION) {
    issues.push({
      code: 'MANUAL_VERSION_MISMATCH',
      conditionId: condition.id,
      message: `Manual evidence uses ${record.contractVersion}; expected ${UIQI_CONTRACT_VERSION}.`,
    });
  }
  if (record.protocolId !== condition.manualProtocolId) {
    issues.push({
      code: 'MANUAL_PROTOCOL_MISMATCH',
      conditionId: condition.id,
      message: `Manual evidence references ${record.protocolId}; expected ${condition.manualProtocolId}.`,
    });
  }
  if (completed && !hasCompletedMetadata) {
    issues.push({
      code: 'MANUAL_RESULT_WITHOUT_EVIDENCE',
      conditionId: condition.id,
      message: `${record.result} requires a 40-character build SHA, date, and artifact.`,
    });
  }
  if (!completed && (record.testedBuildSha !== null || record.date !== null || record.artifact !== null)) {
    issues.push({
      code: 'PENDING_MANUAL_HAS_FAKE_COMPLETION',
      conditionId: condition.id,
      message: 'Pending manual evidence must not carry completion metadata.',
    });
  }

  const evidenceStatus = STATUS_BY_MANUAL_RESULT[record.result];
  if (condition.currentStatus !== evidenceStatus) {
    issues.push({
      code: 'MANUAL_STATUS_MISMATCH',
      conditionId: condition.id,
      message: `Condition declares ${condition.currentStatus}, but its evidence resolves to ${evidenceStatus}.`,
    });
  }

  return issues;
}

export function validateUIQIContract(input: UIQIGateInput = {}): UIQIGateIssue[] {
  const conditions = input.conditions ?? UIQI_CONDITIONS;
  const evidenceCatalog: Readonly<Record<string, UIQIAutomatedEvidence>>
    = input.evidenceCatalog ?? UIQI_AUTOMATED_EVIDENCE;
  const manualProtocols: Readonly<Record<string, UIQIManualProtocol>>
    = input.manualProtocols ?? UIQI_MANUAL_PROTOCOLS;
  const manualEvidence = input.manualEvidence ?? UIQI_MANUAL_EVIDENCE;
  const futureTriggers: Readonly<Record<string, UIQIFutureTrigger>>
    = input.futureTriggers ?? UIQI_FUTURE_TRIGGERS;
  const repoRoot = input.repoRoot ?? process.cwd();
  const issues: UIQIGateIssue[] = [];

  if (UIQI_CONTRACT_METADATA.version !== UIQI_CONTRACT_VERSION) {
    issues.push({ code: 'CONTRACT_VERSION_MISMATCH', message: 'Contract metadata and condition version constants disagree.' });
  }
  if (!/^\d+\.\d+\.\d+$/.test(UIQI_CONTRACT_VERSION)) {
    issues.push({ code: 'INVALID_CONTRACT_VERSION', message: `${UIQI_CONTRACT_VERSION} is not an explicit semantic version.` });
  }
  if (conditions.length !== UIQI_CONTRACT_METADATA.expectedConditionCount) {
    issues.push({
      code: 'FROZEN_CLAUSE_COUNT_MISMATCH',
      message: `Expected ${UIQI_CONTRACT_METADATA.expectedConditionCount} frozen conditions; found ${conditions.length}.`,
    });
  }
  if (calculateUIQIContractFingerprint(conditions) !== UIQI_CONTRACT_METADATA.meaningFingerprint) {
    issues.push({
      code: 'CONTRACT_MEANING_FINGERPRINT_MISMATCH',
      message: 'The frozen condition meaning changed. Bump the contract version and record the new fingerprint explicitly.',
    });
  }

  const ids = new Set<string>();
  const requirements = new Set<string>();
  for (const condition of conditions) {
    if (ids.has(condition.id)) {
      issues.push({ code: 'DUPLICATE_CONDITION_ID', conditionId: condition.id, message: `Duplicate condition ID ${condition.id}.` });
    }
    ids.add(condition.id);

    const semanticKey = normalizedRequirement(condition.requirement);
    if (requirements.has(semanticKey)) {
      issues.push({
        code: 'DUPLICATE_SEMANTIC_CONDITION',
        conditionId: condition.id,
        message: `The requirement is duplicated without a distinct scoped meaning: ${condition.requirement}`,
      });
    }
    requirements.add(semanticKey);

    if (!condition.id.trim() || !condition.requirement.trim() || !condition.rationale.trim()) {
      issues.push({ code: 'INCOMPLETE_CONDITION', conditionId: condition.id, message: 'ID, requirement, and rationale must be non-empty.' });
    }
    if (condition.version !== UIQI_CONTRACT_VERSION) {
      issues.push({
        code: 'CONDITION_VERSION_MISMATCH',
        conditionId: condition.id,
        message: `Condition uses ${condition.version}; expected ${UIQI_CONTRACT_VERSION}.`,
      });
    }
    issues.push(...validateConditionStatus(condition));

    if (condition.applicability === 'AUTOMATED_CURRENT' || condition.applicability === 'STRUCTURAL_INVARIANT') {
      if (condition.automatedEvidenceIds.length === 0) {
        issues.push({ code: 'AUTOMATED_EVIDENCE_MISSING', conditionId: condition.id, message: 'Applicable automated conditions require executable evidence.' });
      }
      if (condition.manualProtocolId !== null || condition.futureTriggerId !== null) {
        issues.push({ code: 'AUTOMATED_EVIDENCE_CONFLICT', conditionId: condition.id, message: 'Automated conditions cannot masquerade as manual or future conditions.' });
      }
    } else if (condition.automatedEvidenceIds.length > 0) {
      issues.push({ code: 'NON_AUTOMATED_HAS_AUTOMATED_EVIDENCE', conditionId: condition.id, message: `${condition.applicability} cannot claim automated evidence as current proof.` });
    }

    for (const evidenceId of condition.automatedEvidenceIds) {
      const evidence = evidenceCatalog[evidenceId];
      if (!evidence) {
        issues.push({ code: 'UNKNOWN_AUTOMATED_EVIDENCE', conditionId: condition.id, message: `Unknown evidence reference ${evidenceId}.` });
        continue;
      }
      if (!evidence.command.trim() || !evidence.proves.trim() || evidence.paths.length === 0) {
        issues.push({ code: 'INCOMPLETE_AUTOMATED_EVIDENCE', conditionId: condition.id, message: `${evidenceId} is incomplete.` });
      }
      for (const evidencePath of evidence.paths) {
        if (!fs.existsSync(path.join(repoRoot, evidencePath))) {
          issues.push({ code: 'STALE_AUTOMATED_EVIDENCE_PATH', conditionId: condition.id, message: `${evidenceId} references missing path ${evidencePath}.` });
        }
      }
    }

    if (condition.applicability === 'MANUAL_CURRENT') {
      if (!condition.manualProtocolId || !manualProtocols[condition.manualProtocolId]) {
        issues.push({ code: 'UNKNOWN_MANUAL_PROTOCOL', conditionId: condition.id, message: `Manual condition references missing protocol ${condition.manualProtocolId}.` });
      }
      const records = manualEvidence.filter(record => record.conditionId === condition.id);
      if (records.length !== 1) {
        issues.push({ code: 'MANUAL_RECORD_CARDINALITY', conditionId: condition.id, message: `Expected one manual record; found ${records.length}.` });
      } else {
        issues.push(...validateManualEvidenceRecord(condition, records[0]!));
      }
    } else if (condition.manualProtocolId !== null) {
      issues.push({ code: 'MANUAL_PROTOCOL_CLASSIFICATION_MISMATCH', conditionId: condition.id, message: 'Only MANUAL_CURRENT conditions may reference a manual protocol.' });
    }

    if (condition.applicability === 'FUTURE_TRIGGERED') {
      if (!condition.futureTriggerId || !futureTriggers[condition.futureTriggerId]) {
        issues.push({ code: 'UNKNOWN_FUTURE_TRIGGER', conditionId: condition.id, message: `Future condition references missing trigger ${condition.futureTriggerId}.` });
      }
    } else if (condition.futureTriggerId !== null) {
      issues.push({ code: 'FUTURE_TRIGGER_CLASSIFICATION_MISMATCH', conditionId: condition.id, message: 'Only FUTURE_TRIGGERED conditions may reference a trigger.' });
    }
  }

  for (const record of manualEvidence) {
    const condition = conditions.find(candidate => candidate.id === record.conditionId);
    if (!condition) {
      issues.push({ code: 'ORPHAN_MANUAL_RECORD', conditionId: record.conditionId, message: 'Manual evidence references a condition that is not in the contract.' });
    } else if (condition.applicability !== 'MANUAL_CURRENT') {
      issues.push({ code: 'MANUAL_RECORD_FOR_NON_MANUAL_CONDITION', conditionId: record.conditionId, message: 'Manual evidence cannot redefine a non-manual condition.' });
    }
  }

  for (const failureId of input.automatedFailures ?? []) {
    const condition = conditions.find(candidate => candidate.id === failureId);
    if (!condition) {
      issues.push({ code: 'UNKNOWN_AUTOMATED_FAILURE', conditionId: failureId, message: 'The injected automated failure does not reference a condition.' });
    } else if (!['AUTOMATED_CURRENT', 'STRUCTURAL_INVARIANT'].includes(condition.applicability)) {
      issues.push({ code: 'INVALID_AUTOMATED_FAILURE', conditionId: failureId, message: `${condition.applicability} cannot be failed through automated evidence.` });
    }
  }

  return issues;
}

export function evaluateUIQIGate(input: UIQIGateInput = {}): UIQIGateEvaluation {
  const conditions = input.conditions ?? UIQI_CONDITIONS;
  const manualEvidence = input.manualEvidence ?? UIQI_MANUAL_EVIDENCE;
  const futureTriggers: Readonly<Record<string, UIQIFutureTrigger>>
    = input.futureTriggers ?? UIQI_FUTURE_TRIGGERS;
  const capabilities: UIQIFutureCapabilities = {
    ...UIQI_DEFAULT_FUTURE_CAPABILITIES,
    ...input.futureCapabilities,
  };
  const automatedFailures = new Set(input.automatedFailures ?? []);
  const issues = validateUIQIContract(input);

  const evaluated = conditions.map((condition): UIQIEvaluatedCondition => {
    if (condition.applicability === 'AUTOMATED_CURRENT' || condition.applicability === 'STRUCTURAL_INVARIANT') {
      return {
        condition,
        status: automatedFailures.has(condition.id) ? 'FAIL' : condition.currentStatus,
        triggerActive: false,
      };
    }
    if (condition.applicability === 'MANUAL_CURRENT') {
      const record = manualEvidence.find(candidate => candidate.conditionId === condition.id);
      return {
        condition,
        status: record ? STATUS_BY_MANUAL_RESULT[record.result] : 'FAIL',
        triggerActive: false,
      };
    }
    if (condition.applicability === 'FUTURE_TRIGGERED') {
      const trigger = condition.futureTriggerId ? futureTriggers[condition.futureTriggerId] : undefined;
      const triggerActive = trigger ? capabilities[trigger.activationCapability] : false;
      return {
        condition,
        status: !triggerActive
          ? 'FUTURE_TRIGGERED'
          : trigger && capabilities[trigger.prerequisiteCapability]
            ? 'PASS'
            : 'FAIL',
        triggerActive,
      };
    }
    return { condition, status: 'NOT_APPLICABLE', triggerActive: false };
  });

  const counts = emptyCounts();
  counts.total = evaluated.length;
  for (const entry of evaluated) {
    counts.classifications[entry.condition.applicability] += 1;
    counts.statuses[entry.status] += 1;
  }

  const foundationIntegrityPass = issues.length === 0;
  const currentProductCompliancePass = evaluated.every(entry => entry.status !== 'FAIL');

  return {
    contractVersion: UIQI_CONTRACT_VERSION,
    fingerprint: calculateUIQIContractFingerprint(conditions),
    issues,
    conditions: evaluated,
    counts,
    foundationIntegrityPass,
    currentProductCompliancePass,
    releaseGatePass: foundationIntegrityPass && currentProductCompliancePass,
  };
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function conditionEvidenceLabel(condition: UIQICondition): string {
  if (condition.automatedEvidenceIds.length > 0) {
    return condition.automatedEvidenceIds.join(', ');
  }
  if (condition.manualProtocolId) {
    return condition.manualProtocolId;
  }
  if (condition.futureTriggerId) {
    return condition.futureTriggerId;
  }
  return 'none';
}

export function renderUIQIStatusReport(evaluation: UIQIGateEvaluation = evaluateUIQIGate()): string {
  const { counts } = evaluation;
  const lines = [
    '# Luster UIQI Contract Status',
    '',
    '> GENERATED from `src/libs/uiqi/uiqiContract.ts`. Do not edit this file manually.',
    '',
    `- Contract version: \`${evaluation.contractVersion}\``,
    `- Contract fingerprint: \`${evaluation.fingerprint}\``,
    `- Aggregate gate: \`${UIQI_CONTRACT_METADATA.aggregateGate}\``,
    `- CI context: \`${UIQI_CONTRACT_METADATA.ciContext}\``,
    `- Foundation integrity: **${evaluation.foundationIntegrityPass ? 'PASS' : 'FAIL'}**`,
    `- Current automated compliance: **${evaluation.currentProductCompliancePass ? 'PASS' : 'FAIL'}**`,
    '',
    '## Counts',
    '',
    `- Total: ${counts.total}`,
    ...UIQI_APPLICABILITY_CLASSES.map(classification => `- ${classification}: ${counts.classifications[classification]}`),
    ...UIQI_STATUS_VALUES.map(status => `- ${status}: ${counts.statuses[status]}`),
    '',
    'Manual evidence remains visibly pending and is not counted as PASS. Inactive future triggers are not implemented features and are not counted as current failures.',
    '',
    '## Conditions',
    '',
    '| ID | Requirement | Classification | Status | Surface | Evidence / protocol / trigger |',
    '| --- | --- | --- | --- | --- | --- |',
    ...evaluation.conditions.map(({ condition, status }) => [
      escapeCell(condition.id),
      escapeCell(condition.requirement),
      condition.applicability,
      status,
      condition.surface,
      escapeCell(conditionEvidenceLabel(condition)),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '## Pending manual evidence',
    '',
    '| Condition | Protocol | Result | Tested build SHA | Artifact |',
    '| --- | --- | --- | --- | --- |',
    ...UIQI_MANUAL_EVIDENCE.map(record => `| ${record.conditionId} | ${record.protocolId} | ${record.result} | ${record.testedBuildSha ?? 'not tested'} | ${record.artifact ?? 'pending'} |`),
    '',
    '## Future triggers',
    '',
    '| Trigger | Activates when | Requirement when active |',
    '| --- | --- | --- |',
    ...Object.values(UIQI_FUTURE_TRIGGERS).map(trigger => `| ${trigger.id} | ${escapeCell(trigger.activatesWhen)} | ${escapeCell(trigger.requirementWhenActive)} |`),
  ];

  return `${lines.join('\n')}\n`;
}
