import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_SELECTION_DIAGNOSIS,
  type DiagnosisCode,
  diagnosisForBookingSelection,
  diagnosisForTechnicianDecision,
  TECHNICIAN_DECISION_DIAGNOSIS,
} from './reasons';

/**
 * A1-2 Piece 1 — the maps in `reasons.ts` must be TOTAL.
 *
 * `Record<Union, DiagnosisCode>` already fails to compile when a union grows a
 * member, but a compile-time guarantee is invisible in CI logs and silently
 * satisfiable by widening the key type. So this suite re-derives both unions
 * AT RUNTIME by parsing them straight out of their declaring modules with the
 * TypeScript AST — the same "resolve it, don't regex it" approach
 * `architecturalInvariants.test.ts` takes — and asserts every member is a key.
 *
 * Add a reason to `bookingPolicy.ts` or a code to `bookingQuote.ts` and this
 * fails until `reasons.ts` maps it.
 */

const ROOT = process.cwd();

/** Every `DiagnosisCode` member, parsed out of `reasons.ts` itself. */
function parse(relativePath: string): ts.SourceFile {
  const source = readFileSync(path.join(ROOT, relativePath), 'utf8');

  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function findTypeAlias(sourceFile: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  const alias = sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );

  if (!alias) {
    throw new Error(`type ${name} not found in ${sourceFile.fileName}`);
  }

  return alias;
}

/** Flattens a (possibly parenthesized, possibly nested) union of string literals. */
function stringLiteralMembers(node: ts.TypeNode): string[] {
  const members: string[] = [];

  const visit = (candidate: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(candidate)) {
      candidate.types.forEach(visit);
      return;
    }

    if (ts.isParenthesizedTypeNode(candidate)) {
      visit(candidate.type);
      return;
    }

    if (ts.isLiteralTypeNode(candidate) && ts.isStringLiteral(candidate.literal)) {
      members.push(candidate.literal.text);
    }
  };

  visit(node);

  return members;
}

/** The `reason` property of the refusal member of `TechnicianBookingDecision`. */
function technicianDecisionReasons(): string[] {
  const alias = findTypeAlias(parse('src/libs/bookingPolicy.ts'), 'TechnicianBookingDecision');
  let reasons: string[] | null = null;

  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && node.name.getText() === 'reason' && node.type) {
      reasons = stringLiteralMembers(node.type);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(alias);

  if (!reasons) {
    throw new Error('TechnicianBookingDecision has no `reason` property to enumerate');
  }

  return reasons;
}

function bookingSelectionErrorCodes(): string[] {
  const alias = findTypeAlias(parse('src/libs/bookingQuote.ts'), 'BookingSelectionErrorCode');

  return stringLiteralMembers(alias.type);
}

function diagnosisCodes(): string[] {
  const alias = findTypeAlias(parse('src/libs/availability/reasons.ts'), 'DiagnosisCode');

  return stringLiteralMembers(alias.type);
}

describe('availability diagnosis vocabulary', () => {
  it('parses the source unions it guards (non-vacuous)', () => {
    // If any of these ever came back empty the coverage assertions below would
    // pass trivially, so pin the shapes first.
    expect(technicianDecisionReasons()).toContain('time_conflict');
    expect(bookingSelectionErrorCodes()).toContain('unsupported_technician');
    expect(diagnosisCodes()).toContain('none');
    expect(technicianDecisionReasons().length).toBeGreaterThan(1);
    expect(bookingSelectionErrorCodes().length).toBeGreaterThan(1);
  });

  it('maps every TechnicianBookingDecision refusal reason to a DiagnosisCode', () => {
    const codes = new Set(diagnosisCodes());

    for (const reason of technicianDecisionReasons()) {
      expect(Object.keys(TECHNICIAN_DECISION_DIAGNOSIS)).toContain(reason);

      const mapped = TECHNICIAN_DECISION_DIAGNOSIS[reason as keyof typeof TECHNICIAN_DECISION_DIAGNOSIS];

      expect(codes.has(mapped)).toBe(true);
    }
  });

  it('maps every BookingSelectionErrorCode to a DiagnosisCode', () => {
    const codes = new Set(diagnosisCodes());

    for (const code of bookingSelectionErrorCodes()) {
      expect(Object.keys(BOOKING_SELECTION_DIAGNOSIS)).toContain(code);

      const mapped = BOOKING_SELECTION_DIAGNOSIS[code as keyof typeof BOOKING_SELECTION_DIAGNOSIS];

      expect(codes.has(mapped)).toBe(true);
    }
  });

  it('adds no key the declaring unions do not have', () => {
    expect(Object.keys(TECHNICIAN_DECISION_DIAGNOSIS).sort()).toEqual(technicianDecisionReasons().sort());
    expect(Object.keys(BOOKING_SELECTION_DIAGNOSIS).sort()).toEqual(bookingSelectionErrorCodes().sort());
  });

  it('keeps the technician-schedule reasons distinguishable from the loop-level ones', () => {
    // Nothing collapses `time_off` and `day_off` into one code: an owner told
    // "the technician is off that day" needs to know whether to edit the
    // weekly schedule or cancel time off.
    expect(diagnosisForTechnicianDecision('time_off')).toBe('technician_time_off');
    expect(diagnosisForTechnicianDecision('day_off')).toBe('technician_day_off');
    expect(diagnosisForTechnicianDecision('time_conflict')).toBe('time_conflict');
  });

  it('collapses every booking-selection failure onto one owner-facing code', () => {
    const mapped = new Set<DiagnosisCode>(
      bookingSelectionErrorCodes().map(code =>
        diagnosisForBookingSelection(code as keyof typeof BOOKING_SELECTION_DIAGNOSIS)),
    );

    expect(Array.from(mapped)).toEqual(['service_not_bookable']);
  });
});
