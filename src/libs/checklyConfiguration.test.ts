import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHECKLY_PRODUCTION_URL,
  isTrustedProductionDeployment,
  isValidDeploymentSha,
  resolveChecklyTarget,
} from './checklyTrust.mjs';

const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/checkly.yml'),
  'utf8',
);
const config = readFileSync(join(process.cwd(), 'checkly.config.ts'), 'utf8');
const deploymentGuard = readFileSync(
  join(process.cwd(), 'scripts/verify-checkly-deployment.mjs'),
  'utf8',
);
const depositCronHeartbeats = readFileSync(
  join(process.cwd(), 'checks/depositCronHeartbeats.check.ts'),
  'utf8',
);

function workflowStep(name: string): string {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing Checkly workflow step: ${name}`);
  }

  const nextStep = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

describe('Checkly deployment trust', () => {
  it('accepts only a successful Production deployment whose full SHA is on main', () => {
    const trusted = {
      state: 'success',
      environment: 'Production',
      sha: '0123456789abcdef0123456789abcdef01234567',
      isMainAncestor: true,
    };

    expect(isTrustedProductionDeployment(trusted)).toBe(true);
    expect(isTrustedProductionDeployment({ ...trusted, state: 'pending' })).toBe(false);
    expect(isTrustedProductionDeployment({ ...trusted, environment: 'Preview' })).toBe(false);
    expect(isTrustedProductionDeployment({ ...trusted, isMainAncestor: false })).toBe(false);
    expect(isTrustedProductionDeployment({ ...trusted, sha: 'refs/pull/42/head' })).toBe(false);

    expect(isTrustedProductionDeployment({ ...trusted, sha: '0123456' })).toBe(false);
  });

  it('requires the fixed HTTPS Production origin and rejects URL-controlled destinations', () => {
    expect(resolveChecklyTarget('Production', 'https://www.lustergel.app'))
      .toBe(CHECKLY_PRODUCTION_URL);
    expect(resolveChecklyTarget('Production', 'https://www.lustergel.app/'))
      .toBe(CHECKLY_PRODUCTION_URL);

    for (const untrusted of [
      'http://www.lustergel.app',
      'https://preview-123.lustergel.app',
      'https://attacker.vercel.app',
      'https://www.lustergel.app.attacker.test',
      'https://www.lustergel.app:8443',
      'https://user:pass@www.lustergel.app',
      'https://www.lustergel.app/path',
      'https://www.lustergel.app/?next=https://attacker.test',
      'https://www.lustergel.app/#fragment',
    ]) {
      expect(() => resolveChecklyTarget('Production', untrusted)).toThrow();
    }

    expect(() => resolveChecklyTarget('Preview', 'https://www.lustergel.app')).toThrow();
    expect(() => resolveChecklyTarget('Production', '')).toThrow();
  });

  it('requires a full hexadecimal commit id', () => {
    expect(isValidDeploymentSha('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(isValidDeploymentSha('0123456789ABCDEF0123456789ABCDEF01234567')).toBe(true);
    expect(isValidDeploymentSha('refs/heads/main')).toBe(false);
    expect(isValidDeploymentSha('0123456789abcdef')).toBe(false);
  });

  it('checks out trusted main and verifies the event SHA before installing dependencies', () => {
    expect(workflow).toContain('github.event.deployment_status.environment == \'Production\'');
    expect(workflow).toContain('ref: main');
    expect(workflow).not.toContain('deployment_status.deployment.ref');
    expect(workflow).toContain('node scripts/verify-checkly-deployment.mjs');
    expect(workflow.indexOf('Validate Production deployment identity'))
      .toBeLessThan(workflow.indexOf('Install dependencies'));
    expect(workflow).toContain('github.event.deployment.sha');
    expect(workflow).not.toContain('deployment_status.environment_url');
    expect(deploymentGuard).toContain('cat-file');
    expect(deploymentGuard).toContain('merge-base');
    expect(deploymentGuard).toContain('origin/main');
  });

  it('keeps Checkly and Vercel secrets out of job-wide and dependency-install environments', () => {
    const installStep = workflowStep('Install dependencies');
    const runChecksStep = workflowStep('Run checks');
    const deployStep = workflowStep('Deploy checks');

    expect(workflow.slice(0, workflow.indexOf('\njobs:'))).not.toContain('secrets.');
    expect(installStep).not.toContain('CHECKLY_API_KEY');
    expect(installStep).not.toContain('CHECKLY_ACCOUNT_ID');
    expect(runChecksStep).toContain('CHECKLY_API_KEY: $' + '{{ secrets.CHECKLY_API_KEY }}');
    expect(deployStep).toContain('CHECKLY_API_KEY: $' + '{{ secrets.CHECKLY_API_KEY }}');
    expect(workflow).not.toContain('VERCEL_BYPASS_TOKEN');
    expect(workflow).not.toContain('actions/cache');
    expect(workflow).toContain('node-version: 24.x');
  });

  it('uses the fixed Production target in Checkly config without a bypass header', () => {
    expect(config).toContain('resolveChecklyTarget(');
    expect(config).toContain('baseURL: targetURL');
    expect(config).not.toContain('x-vercel-protection-bypass');
    expect(config).not.toContain('VERCEL_BYPASS_TOKEN');
  });

  it('declares one five-minute heartbeat plus five-minute grace for each money cron', () => {
    expect(depositCronHeartbeats.match(/new HeartbeatCheck\(/g)).toHaveLength(2);
    expect(depositCronHeartbeats).toContain('\'deposit-reconcile-cron-heartbeat\'');
    expect(depositCronHeartbeats).toContain('\'integration-outbox-cron-heartbeat\'');
    expect(depositCronHeartbeats).toContain('period: 5');
    expect(depositCronHeartbeats).toContain('periodUnit: \'minutes\'');
    expect(depositCronHeartbeats).toContain('grace: 5');
    expect(depositCronHeartbeats).toContain('graceUnit: \'minutes\'');
    expect(depositCronHeartbeats).toContain('alertChannels: [emailChannel]');
  });

  it('shares the existing email failure-and-recovery escalation channel', () => {
    expect(config).toContain('new EmailAlertChannel(\'email-channel-1\'');
    expect(config).toContain('sendFailure: true');
    expect(config).toContain('sendRecovery: true');
    expect(config).toContain('process.env.CHECKLY_ALERT_EMAIL || \'support@lustergel.app\'');
  });
});
