import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  LUSTER_DEFAULT_SENDER_IDENTITY,
  readSharedSenderEnvConfig,
  resolveByoSenderReadiness,
  resolveSharedSenderReadiness,
  resolveSmsSenderMode,
} = await import('./smsSender');

const activeByoConnection = {
  status: 'active',
  connectAccountSid: 'AC00000000000000000000000000000000',
  messagingServiceSid: 'MG00000000000000000000000000000000',
  phoneNumber: '+14165550000',
};

const fullyConfiguredShared = {
  communicationsSmsEnabled: true,
  messagingServiceSid: 'MG11111111111111111111111111111111',
  accountSidPresent: true,
  authTokenPresent: true,
  senderIdentity: LUSTER_DEFAULT_SENDER_IDENTITY,
  pilot: { enabled: false, allowlist: [] as string[] },
  platformControl: { smsEnabled: true },
  creditReservation: { available: true as const },
};

describe('resolveSmsSenderMode — mode first, from salon state alone', () => {
  it('resolves the exhaustive mode table', () => {
    const cases = [
      { connection: null, perSalonDisabled: false, expected: 'shared_luster' },
      { connection: null, perSalonDisabled: true, expected: 'disabled' },
      { connection: activeByoConnection, perSalonDisabled: false, expected: 'connected_byo' },
      { connection: activeByoConnection, perSalonDisabled: true, expected: 'disabled' },
      { connection: { ...activeByoConnection, status: 'pending' }, perSalonDisabled: false, expected: 'shared_luster' },
      { connection: { ...activeByoConnection, status: 'deauthorized' }, perSalonDisabled: false, expected: 'shared_luster' },
      { connection: { ...activeByoConnection, messagingServiceSid: null }, perSalonDisabled: false, expected: 'connected_byo' },
      { connection: { ...activeByoConnection, phoneNumber: null }, perSalonDisabled: false, expected: 'connected_byo' },
      { connection: { ...activeByoConnection, messagingServiceSid: null, phoneNumber: null }, perSalonDisabled: false, expected: 'shared_luster' },
    ] as const;
    for (const testCase of cases) {
      expect(resolveSmsSenderMode(testCase)).toBe(testCase.expected);
    }
  });

  it('keeps a phone-only active BYO connection on connected_byo (live-behavior continuity reading of §9.4)', () => {
    const phoneOnly = { ...activeByoConnection, messagingServiceSid: null };

    expect(resolveSmsSenderMode({ connection: phoneOnly, perSalonDisabled: false })).toBe('connected_byo');
  });
});

describe('resolveByoSenderReadiness — continuity, never fall-through', () => {
  it('validates BYO from the connection row and auth-token presence alone', () => {
    const resolution = resolveByoSenderReadiness(activeByoConnection, { authTokenPresent: true });

    expect(resolution).toMatchObject({ ready: true, mode: 'connected_byo' });
  });

  it('a missing auth token makes BYO unavailable IN PLACE — it never becomes shared_luster', () => {
    const resolution = resolveByoSenderReadiness(activeByoConnection, { authTokenPresent: false });

    expect(resolution).toEqual({ ready: false, mode: 'connected_byo', reason: 'SENDER_NOT_READY' });
  });
});

describe('resolveSharedSenderReadiness — structurally dark by default', () => {
  it('is disabled when COMMUNICATIONS_SMS_ENABLED is not true, regardless of everything else', () => {
    const resolution = resolveSharedSenderReadiness({
      salonSlug: 'isla-nail-studio',
      config: { ...fullyConfiguredShared, communicationsSmsEnabled: false },
    });

    expect(resolution).toEqual({ ready: false, mode: 'shared_luster', reason: 'GLOBAL_SMS_DISABLED' });
  });

  it('full env configuration alone is STILL not enough — an absent platform control fails closed', () => {
    const resolution = resolveSharedSenderReadiness({
      salonSlug: 'isla-nail-studio',
      config: { ...fullyConfiguredShared, platformControl: null },
    });

    expect(resolution).toEqual({ ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' });
  });

  it('an absent credit-reservation capability fails closed the same way', () => {
    const resolution = resolveSharedSenderReadiness({
      salonSlug: 'isla-nail-studio',
      config: { ...fullyConfiguredShared, creditReservation: null },
    });

    expect(resolution).toEqual({ ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' });
  });

  it('pilot mode with an EMPTY allowlist means nobody, never everybody', () => {
    const resolution = resolveSharedSenderReadiness({
      salonSlug: 'isla-nail-studio',
      config: { ...fullyConfiguredShared, pilot: { enabled: true, allowlist: [] } },
    });

    expect(resolution).toEqual({ ready: false, mode: 'shared_luster', reason: 'PLAN_NOT_ELIGIBLE' });
  });

  it('pilot mode admits only allowlisted slugs', () => {
    const config = { ...fullyConfiguredShared, pilot: { enabled: true, allowlist: ['isla-nail-studio'] } };

    expect(resolveSharedSenderReadiness({ salonSlug: 'isla-nail-studio', config }).ready).toBe(true);
    expect(resolveSharedSenderReadiness({ salonSlug: 'other-salon', config })).toEqual({
      ready: false,
      mode: 'shared_luster',
      reason: 'PLAN_NOT_ELIGIBLE',
    });
  });

  it('missing shared provider configuration is SENDER_NOT_READY', () => {
    for (const broken of [
      { messagingServiceSid: null },
      { messagingServiceSid: '' },
      { accountSidPresent: false },
      { authTokenPresent: false },
    ]) {
      const resolution = resolveSharedSenderReadiness({
        salonSlug: 'isla-nail-studio',
        config: { ...fullyConfiguredShared, ...broken },
      });

      expect(resolution).toEqual({ ready: false, mode: 'shared_luster', reason: 'SENDER_NOT_READY' });
    }
  });

  it('a fully authorized shared resolution carries the Messaging Service and identity — and NO phone number', () => {
    const resolution = resolveSharedSenderReadiness({
      salonSlug: 'isla-nail-studio',
      config: fullyConfiguredShared,
    });

    expect(resolution).toEqual({
      ready: true,
      mode: 'shared_luster',
      messagingServiceSid: 'MG11111111111111111111111111111111',
      senderIdentity: 'luster_shared_v1',
    });
    expect(Object.keys(resolution)).not.toContain('phoneNumber');
  });

  it('pins the default sender identity — changing it orphans every global opt-out', () => {
    expect(LUSTER_DEFAULT_SENDER_IDENTITY).toBe('luster_shared_v1');
  });
});

describe('readSharedSenderEnvConfig — the env seam', () => {
  const baseEnv = {
    COMMUNICATIONS_SMS_ENABLED: undefined,
    TWILIO_MESSAGING_SERVICE_SID: undefined,
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    LUSTER_SMS_SENDER_IDENTITY: undefined,
    SMS_PILOT_ENABLED: undefined,
    SMS_PILOT_SALON_ALLOWLIST: undefined,
  };

  it('treats an EMPTY-STRING sender identity as unset — never orphan the opt-out namespace', () => {
    expect(readSharedSenderEnvConfig({ ...baseEnv, LUSTER_SMS_SENDER_IDENTITY: '' }).senderIdentity)
      .toBe(LUSTER_DEFAULT_SENDER_IDENTITY);
    expect(readSharedSenderEnvConfig({ ...baseEnv, LUSTER_SMS_SENDER_IDENTITY: 'custom_v2' }).senderIdentity)
      .toBe('custom_v2');
  });

  it('normalizes an empty Messaging Service SID to null', () => {
    expect(readSharedSenderEnvConfig({ ...baseEnv, TWILIO_MESSAGING_SERVICE_SID: '' }).messagingServiceSid)
      .toBeNull();
  });

  it('only the literal lowercase true enables anything', () => {
    for (const hostile of ['TRUE', 'True', '1', 'yes', '']) {
      const config = readSharedSenderEnvConfig({
        ...baseEnv,
        COMMUNICATIONS_SMS_ENABLED: hostile as never,
        SMS_PILOT_ENABLED: hostile as never,
      });

      expect(config.communicationsSmsEnabled).toBe(false);
      expect(config.pilot.enabled).toBe(false);
    }
  });

  it('parses the allowlist with trimming and empty-entry removal', () => {
    const config = readSharedSenderEnvConfig({
      ...baseEnv,
      SMS_PILOT_SALON_ALLOWLIST: ' isla-nail-studio , second-salon ,, ',
    });

    expect(config.pilot.allowlist).toEqual(['isla-nail-studio', 'second-salon']);
  });
});

describe('BYO readiness defends its own invariant', () => {
  it('a connection with neither Messaging Service nor phone number is not ready — even called directly', () => {
    const bare = { ...activeByoConnection, messagingServiceSid: null, phoneNumber: null };

    expect(resolveByoSenderReadiness(bare, { authTokenPresent: true }))
      .toEqual({ ready: false, mode: 'connected_byo', reason: 'SENDER_NOT_READY' });
  });
});

describe('smsSender source hygiene (mechanical dark-by-default proof)', () => {
  const source = readFileSync(new URL('./smsSender.ts', import.meta.url), 'utf8');

  it('imports no provider SDK and no database — this module cannot originate a message', () => {
    expect(source).not.toMatch(/from 'twilio'|require\('twilio'\)/);
    expect(source).not.toMatch(/@\/libs\/DB/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it('consults neither freeSoloEnabled nor the deprecated legacy entitlement chain', () => {
    expect(source).not.toContain('freeSoloEnabled');
    expect(source).not.toMatch(/@\/libs\/salonStatus|@\/libs\/featureGating|@\/libs\/featureEntitlements/);
  });

  it('does not read the BYO onboarding flag — continuity and onboarding are separate permissions', () => {
    expect(source).not.toContain('SMS_BYO_MODE_ENABLED');
  });

  it('is imported by NOTHING in src outside its own test — dark-by-deploy is mechanical, not incidental', async () => {
    const { execFileSync } = await import('node:child_process');
    const grep = (() => {
      try {
        return execFileSync(
          'grep',
          ['-rl', 'from \'@/libs/smsSender\'', 'src', '--include=*.ts', '--include=*.tsx'],
          { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
        );
      } catch {
        return '';
      }
    })();
    const importers = grep.split('\n').filter(line => line.length > 0).sort();

    // Gate B wires the resolver into the (dark, CRON_SECRET-gated, provider-
    // stubbed) dispatcher. Any importer beyond this reviewed list re-fails.
    expect(importers).toEqual(['src/libs/communicationDispatcher.ts']);
  });
});
