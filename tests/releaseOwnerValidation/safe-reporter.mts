import { writeFileSync } from 'node:fs';

import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
// Intentionally do not forward raw stdio, assertion diffs, error messages,
// stack traces, URL-bearing failures, attachments or page DOM into results.
export default class SafeReporter implements Reporter {
  private outputFile: string;
  private events: Array<Record<string, unknown>> = [];
  private outcomes: Array<Record<string, unknown>> = [];
  constructor(options: { outputFile: string }) {
    this.outputFile = options.outputFile;
  }

  onStdOut(chunk: string | Buffer, test?: TestCase) {
    const project = test?.parent.project()?.name;
    const text = chunk.toString();
    if (text.length > 12_000 || this.events.length >= 240) {
      return;
    }
    for (const line of text.split('\n')) {
      const stage = line.match(/^\[owner-journey\] stage=([a-z][a-z0-9-]{0,79})$/u);
      if (stage) {
        this.events.push({ type: 'stage', project, stage: stage[1] });
        process.stdout.write(`[fresh-owner] ${project}: ${stage[1]}\n`);
      }
      const created = line.match(/^\[fresh-owner-created-artifacts\] (.+)$/u);
      if (created) {
        try {
          const value = JSON.parse(created[1]!);
          if (['desktop-chromium', 'iphone-13-webkit'].includes(value.project)
            && /^[a-z0-9-]{8,50}$/u.test(value.tag)
            && /^user_[A-Za-z0-9]+$/u.test(value.userId) && (value.organizationId === undefined || /^org_[A-Za-z0-9]+$/u.test(value.organizationId))) {
            this.events.push({ type: 'created-artifacts', project: value.project, tag: value.tag, userId: value.userId, organizationId: value.organizationId });
          }
        } catch { /* Raw payload discarded. */ }
      }
      const diagnostic = line.match(/^\[owner-journey\] safe-diagnostic (.+)$/u);
      if (diagnostic) {
        try {
          const value = JSON.parse(diagnostic[1]!);
          // Pick a bounded vocabulary. Never forward arbitrary fields from logs.
          const safe: Record<string, unknown> = { type: 'diagnostic', project };
          for (const key of ['type', 'source', 'path', 'phase', 'name', 'exceptionClass', 'sourceClass', 'sessionStatus', 'pendingTaskKind', 'signupStatus', 'checkpoint', 'routeClass']) {
            const field = value[key];
            if (typeof field === 'string' && /^[\w./:-]{1,100}$/u.test(field)) {
              safe[key === 'type' ? 'diagnosticType' : key] = field;
            }
          }
          for (const key of ['status', 'clerkLoaded', 'sessionPresent', 'userPresent', 'primaryEmailPresent', 'primaryEmailVerified', 'emailVerified', 'createdSessionPresent', 'unavailable', 'ownedOrigin', 'createOwnerHeadingVisible', 'wizardHeadingVisible', 'organizationTaskHeadingVisible', 'verificationCodeInputVisible', 'emailInputVisible', 'passwordInputVisible', 'alertVisible', 'createOrganizationEnabled', 'organizationNameInputVisible', 'organizationNameInputDisabled', 'nameInputVisible', 'nameInputDisabled', 'workspaceNameInputVisible', 'workspaceNameInputDisabled', 'createOrganizationControlVisible', 'createOrganizationControlDisabled', 'continueControlVisible', 'continueControlDisabled']) {
            const field = value[key];
            if (typeof field === 'boolean' || (typeof field === 'number' && field >= 100 && field <= 599)) {
              safe[key] = field;
            }
          }
          if (['verified', 'unverified', 'missing', 'other'].includes(value.primaryEmailVerificationStatus)) {
            safe.primaryEmailVerificationStatus = value.primaryEmailVerificationStatus;
          }
          if (Number.isInteger(value.organizationMembershipCount) && value.organizationMembershipCount >= 0 && value.organizationMembershipCount <= 20) {
            safe.organizationMembershipCount = value.organizationMembershipCount;
          }
          if (Array.isArray(value.errorCodes)) {
            safe.errorCodes = value.errorCodes.filter((v: unknown) => typeof v === 'string' && /^[\w.-]{1,80}$/u.test(v)).slice(0, 12);
          }
          this.events.push(safe);
        } catch { /* Raw payload discarded. */ }
      }
      const result = line.match(/^\[fresh-owner-result\] (.+)$/u);
      if (result) {
        try {
          const value = JSON.parse(result[1]!);
          const safe: Record<string, unknown> = { type: 'journey-result', project };
          for (const key of ['registrationCompleted', 'organizationCreated', 'emailVerified', 'invitationSetupCompleted', 'publishCompleted', 'customerBookingCreated', 'appointmentCompleted', 'ownSessionRevoked', 'productSignInRestored', 'persistedOwnerWorkResumed']) {
            safe[key] = value[key] === true;
          }
          safe.unauthenticatedStatus = value.unauthenticatedStatus === 401 ? 401 : null;
          this.events.push(safe);
        } catch { /* Raw payload discarded. */ }
      }
    }
  }

  onStdErr() { /* Never retain provider/browser raw errors. */ }
  onError() {
    this.events.push({ type: 'runner-error', rawErrorRetained: false });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const classifiedErrors = result.errors.slice(0, 4).map((error) => {
      // Inspect only in memory. Never retain messages, stacks, call logs or
      // arguments. Location is numeric and tied to the fixed spec filename.
      const message = typeof error.message === 'string' ? error.message : '';
      const errorClass = /timeout|timed out/iu.test(message)
        ? 'timeout'
        : /expect\(|assertion/iu.test(message)
          ? 'assertion'
          : /navigation|page\.goto|page\.reload/iu.test(message) ? 'navigation' : 'unclassified';
      let line: number | undefined;
      let column: number | undefined;
      if (error.location && /(?:^|[/\\])fresh-owner\.acceptance\.ts$/u.test(error.location.file)) {
        line = error.location.line;
        column = error.location.column;
      } else {
        const frame = error.stack?.match(/(?:^|[/\\])fresh-owner\.acceptance\.ts:(\d{1,6}):(\d{1,6})(?:[\s)]|$)/u);
        if (frame) {
          line = Number(frame[1]);
          column = Number(frame[2]);
        }
      }
      const knownLocation = Number.isInteger(line) && Number(line) > 0 && Number(line) <= 1_000_000
        && Number.isInteger(column) && Number(column) > 0 && Number(column) <= 1_000_000;
      return { errorClass, ...(knownLocation ? { specLine: line, specColumn: column } : {}) };
    });
    this.outcomes.push({ project: test.parent.project()?.name, status: result.status, durationMs: result.duration, errorCount: result.errors.length, classifiedErrors, rawErrorsRetained: false });
  }

  onEnd(result: FullResult) {
    writeFileSync(this.outputFile, JSON.stringify({ schemaVersion: 1, sourceSha: 'b81137ef8bdc55e58030abe109d2d468f6c85e54', status: result.status, outcomes: this.outcomes, events: this.events, rawPayloadsRetained: false, authStorageStateRetained: false }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    process.stdout.write(`[fresh-owner] overall=${result.status}\n`);
  }
}
