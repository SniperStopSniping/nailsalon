import { defineConfig } from 'checkly';
import { EmailAlertChannel, Frequency } from 'checkly/constructs';

const sendDefaults = {
  sendFailure: true,
  sendRecovery: true,
  sendDegraded: true,
};

const environmentURL = process.env.ENVIRONMENT_URL?.trim();
if (!environmentURL) {
  throw new Error(
    'ENVIRONMENT_URL is required; Checkly never defaults to a Production target.',
  );
}

let parsedEnvironmentURL: URL;
try {
  parsedEnvironmentURL = new URL(environmentURL);
} catch {
  throw new Error('ENVIRONMENT_URL must be a valid HTTP(S) URL.');
}
if (
  parsedEnvironmentURL.protocol !== 'http:'
  && parsedEnvironmentURL.protocol !== 'https:'
) {
  throw new Error('ENVIRONMENT_URL must be a valid HTTP(S) URL.');
}
if (
  parsedEnvironmentURL.username
  || parsedEnvironmentURL.password
  || parsedEnvironmentURL.hash
) {
  throw new Error('ENVIRONMENT_URL must not contain credentials or a fragment.');
}

export const emailChannel = new EmailAlertChannel('email-channel-1', {
  address: process.env.CHECKLY_ALERT_EMAIL || 'support@islanailsalon.com',
  ...sendDefaults,
});

export const config = defineConfig({
  projectName: 'Luster Free Booking',
  logicalId: 'luster-free-booking',
  repoUrl: 'https://github.com/SniperStopSniping/nailsalon',
  checks: {
    locations: ['us-east-1', 'eu-west-1'],
    tags: ['website'],
    runtimeId: '2024.02',
    browserChecks: {
      frequency: Frequency.EVERY_10M,
      testMatch: '**/tests/e2e/**/*.check.e2e.ts',
      alertChannels: [emailChannel],
    },
    playwrightConfig: {
      use: {
        baseURL: parsedEnvironmentURL.toString(),
        extraHTTPHeaders: {
          'x-vercel-protection-bypass': process.env.VERCEL_BYPASS_TOKEN,
        },
      },
    },
  },
  cli: {
    runLocation: 'eu-west-1',
    reporters: ['list'],
  },
});

export default config;
