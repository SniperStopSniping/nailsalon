import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { shouldRequireApiRequestOrigin } from './requestOriginGuard';

const API_ROOT = path.join(process.cwd(), 'src/app/api');
const OWNER_OR_STAFF_AUTH = [
  '\\brequireAdmin(?:Salon|Owner|RealSalonOwner|ActiveAdminSalon)?\\s*\\(',
  '\\brequireSuperAdmin\\s*\\(',
  '\\brequireStaff(?:OrAdminSalonAccess)?\\s*\\(',
  '\\brequireAppointment(?:Manager)?Access\\s*\\(',
  '\\brequireClientApiSession\\s*\\(',
  '\\bgetAdminSession\\s*\\(',
  '\\bauth\\s*\\(',
];
const MACHINE_AUTH_ROUTES = [
  '/api/autopost/process',
  '/api/billing/readiness',
  '/api/billing/reconcile',
  '/api/billing/windows/evaluate',
  '/api/communications/dispatch',
  '/api/deposits/holds/reap',
  '/api/deposits/reconcile',
  '/api/integrations/outbox/process',
  '/api/integrations/twilio/deauthorize',
  '/api/integrations/twilio/inbound',
  '/api/integrations/twilio/status',
  '/api/network-no-show/reconcile',
  '/api/reminders/process',
  '/api/service-images/pending/cleanup',
  '/api/voice/maintenance',
  '/api/voice/twilio/dial-ended',
  '/api/voice/twilio/inbound',
  '/api/voice/twilio/status',
  '/api/webhooks/stripe',
  '/api/webhooks/stripe-billing',
  '/api/webhooks/stripe-connect',
];

function findRoutes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? findRoutes(full)
      : entry.name === 'route.ts' || entry.name === 'route.tsx'
        ? [full]
        : [];
  });
}

function routePath(file: string): string {
  const relative = path.relative(API_ROOT, path.dirname(file));
  return relative ? `/api/${relative.split(path.sep).join('/')}` : '/api';
}

const protectedAuthRoutes = findRoutes(API_ROOT)
  .filter((file) => {
    const source = readFileSync(file, 'utf8');
    return OWNER_OR_STAFF_AUTH.some(pattern => new RegExp(pattern).test(source));
  })
  .map(routePath)
  .sort();

describe('browser Origin middleware coverage for cookie-authenticated routes', () => {
  it('discovers substantial owner, staff, client, and onboarding route coverage', () => {
    expect(protectedAuthRoutes.length).toBeGreaterThan(100);
    expect(protectedAuthRoutes).toContain('/api/admin/salon/publish');
    expect(protectedAuthRoutes).toContain('/api/salon/add-ons');
    expect(protectedAuthRoutes).toContain('/api/appointments/[id]/cancel');
    expect(protectedAuthRoutes).toContain('/api/onboarding/v1/organization');
    expect(protectedAuthRoutes).toContain('/api/billing/checkout');
  });

  it.each(protectedAuthRoutes)('%s is covered when a supported session cookie is present', (pathname) => {
    expect(shouldRequireApiRequestOrigin({
      pathname: pathname.replace(/\[(?:\.\.\.)?(\w+)\]/g, 'segment'),
      method: 'POST',
      cookies: [{ name: '__session', value: 'test-session' }],
    })).toBe(true);
  });

  it.each(MACHINE_AUTH_ROUTES)('%s remains under its machine or provider authentication', (pathname) => {
    expect(findRoutes(API_ROOT).map(routePath)).toContain(pathname);
    expect(shouldRequireApiRequestOrigin({
      pathname,
      method: 'POST',
      cookies: [{ name: 'n5_admin_session', value: 'synthetic-session' }],
    })).toBe(false);
  });
});
