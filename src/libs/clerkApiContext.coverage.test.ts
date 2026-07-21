/**
 * Structural guard: every API route that authenticates an owner MUST be
 * matched by apiPathNeedsClerkContext, or `src/middleware.ts` never wraps it
 * in clerkMiddleware, Clerk's auth() throws inside getAdminSession, and the
 * owner silently resolves to "no admin session" — a 401 that most callers
 * render as an empty list rather than an error.
 *
 * This is the test that was missing. The hand-maintained prefix list drifted
 * twice: /api/appointments (4c0b941) and then the /api/salon subtree beyond
 * services, which left Isla's owner staring at "0 add-ons" while 33 add-ons
 * sat healthy in the database. Rather than listing paths by hand again, walk
 * the route tree and derive the requirement from the code itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { apiPathNeedsClerkContext } from './clerkApiContext';

const API_ROOT = path.join(process.cwd(), 'src/app/api');

/**
 * Guards that resolve the caller through getAdminSession → Clerk auth().
 * routeAccessGuards' wrappers are included because they fall back to the
 * admin session (see src/libs/routeAccessGuards.ts).
 */
const ADMIN_GUARDS = [
  'requireAdmin',
  'requireAdminSalon',
  'requireActiveAdminSalon',
  'requireStaffOrAdminSalonAccess',
  'requireAppointmentManagerAccess',
  'requireAppointmentAccess',
];

/**
 * `/api/super-admin` gets its Clerk context from a dedicated branch in
 * src/middleware.ts, not from CLERK_CONTEXT_API_PREFIXES.
 */
const EXEMPT_PREFIXES = ['/api/super-admin'];

function findRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findRouteFiles(full));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      found.push(full);
    }
  }
  return found;
}

/** src/app/api/salon/add-ons/[id]/route.ts → /api/salon/add-ons/[id] */
function toUrlPath(routeFile: string): string {
  const relative = path.relative(API_ROOT, path.dirname(routeFile));
  return relative === '' ? '/api' : `/api/${relative.split(path.sep).join('/')}`;
}

/** A concrete request path: dynamic segments become a plausible id. */
function toRequestPath(urlPath: string): string {
  return urlPath.replace(/\[\.{3}(\w+)\]/g, 'seg1/seg2').replace(/\[(\w+)\]/g, 'id_1');
}

const adminRoutes = findRouteFiles(API_ROOT)
  .filter(file => ADMIN_GUARDS.some(guard => new RegExp(`\\b${guard}\\b`).test(readFileSync(file, 'utf8'))))
  .map(toUrlPath)
  .filter(urlPath => !EXEMPT_PREFIXES.some(prefix => urlPath.startsWith(prefix)))
  .sort();

describe('Clerk context covers every owner-authenticated API route', () => {
  it('finds the admin route tree (guards against a broken walker silently passing)', () => {
    expect(adminRoutes.length).toBeGreaterThan(50);
    expect(adminRoutes).toContain('/api/salon/add-ons');
    expect(adminRoutes).toContain('/api/salon/add-ons/[id]');
  });

  it.each(adminRoutes)('%s is wrapped in clerkMiddleware', (urlPath) => {
    expect(apiPathNeedsClerkContext(toRequestPath(urlPath))).toBe(true);
  });
});
