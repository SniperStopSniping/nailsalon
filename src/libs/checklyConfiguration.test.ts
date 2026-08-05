import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PRODUCTION_URL = 'https://islanailsalon.com';
const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/checkly.yml'),
  'utf8',
);
const config = readFileSync(join(process.cwd(), 'checkly.config.ts'), 'utf8');

function workflowStep(name: string): string {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing Checkly workflow step: ${name}`);
  }

  const nextStep = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

describe('Checkly environment targets', () => {
  it('sets the public Production URL only on the Production deploy step', () => {
    const deployStep = workflowStep('Deploy checks');
    const runChecksStep = workflowStep('Run checks');
    const globalWorkflow = workflow.slice(0, workflow.indexOf('\njobs:'));

    expect(deployStep).toContain(
      `if: steps.run-checks.outcome == 'success' && github.event.deployment_status.environment == 'Production'`,
    );
    expect(deployStep).toContain(`ENVIRONMENT_URL: ${PRODUCTION_URL}`);
    expect(workflow.match(/https:\/\/islanailsalon\.com/g)).toHaveLength(1);
    expect(globalWorkflow).not.toContain('ENVIRONMENT_URL');
    expect(runChecksStep).toContain(
      ['ENVIRONMENT_URL: $', '{{ github.event.deployment_status.environment_url }}'].join(''),
    );
    expect(runChecksStep).not.toContain(PRODUCTION_URL);
  });

  it('keeps the Checkly config fail-closed without an explicit target', () => {
    expect(config).toContain(
      'const environmentURL = process.env.ENVIRONMENT_URL?.trim();',
    );
    expect(config).toContain('if (!environmentURL)');
    expect(config).toContain(
      'ENVIRONMENT_URL is required; Checkly never defaults to a Production target.',
    );
    expect(config).toContain('baseURL: parsedEnvironmentURL.toString()');
    expect(config).not.toContain(PRODUCTION_URL);
  });
});
