import { X509Certificate } from 'node:crypto';
import { rootCertificates, TLSSocket } from 'node:tls';

import type { Client } from 'pg';

export const PREVIEW_FIXTURE_TLS_ATTESTATIONS = {
  backendVisible: 'client TLS verified; backend TLS visible',
  backendTerminatedUpstream: 'client TLS verified; backend TLS visibility unavailable/terminated upstream',
} as const;

export type PreviewFixtureTlsAttestation = typeof PREVIEW_FIXTURE_TLS_ATTESTATIONS[keyof typeof PREVIEW_FIXTURE_TLS_ATTESTATIONS];
export type PreviewFixtureTlsEvidence = Readonly<{
  transportKind: 'node-tls-socket' | 'unsupported';
  connected: boolean;
  encrypted: boolean;
  authorized: boolean;
  authorizationErrorPresent: boolean;
  peerCertificatePresent: boolean;
  peerIdentityVerified: boolean;
  protocol: 'TLSv1.2' | 'TLSv1.3' | 'unsupported';
  cipherPresent: boolean;
  handshakeFinished: boolean;
  peerHandshakeFinished: boolean;
  secureClientConfiguration: boolean;
  insecureEnvironment: boolean;
  backendTls: true | false | null | 'invalid';
}>;

type NodePostgresCompatibilityView = {
  connection?: { ssl?: unknown; stream?: unknown };
  ssl?: unknown;
};

type PreviewFixtureTlsClientConfiguration = Readonly<{
  ca: string[];
  minVersion: 'TLSv1.2';
  rejectUnauthorized: true;
  servername: string;
}>;

export type PreviewFixtureTlsBoundary = Readonly<{
  clientConfiguration: PreviewFixtureTlsClientConfiguration;
  attest: (client: Client, backendTls: unknown) => PreviewFixtureTlsAttestation | null;
}>;

const SSL_OPTION_KEYS = ['ca', 'minVersion', 'rejectUnauthorized', 'servername'];
const EXTERNAL_CA_ENVIRONMENT_KEYS = ['NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'OPENSSL_CONF', 'SSL_CERT_DIR', 'SSL_CERT_FILE'];
const NODE_CA_OPTION = /--(?:no-)?(?:openssl-(?:config|shared-config)|use-(?:bundled|openssl|system)-ca)(?=$|[='"\s\\])/;
const BUNDLED_CA: string[] = [...rootCertificates];
Object.freeze(BUNDLED_CA);
const trustedClientConfigurations = new WeakSet<object>();
const tlsGetCipher = TLSSocket.prototype.getCipher;
const tlsGetFinished = TLSSocket.prototype.getFinished;
const tlsGetPeerFinished = TLSSocket.prototype.getPeerFinished;
const tlsGetPeerX509Certificate = TLSSocket.prototype.getPeerX509Certificate;
const tlsGetProtocol = TLSSocket.prototype.getProtocol;
const x509CheckHost = X509Certificate.prototype.checkHost;

function createPreviewFixtureTlsClientConfiguration(expectedHost: string): PreviewFixtureTlsClientConfiguration {
  const configuration: PreviewFixtureTlsClientConfiguration = Object.freeze({
    ca: BUNDLED_CA,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    servername: expectedHost,
  });
  trustedClientConfigurations.add(configuration);
  return configuration;
}

export function isPreviewFixtureTlsRuntimeEnvironmentSafe(environment: Record<string, string | undefined>): boolean {
  try {
    const nodeOptions = (environment.NODE_OPTIONS ?? '').replace(/["\\]/g, '');
    const processArguments = process.execArgv.join(' ').replace(/["\\]/g, '');
    return environment.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
      && EXTERNAL_CA_ENVIRONMENT_KEYS.every(key => !environment[key]?.trim())
      && !NODE_CA_OPTION.test(nodeOptions)
      && !NODE_CA_OPTION.test(processArguments);
  } catch {
    return false;
  }
}

function isExactSecureClientConfiguration(value: unknown, expectedHost: string): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.length === SSL_OPTION_KEYS.length
    && keys.every(key => typeof key === 'string' && SSL_OPTION_KEYS.includes(key))
    && SSL_OPTION_KEYS.every(key => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]!)
    && descriptors.ca?.value === BUNDLED_CA
    && descriptors.rejectUnauthorized?.value === true
    && descriptors.servername?.value === expectedHost
    && descriptors.minVersion?.value === 'TLSv1.2'
    && trustedClientConfigurations.has(value);
}

function normalizeBackendTls(value: unknown): PreviewFixtureTlsEvidence['backendTls'] {
  if (value === true || value === false) {
    return value;
  }
  if (value == null) {
    return null;
  }
  return 'invalid';
}

function evaluatePreviewFixtureTlsEvidence(evidence: Partial<PreviewFixtureTlsEvidence> | null | undefined): PreviewFixtureTlsAttestation | null {
  if (!evidence
    || evidence.transportKind !== 'node-tls-socket'
    || evidence.connected !== true
    || evidence.encrypted !== true
    || evidence.authorized !== true
    || evidence.authorizationErrorPresent !== false
    || evidence.peerCertificatePresent !== true
    || evidence.peerIdentityVerified !== true
    || (evidence.protocol !== 'TLSv1.2' && evidence.protocol !== 'TLSv1.3')
    || evidence.cipherPresent !== true
    || evidence.handshakeFinished !== true
    || evidence.peerHandshakeFinished !== true
    || evidence.secureClientConfiguration !== true
    || evidence.insecureEnvironment !== false) {
    return null;
  }
  if (evidence.backendTls === true) {
    return PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendVisible;
  }
  if (evidence.backendTls === false || evidence.backendTls === null) {
    return PREVIEW_FIXTURE_TLS_ATTESTATIONS.backendTerminatedUpstream;
  }
  return null;
}

function attestPreviewFixtureClientTls(
  client: Client,
  expectedHost: string,
  expectedConfiguration: PreviewFixtureTlsClientConfiguration,
  backendTls: unknown,
): PreviewFixtureTlsAttestation | null {
  try {
    // pg 8.13.0 exposes the upgraded socket only through this private boundary.
    // Shape drift on a future pg/Node upgrade must fail closed and be re-audited.
    const compatibility = client as unknown as NodePostgresCompatibilityView;
    const connection = Reflect.get(compatibility, 'connection');
    const stream = connection && (typeof connection === 'object' || typeof connection === 'function')
      ? Reflect.get(connection, 'stream')
      : undefined;
    const clientSsl = Reflect.get(compatibility, 'ssl');
    const connectionSsl = connection && (typeof connection === 'object' || typeof connection === 'function')
      ? Reflect.get(connection, 'ssl')
      : undefined;
    const secureClientConfiguration = clientSsl === connectionSsl
      && clientSsl === expectedConfiguration
      && isExactSecureClientConfiguration(clientSsl, expectedHost);
    if (!(stream instanceof TLSSocket)) {
      return null;
    }
    const protocol = tlsGetProtocol.call(stream);
    const cipher = tlsGetCipher.call(stream);
    const certificate = tlsGetPeerX509Certificate.call(stream);
    const finished = tlsGetFinished.call(stream);
    const peerFinished = tlsGetPeerFinished.call(stream);
    const peerIdentityVerified = certificate instanceof X509Certificate
      && typeof x509CheckHost.call(certificate, expectedHost) === 'string';
    return evaluatePreviewFixtureTlsEvidence({
      transportKind: 'node-tls-socket',
      connected: stream.connecting === false && stream.destroyed === false && stream.readyState === 'open' && stream.readable === true && stream.writable === true,
      encrypted: stream.encrypted === true,
      authorized: stream.authorized === true,
      authorizationErrorPresent: stream.authorizationError != null,
      peerCertificatePresent: certificate instanceof X509Certificate,
      peerIdentityVerified,
      protocol: protocol === 'TLSv1.2' || protocol === 'TLSv1.3' ? protocol : 'unsupported',
      cipherPresent: typeof cipher?.name === 'string' && cipher.name.length > 0,
      handshakeFinished: Buffer.isBuffer(finished) && finished.length > 0,
      peerHandshakeFinished: Buffer.isBuffer(peerFinished) && peerFinished.length > 0,
      secureClientConfiguration,
      insecureEnvironment: !isPreviewFixtureTlsRuntimeEnvironmentSafe(process.env),
      backendTls: normalizeBackendTls(backendTls),
    });
  } catch {
    return null;
  }
}

export function createPreviewFixtureTlsBoundary(expectedHost: string): PreviewFixtureTlsBoundary {
  const clientConfiguration = createPreviewFixtureTlsClientConfiguration(expectedHost);

  return Object.freeze({
    clientConfiguration,
    attest: (client: Client, backendTls: unknown) => attestPreviewFixtureClientTls(
      client,
      expectedHost,
      clientConfiguration,
      backendTls,
    ),
  });
}

// The pure evaluator is non-authoritative and absent from normal runtime exports.
// Production acceptance is available only through the bound Client adapter above.
export const PREVIEW_FIXTURE_TLS_TEST_ONLY = process.env.NODE_ENV === 'test'
  ? Object.freeze({ evaluateEvidence: evaluatePreviewFixtureTlsEvidence })
  : null;
