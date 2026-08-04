const PRODUCTION_E2E_HOSTS = new Set([
  'islanailsalon.com',
  'www.islanailsalon.com',
]);

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function assertAllowedE2ETarget(
  baseUrl: string | undefined,
  allowProduction: string | undefined,
) {
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

  if (
    PRODUCTION_E2E_HOSTS.has(normalizeHostname(parsed.hostname))
    && allowProduction !== '1'
  ) {
    throw new Error(
      'Production E2E target rejected. Set E2E_ALLOW_PRODUCTION=1 only for a separately owner-authorized run.',
    );
  }
}
