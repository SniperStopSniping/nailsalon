export const CHECKLY_PRODUCTION_URL = 'https://www.lustergel.app/';

const SHA_PATTERN = /^[a-f0-9]{40}$/i;

/** @param {unknown} value */
export function isValidDeploymentSha(value) {
  return typeof value === 'string' && SHA_PATTERN.test(value);
}

/**
 * @param {{ state: unknown, environment: unknown, sha: unknown, isMainAncestor: unknown }} deployment
 */
export function isTrustedProductionDeployment({
  state,
  environment,
  sha,
  isMainAncestor,
}) {
  return state === 'success'
    && environment === 'Production'
    && isValidDeploymentSha(sha)
    && isMainAncestor === true;
}

/**
 * @param {unknown} environment
 * @param {unknown} environmentURL
 */
export function resolveChecklyTarget(environment, environmentURL) {
  if (environment !== 'Production') {
    throw new Error('Checkly credentials are restricted to Production.');
  }

  if (typeof environmentURL !== 'string' || !environmentURL.trim()) {
    throw new Error('ENVIRONMENT_URL is required for Production checks.');
  }

  let target;
  try {
    target = new URL(environmentURL.trim());
  } catch {
    throw new Error('ENVIRONMENT_URL must be the approved HTTPS Production origin.');
  }

  if (
    target.protocol !== 'https:'
    || target.hostname !== 'www.lustergel.app'
    || target.port !== ''
    || target.username !== ''
    || target.password !== ''
    || target.pathname !== '/'
    || target.search !== ''
    || target.hash !== ''
  ) {
    throw new Error('ENVIRONMENT_URL must be the approved HTTPS Production origin.');
  }

  return CHECKLY_PRODUCTION_URL;
}
