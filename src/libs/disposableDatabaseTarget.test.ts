import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import {
  assertDisposableDatabaseSession,
  DISPOSABLE_DATABASE_APPLICATION_NAME,
  DISPOSABLE_DATABASE_MARKER,
  DISPOSABLE_DATABASE_NAME,
  DISPOSABLE_DATABASE_PORT,
  DISPOSABLE_DATABASE_USER,
  type DisposableDatabaseSession,
  DisposableDatabaseTargetError,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from './disposableDatabaseTarget';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

type TargetOverrides = {
  applicationName?: string | null;
  databaseName?: string;
  host?: string;
  password?: string;
  port?: number;
  protocol?: string;
  querySuffix?: string;
  user?: string;
};

function targetUrl(overrides: TargetOverrides = {}) {
  const protocol = overrides.protocol ?? 'postgresql';
  const user = overrides.user ?? DISPOSABLE_DATABASE_USER;
  const password = overrides.password ?? 'ci-only-local-password';
  const host = overrides.host ?? '127.0.0.1';
  const port = overrides.port ?? DISPOSABLE_DATABASE_PORT;
  const databaseName = overrides.databaseName ?? DISPOSABLE_DATABASE_NAME;
  const applicationName = overrides.applicationName === undefined
    ? DISPOSABLE_DATABASE_APPLICATION_NAME
    : overrides.applicationName;
  const query = applicationName === null
    ? ''
    : `?application_name=${encodeURIComponent(applicationName)}`;

  return `${protocol}://${user}:${password}@${host}:${port}/${databaseName}${query}${overrides.querySuffix ?? ''}`;
}

function environment(databaseUrl = targetUrl()) {
  return {
    DATABASE_URL: databaseUrl,
    [DISPOSABLE_DATABASE_MARKER]: 'true',
  };
}

function expectRejection(
  candidate: Record<string, string | undefined>,
  code: DisposableDatabaseTargetError['code'],
) {
  try {
    requireDisposableDatabaseTarget(candidate);
  } catch (error) {
    expect(error).toBeInstanceOf(DisposableDatabaseTargetError);
    expect(error).toMatchObject({ code });

    return;
  }
  throw new Error('Expected disposable database target validation to fail.');
}

describe('disposable database target validation', () => {
  it('accepts the exact approved disposable configuration', () => {
    expect(requireDisposableDatabaseTarget(environment())).toMatchObject({
      applicationName: DISPOSABLE_DATABASE_APPLICATION_NAME,
      databaseName: DISPOSABLE_DATABASE_NAME,
      databaseUser: DISPOSABLE_DATABASE_USER,
      host: '127.0.0.1',
      port: DISPOSABLE_DATABASE_PORT,
      serviceContainer: null,
    });
  });

  it('accepts the explicitly approved localhost form', () => {
    expect(requireDisposableDatabaseTarget(
      environment(targetUrl({ host: 'localhost' })),
    ).host).toBe('localhost');
  });

  it('rejects an IPv6 URL form that node-postgres cannot connect to safely', () => {
    expectRejection(
      environment(targetUrl({ host: '[::1]' })),
      'LOOPBACK_FORM_UNSUPPORTED',
    );
  });

  it('rejects the wrong client port', () => {
    expectRejection(
      environment(targetUrl({ port: 5432 })),
      'PORT_WRONG',
    );
  });

  it('rejects a URL with no explicit password', () => {
    expectRejection(
      environment(targetUrl({ password: '' })),
      'PASSWORD_REQUIRED',
    );
  });

  it('rejects a Production Neon hostname', () => {
    expectRejection(
      environment(targetUrl({ host: 'ep-production-123.us-east-2.aws.neon.tech' })),
      'HOSTED_PROVIDER_FORBIDDEN',
    );
  });

  it('rejects a generic Neon hostname', () => {
    expectRejection(
      environment(targetUrl({ host: 'ep-example-123.eu-central-1.aws.neon.tech' })),
      'HOSTED_PROVIDER_FORBIDDEN',
    );
  });

  it('rejects an arbitrary remote hostname', () => {
    expectRejection(
      environment(targetUrl({ host: 'database.example.invalid' })),
      'REMOTE_HOST_FORBIDDEN',
    );
  });

  it('rejects a public IP address', () => {
    expectRejection(
      environment(targetUrl({ host: '8.8.8.8' })),
      'PUBLIC_REMOTE_IP_FORBIDDEN',
    );
  });

  it('rejects a private-network IP address', () => {
    expectRejection(
      environment(targetUrl({ host: '10.23.45.67' })),
      'PRIVATE_REMOTE_IP_FORBIDDEN',
    );
  });

  it('rejects a missing disposable marker', () => {
    expectRejection(
      { DATABASE_URL: targetUrl() },
      'MARKER_REQUIRED',
    );
  });

  it('rejects a false disposable marker', () => {
    expectRejection(
      { DATABASE_URL: targetUrl(), [DISPOSABLE_DATABASE_MARKER]: 'false' },
      'MARKER_REQUIRED',
    );
  });

  it('rejects the wrong database name', () => {
    expectRejection(
      environment(targetUrl({ databaseName: 'luster_e2e_ci_other' })),
      'DATABASE_WRONG',
    );
  });

  it('rejects the wrong database user', () => {
    expectRejection(
      environment(targetUrl({ user: 'luster_e2e_other' })),
      'USER_WRONG',
    );
  });

  it('rejects a missing application name', () => {
    expectRejection(
      environment(targetUrl({ applicationName: null })),
      'APPLICATION_MISSING',
    );
  });

  it('rejects the wrong application name', () => {
    expectRejection(
      environment(targetUrl({ applicationName: 'ordinary-test-run' })),
      'APPLICATION_WRONG',
    );
  });

  it('rejects a Production-like database name', () => {
    expectRejection(
      environment(targetUrl({ databaseName: 'luster_production' })),
      'DATABASE_PRODUCTION_LIKE',
    );
  });

  it('rejects a Production-like role name', () => {
    expectRejection(
      environment(targetUrl({ user: 'luster_prod' })),
      'USER_PRODUCTION_LIKE',
    );
  });

  it('rejects a malformed URL', () => {
    expectRejection(
      environment('this is not a database URL'),
      'MALFORMED_URL',
    );
  });

  it('rejects a non-PostgreSQL protocol', () => {
    expectRejection(
      environment(targetUrl({ protocol: 'mysql' })),
      'PROTOCOL_WRONG',
    );
  });

  it('rejects a URL containing no database', () => {
    const candidate
      = `postgresql://${DISPOSABLE_DATABASE_USER}:password@127.0.0.1:${DISPOSABLE_DATABASE_PORT}`
      + `?application_name=${DISPOSABLE_DATABASE_APPLICATION_NAME}`;
    expectRejection(environment(candidate), 'DATABASE_MISSING');
  });

  it('does not fall back to a differently named database variable', () => {
    expectRejection(
      {
        [DISPOSABLE_DATABASE_MARKER]: 'true',
        POSTGRES_URL: targetUrl(),
      },
      'URL_REQUIRED',
    );
  });

  it('rejects query parameters that could override node-postgres connection fields', () => {
    expectRejection(
      environment(targetUrl({ querySuffix: '&host=database.example.invalid' })),
      'UNEXPECTED_QUERY_PARAMETER',
    );
  });

  it('rejects duplicate application names', () => {
    expectRejection(
      environment(targetUrl({
        querySuffix: `&application_name=${DISPOSABLE_DATABASE_APPLICATION_NAME}`,
      })),
      'UNEXPECTED_QUERY_PARAMETER',
    );
  });

  it('rejects incomplete service-container evidence', () => {
    expectRejection(
      {
        ...environment(),
        LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID: 'a'.repeat(64),
      },
      'CONTAINER_EVIDENCE_INVALID',
    );
  });

  it('never includes credentials or sensitive URL data in errors', () => {
    const sensitivePassword = ['do-not', 'expose-this-password'].join('-');
    const sensitiveQuery = ['do-not', 'expose-this-query'].join('-');
    const candidate = targetUrl({
      host: 'database.example.invalid',
      password: sensitivePassword,
      querySuffix: `&token=${sensitiveQuery}`,
    });

    let message = '';
    try {
      requireDisposableDatabaseTarget(environment(candidate));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(candidate);
    expect(message).not.toContain(sensitivePassword);
    expect(message).not.toContain(sensitiveQuery);
    expect(message).not.toContain(DISPOSABLE_DATABASE_USER);
  });
});

describe('disposable PostgreSQL service-container attestation', () => {
  const mirroredImage = 'public.ecr.aws/docker/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
  const containerId = 'a'.repeat(64);
  const network = 'github_network_123';
  const target = requireDisposableDatabaseTarget({
    ...environment(),
    LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID: containerId,
    LUSTER_DISPOSABLE_POSTGRES_NETWORK: network,
  });
  const portMapping = JSON.stringify({
    '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55432' }],
  });
  const inspect = vi.mocked(execFileSync);

  beforeEach(() => {
    inspect.mockReset();
  });

  it.each(['postgres:16-alpine', mirroredImage])('attests the approved image %s', (image) => {
    inspect.mockReturnValueOnce(`${image}\n`)
      .mockReturnValueOnce(portMapping)
      .mockReturnValueOnce('172.18.0.2\n');

    expect(resolveDisposableDatabaseServerExpectation(target)).toEqual({
      addresses: ['172.18.0.2'],
      port: 5432,
    });
    expect(inspect.mock.calls.map(call => call[1])).toEqual([
      ['inspect', '--format', '{{.Config.Image}}', containerId],
      ['inspect', '--format', '{{json .NetworkSettings.Ports}}', containerId],
      ['inspect', '--format', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, containerId],
    ]);

    for (const call of inspect.mock.calls) {
      expect(call[0]).toBe('docker');
      expect(call[2]).toEqual({ encoding: 'utf8', timeout: 10_000 });
    }
  });

  it('attests every PostgreSQL image configured in the actual CI workflow', () => {
    const workflow = parse(readFileSync(new URL('../../.github/workflows/CI.yml', import.meta.url), 'utf8')) as {
      jobs: Record<string, { services?: { postgres?: { image: string } } }>;
    };
    const images = new Set(Object.values(workflow.jobs)
      .flatMap(job => job.services?.postgres ? [job.services.postgres.image] : []));

    expect(images.size).toBeGreaterThan(0);

    for (const image of images) {
      inspect.mockReturnValueOnce(image).mockReturnValueOnce(portMapping).mockReturnValueOnce('172.18.0.2');

      expect(resolveDisposableDatabaseServerExpectation(target)).toEqual({
        addresses: ['172.18.0.2'],
        port: 5432,
      });
    }

    expect(inspect).toHaveBeenCalledTimes(images.size * 3);
  });

  it.each([
    'postgres:latest',
    'postgres:17-alpine',
    'public.ecr.aws/docker/library/postgres:16-alpine',
    `public.ecr.aws/docker/library/postgres:16-alpine@sha256:${'0'.repeat(64)}`,
    mirroredImage.replace('docker/library', 'unreviewed/library'),
    mirroredImage.replace('public.ecr.aws/', 'public.ecr.aws.example.invalid/'),
    mirroredImage.replace('postgres:16-alpine', 'redis:7-alpine'),
  ])('rejects an unreviewed image before inspecting its network: %s', (image) => {
    inspect.mockReturnValueOnce(image);

    expect(() => resolveDisposableDatabaseServerExpectation(target))
      .toThrow(DisposableDatabaseTargetError);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { '5432/tcp': null },
    { '5432/tcp': [] },
    { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] },
    { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] },
    { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55432' }, { HostIp: '::', HostPort: '55432' }] },
  ])('still rejects unsafe port bindings for the mirrored image: %j', (ports) => {
    inspect.mockReturnValueOnce(mirroredImage).mockReturnValueOnce(JSON.stringify(ports));

    expect(() => resolveDisposableDatabaseServerExpectation(target))
      .toThrow(DisposableDatabaseTargetError);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it.each(['', '<no value>', 'database.example.invalid', '8.8.8.8'])('still rejects an invalid bridge address: %s', (address) => {
    inspect.mockReturnValueOnce(mirroredImage).mockReturnValueOnce(portMapping).mockReturnValueOnce(address);

    expect(() => resolveDisposableDatabaseServerExpectation(target))
      .toThrow(DisposableDatabaseTargetError);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1, 2])('fails closed when Docker inspection fails at stage %s', (stage) => {
    for (const value of [mirroredImage, portMapping].slice(0, stage)) {
      inspect.mockReturnValueOnce(value);
    }
    inspect.mockImplementationOnce(() => {
      throw new Error('Docker unavailable');
    });

    expect(() => resolveDisposableDatabaseServerExpectation(target))
      .toThrow(DisposableDatabaseTargetError);
    expect(inspect).toHaveBeenCalledTimes(stage + 1);
  });

  it('fails closed on malformed port metadata', () => {
    inspect.mockReturnValueOnce(mirroredImage).mockReturnValueOnce('not JSON');

    expect(() => resolveDisposableDatabaseServerExpectation(target))
      .toThrow(DisposableDatabaseTargetError);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});

describe('live disposable database session comparison', () => {
  const target = requireDisposableDatabaseTarget(environment());
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const approvedSession: DisposableDatabaseSession = {
    applicationName: DISPOSABLE_DATABASE_APPLICATION_NAME,
    databaseName: DISPOSABLE_DATABASE_NAME,
    databaseUser: DISPOSABLE_DATABASE_USER,
    serverAddress: '127.0.0.1',
    serverPort: DISPOSABLE_DATABASE_PORT,
  };

  it('accepts the exact live session identity', () => {
    expect(() => {
      assertDisposableDatabaseSession(target, expectedServer, approvedSession);
    }).not.toThrow();
  });

  it.each([
    [
      'database',
      { databaseName: 'luster_other' },
      'LIVE_DATABASE_MISMATCH',
    ],
    [
      'user',
      { databaseUser: 'luster_other' },
      'LIVE_USER_MISMATCH',
    ],
    [
      'server address',
      { serverAddress: '10.23.45.67' },
      'LIVE_SERVER_ADDRESS_MISMATCH',
    ],
    [
      'server port',
      { serverPort: 6543 },
      'LIVE_SERVER_PORT_MISMATCH',
    ],
    [
      'application name',
      { applicationName: 'other-application' },
      'LIVE_APPLICATION_MISMATCH',
    ],
  ] as const)(
    'rejects a live %s mismatch',
    (_label, override, code) => {
      try {
        assertDisposableDatabaseSession(
          target,
          expectedServer,
          { ...approvedSession, ...override },
        );
      } catch (error) {
        expect(error).toBeInstanceOf(DisposableDatabaseTargetError);
        expect(error).toMatchObject({ code });

        return;
      }
      throw new Error('Expected live disposable session validation to fail.');
    },
  );
});
