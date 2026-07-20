/**
 * Approved outbound links for the internal Luster area.
 *
 * Every Luster link in the owner dashboard must resolve to the real brand
 * domain (lusterstudio.ca) on one of the approved paths below. The list is
 * hardcoded on purpose: an env-var override could silently reintroduce the old
 * luster.com domain, and the allowlist is what makes that provable in tests.
 *
 * Unrelated: LUSTER_ROOT_DOMAIN / TENANT_SUBDOMAIN_ALLOWLIST in `tenantSlug.ts`
 * govern tenant subdomains, not outbound links. Do not merge the two.
 */

export const LUSTER_ORIGIN = 'https://lusterstudio.ca';

export const LUSTER_PATHS = [
  '/promotions',
  '/shop',
  '/wholesale',
  '/join',
  '/learn',
  '/learn/builder-gel-foundations',
  '/learn/nail-preparation-and-retention',
  '/learn/choosing-flex-vs-control-builder',
  '/learn/builder-gel-application',
  '/learn/apex-and-structure',
  '/learn/rebalancing-and-fill-maintenance',
  '/learn/safe-product-removal',
  '/learn/troubleshooting-lifting',
  '/learn/troubleshooting-heat-spikes',
  '/learn/product-storage-and-handling',
] as const;

export type LusterPath = (typeof LUSTER_PATHS)[number];

const APPROVED_PATHS: ReadonlySet<string> = new Set(LUSTER_PATHS);

// Attribution for owner-dashboard traffic, unchanged from the previous links.
const LUSTER_UTM = 'utm_source=luster_booking&utm_medium=owner_dashboard&utm_campaign=free_booking';

export function buildLusterUrl(path: LusterPath): string {
  return `${LUSTER_ORIGIN}${path}?${LUSTER_UTM}`;
}

/**
 * True only for https links on the exact lusterstudio.ca origin using an
 * approved path. Compares `origin` rather than matching the end of the host so
 * lookalikes such as `lusterstudio.ca.example.com` are rejected.
 */
export function isApprovedLusterUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === 'https:'
    && parsed.origin === LUSTER_ORIGIN
    && APPROVED_PATHS.has(parsed.pathname)
  );
}
