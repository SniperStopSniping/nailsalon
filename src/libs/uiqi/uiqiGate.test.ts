import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  UIQI_AUTOMATED_EVIDENCE,
  UIQI_CONDITIONS,
  UIQI_CONTRACT_METADATA,
  UIQI_CONTRACT_VERSION,
  UIQI_FUTURE_TRIGGERS,
  UIQI_MANUAL_EVIDENCE,
  type UIQICondition,
  type UIQIFutureCapabilityKey,
} from './uiqiContract';
import {
  calculateUIQIContractFingerprint,
  evaluateUIQIGate,
  renderUIQIStatusReport,
  validateUIQIContract,
} from './uiqiGate';

const EXPECTED_FROZEN_CONDITION_IDS = [
  'system.semantic-typography-levels',
  'system.operational-body-typography',
  'system.range-qualifiers-legible',
  'system.single-spacing-rhythm',
  'system.divider-separation',
  'system.card-object-rule',
  'system.sheet-route-rule',
  'system.one-sticky-region-per-edge',
  'system.no-competing-floating-control',
  'system.sticky-fact-has-durable-copy',
  'system.nav-cta-handoff',
  'system.operational-icons-have-meaning',
  'system.maximum-availability-written',
  'system.media-reserved-aspect-ratio',
  'system.media-alt-strategy',
  'system.critical-facts-not-rasterized',
  'system.motion-explains-state-change',
  'system.state-understandable-without-motion',
  'state.loading-retains-known-data',
  'state.empty-identifies-and-recovers',
  'state.incomplete-owner-only',
  'state.hidden-publicly-absent-restorable',
  'state.unsupported-honest',
  'state.pending-not-confirmed',
  'state.success-durable-receipt-first',
  'state.conflict-old-to-current-safe-copy',
  'a11y.practical-target-floor',
  'a11y.readable-contrast',
  'a11y.visible-focus',
  'a11y.semantic-headings-landmarks',
  'a11y.persistent-labels',
  'a11y.required-optional-written',
  'a11y.current-drag-keyboard-alternative',
  'a11y.builder-drag-keyboard-alternative',
  'a11y.current-dom-visual-order',
  'a11y.builder-dom-visual-order',
  'a11y.no-color-alone',
  'a11y.price-time-change-announcement',
  'a11y.sheet-focus-containment-return',
  'a11y.destructive-confirmation',
  'a11y.reduced-motion-parity',
  'a11y.salon-local-time-semantic-output',
  'a11y.salon-local-time-screen-reader',
  'a11y.absolute-deadline-semantic-output',
  'a11y.absolute-deadline-screen-reader',
  'a11y.zoom-200',
  'a11y.short-height-keyboard',
  'a11y.instagram-tiktok-webview',
  'future.portfolio-alt-authoring',
  'future.salon-profile-hero-derived-alt',
  'future.service-menu-grouped-headings',
] as const;

function statusFor(conditionId: string, input: Parameters<typeof evaluateUIQIGate>[0] = {}) {
  const evaluated = evaluateUIQIGate(input).conditions.find(entry => entry.condition.id === conditionId);

  expect(evaluated, conditionId).toBeDefined();

  return evaluated!;
}

describe('UIQI canonical release contract', () => {
  it('accounts for every frozen clause with one stable canonical ID', () => {
    expect(UIQI_CONDITIONS.map(condition => condition.id)).toEqual(EXPECTED_FROZEN_CONDITION_IDS);
    expect(UIQI_CONDITIONS).toHaveLength(UIQI_CONTRACT_METADATA.expectedConditionCount);
    expect(new Set(UIQI_CONDITIONS.map(condition => condition.id))).toHaveLength(UIQI_CONDITIONS.length);
    expect(validateUIQIContract()).toEqual([]);
  });

  it('pins the explicit contract version and meaning fingerprint', () => {
    expect(UIQI_CONTRACT_VERSION).toBe('1.0.0');
    expect(calculateUIQIContractFingerprint(UIQI_CONDITIONS)).toBe(
      'a09ed82abebb0b63fdc5a0a04227a4ff0757004670932e9f8570a1f17ea479ac',
    );
  });

  it('reports honest default classification and status counts', () => {
    const evaluation = evaluateUIQIGate();

    expect(evaluation.foundationIntegrityPass).toBe(true);
    expect(evaluation.currentProductCompliancePass).toBe(true);
    expect(evaluation.releaseGatePass).toBe(true);
    expect(evaluation.counts).toEqual({
      total: 51,
      classifications: {
        AUTOMATED_CURRENT: 20,
        MANUAL_CURRENT: 21,
        FUTURE_TRIGGERED: 5,
        STRUCTURAL_INVARIANT: 5,
        NOT_CURRENTLY_APPLICABLE: 0,
      },
      statuses: {
        PASS: 25,
        FAIL: 0,
        PENDING_MANUAL: 21,
        FUTURE_TRIGGERED: 5,
        NOT_APPLICABLE: 0,
      },
    });
  });

  it('keeps landed Stage 3A, 3B, 3C1, and 3C2 evidence executable and referenced', () => {
    const usedEvidence = new Set(UIQI_CONDITIONS.flatMap(condition => condition.automatedEvidenceIds));

    expect(usedEvidence).toEqual(new Set([
      'stage2-canonical-sections',
      'public-dto-boundary',
      'stage3a-target-geometry',
      'stage3a-dialog-focus',
      'stage3b-booking-states',
      'stage3b-deadline',
      'stage3c1-public-booking',
      'stage3c2-modal-focus',
      'stage3c2-bottom-sheet',
      'stage3c2-destructive-confirmation',
      'stage3c2-bottom-region',
      'responsive-reduced-motion',
    ]));

    for (const [id, evidence] of Object.entries(UIQI_AUTOMATED_EVIDENCE)) {
      expect(evidence.id).toBe(id);
      expect(evidence.command).not.toBe('');

      for (const evidencePath of evidence.paths) {
        expect(fs.existsSync(path.join(process.cwd(), evidencePath)), `${id}: ${evidencePath}`).toBe(true);
      }
    }
  });

  it('derives the committed human-readable report from the canonical source', () => {
    const generated = renderUIQIStatusReport();
    const committed = fs.readFileSync(path.join(process.cwd(), UIQI_CONTRACT_METADATA.generatedReport), 'utf8');

    expect(committed).toBe(generated);
    expect(generated).toContain(`Contract version: \`${UIQI_CONTRACT_VERSION}\``);
    expect(generated).toContain('PENDING_MANUAL: 21');
    expect(generated).toContain('Manual evidence remains visibly pending and is not counted as PASS.');
  });
});

describe('UIQI aggregate-gate non-vacuity', () => {
  it('fails integrity when one frozen condition is removed', () => {
    const issues = validateUIQIContract({ conditions: UIQI_CONDITIONS.slice(1) });

    expect(issues.map(issue => issue.code)).toContain('FROZEN_CLAUSE_COUNT_MISMATCH');
  });

  it('fails integrity when a stable condition ID is duplicated', () => {
    const duplicated: UIQICondition[] = [
      ...UIQI_CONDITIONS,
      { ...UIQI_CONDITIONS[0]! },
    ];
    const issues = validateUIQIContract({ conditions: duplicated });

    expect(issues.map(issue => issue.code)).toContain('DUPLICATE_CONDITION_ID');
  });

  it('fails integrity when an automated evidence reference is stale', () => {
    const conditions = UIQI_CONDITIONS.map(condition => condition.id === 'a11y.practical-target-floor'
      ? { ...condition, automatedEvidenceIds: ['missing-evidence'] }
      : condition);
    const issues = validateUIQIContract({ conditions });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'UNKNOWN_AUTOMATED_EVIDENCE',
      conditionId: 'a11y.practical-target-floor',
    }));
  });

  it('fails the aggregate result when required automated evidence regresses', () => {
    const evaluation = evaluateUIQIGate({
      automatedFailures: ['state.loading-retains-known-data'],
    });

    expect(evaluation.foundationIntegrityPass).toBe(true);
    expect(evaluation.currentProductCompliancePass).toBe(false);
    expect(evaluation.releaseGatePass).toBe(false);
    expect(statusFor('state.loading-retains-known-data', {
      automatedFailures: ['state.loading-retains-known-data'],
    }).status).toBe('FAIL');
  });

  it('rejects a manual PASS that has no build-scoped artifact', () => {
    const target = UIQI_MANUAL_EVIDENCE[0]!;
    const conditions = UIQI_CONDITIONS.map(condition => condition.id === target.conditionId
      ? { ...condition, currentStatus: 'PASS' as const }
      : condition);
    const manualEvidence = UIQI_MANUAL_EVIDENCE.map(record => record.conditionId === target.conditionId
      ? { ...record, result: 'PASS' as const }
      : record);
    const issues = validateUIQIContract({ conditions, manualEvidence });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'MANUAL_RESULT_WITHOUT_EVIDENCE',
      conditionId: target.conditionId,
    }));
  });

  it('fails integrity when a future-trigger mapping is broken', () => {
    const futureTriggers = Object.fromEntries(
      Object.entries(UIQI_FUTURE_TRIGGERS).filter(([id]) => id !== 'portfolio-alt-authoring'),
    );
    const issues = validateUIQIContract({ futureTriggers });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'UNKNOWN_FUTURE_TRIGGER',
      conditionId: 'future.portfolio-alt-authoring',
    }));
  });
});

describe('UIQI named future-trigger discrimination', () => {
  const cases: Array<{
    conditionId: string;
    activation: UIQIFutureCapabilityKey;
    prerequisite: UIQIFutureCapabilityKey;
  }> = [
    {
      conditionId: 'future.portfolio-alt-authoring',
      activation: 'portfolioVariant',
      prerequisite: 'portfolioAltAuthoring',
    },
    {
      conditionId: 'future.salon-profile-hero-derived-alt',
      activation: 'salonProfileHeroImage',
      prerequisite: 'salonProfileHeroDerivedAlt',
    },
    {
      conditionId: 'future.service-menu-grouped-headings',
      activation: 'serviceMenuGroupedCategories',
      prerequisite: 'serviceMenuGroupedSemanticHeadings',
    },
    {
      conditionId: 'a11y.builder-drag-keyboard-alternative',
      activation: 'builderReorder',
      prerequisite: 'builderKeyboardReorder',
    },
    {
      conditionId: 'a11y.builder-dom-visual-order',
      activation: 'builderReorder',
      prerequisite: 'builderDomVisualOrder',
    },
  ];

  for (const fixture of cases) {
    it(`${fixture.conditionId} stays inactive, fails without its prerequisite, and passes only with it`, () => {
      expect(statusFor(fixture.conditionId).status).toBe('FUTURE_TRIGGERED');

      const activeWithoutPrerequisite = statusFor(fixture.conditionId, {
        futureCapabilities: { [fixture.activation]: true },
      });

      expect(activeWithoutPrerequisite.triggerActive).toBe(true);
      expect(activeWithoutPrerequisite.status).toBe('FAIL');

      const activeWithPrerequisite = statusFor(fixture.conditionId, {
        futureCapabilities: {
          [fixture.activation]: true,
          [fixture.prerequisite]: true,
        },
      });

      expect(activeWithPrerequisite.status).toBe('PASS');
    });
  }
});
