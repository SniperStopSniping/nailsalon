const PRODUCTION_E2E_HOSTS = new Set([
  'islanailsalon.com',
  'www.islanailsalon.com',
]);
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BLOCKLIST_ERROR
  = 'LUSTER_E2E_BLOCKED_HOSTS must be a comma-separated list of exact hostnames.';

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function isExactHostname(hostname: string) {
  if (!hostname || hostname.length > 253) {
    return false;
  }

  const labels = hostname.split('.');
  if (!labels.every(label => HOSTNAME_LABEL.test(label))) {
    return false;
  }

  try {
    return normalizeHostname(new URL(`https://${hostname}`).hostname) === hostname;
  } catch {
    return false;
  }
}

function productionE2EHosts(configuredHosts: string | undefined) {
  const hosts = new Set(PRODUCTION_E2E_HOSTS);
  if (configuredHosts === undefined) {
    return hosts;
  }

  for (const entry of configuredHosts.split(',')) {
    const hostname = normalizeHostname(entry.trim());
    if (!isExactHostname(hostname)) {
      throw new Error(BLOCKLIST_ERROR);
    }
    hosts.add(hostname);
  }

  return hosts;
}

export function assertAllowedE2ETarget(
  baseUrl: string | undefined,
  allowProduction: string | undefined,
  configuredBlockedHosts: string | undefined = undefined,
) {
  const blockedHosts = productionE2EHosts(configuredBlockedHosts);
  const candidate = baseUrl?.trim();
  if (!candidate) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('E2E_BASE_URL must be a valid HTTP(S) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('E2E_BASE_URL must be a valid HTTP(S) URL.');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (
    blockedHosts.has(hostname)
    && allowProduction !== '1'
  ) {
    throw new Error(
      `Production E2E target rejected: hostname "${hostname}" is blocked. Set E2E_ALLOW_PRODUCTION=1 only for a separately owner-authorized run.`,
    );
  }
}
