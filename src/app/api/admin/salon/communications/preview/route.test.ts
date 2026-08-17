import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const requireAdminSalonMock = vi.hoisted(() =>
  vi.fn(async () => ({ error: null as Response | null, salon: { id: 'salon-1', name: 'Isla Nail Studio', slug: 'isla-nail-studio' } })),
);

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: requireAdminSalonMock }));

const { POST } = await import('./route');

const previewRequest = (body: unknown, salonSlug = 'isla-nail-studio') =>
  new Request(`http://localhost/api/admin/salon/communications/preview?salonSlug=${salonSlug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });

describe('POST /api/admin/salon/communications/preview', () => {
  beforeEach(() => {
    requireAdminSalonMock.mockClear();
  });

  it('renders a controlled template with segmentation and the counter string', async () => {
    const response = await POST(previewRequest({ templateKey: 'client_booking_confirmation_nolink' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const payload = await response.json();

    expect(payload.data.body).toContain('Isla Nail Studio via Luster: ');
    expect(payload.data.body).toContain('Reply STOP to opt out.');
    expect(payload.data.segmentation.segments).toBe(1);
    expect(payload.data.preview).toMatch(/\/160 · 1 SMS credit$/);
    expect(payload.data.warnings).toEqual([]);
  });

  it('flags the tracked manage-link overflow as MULTI_SEGMENT instead of hiding it', async () => {
    const response = await POST(previewRequest({ templateKey: 'client_appointment_reminder' }));
    const payload = await response.json();

    expect(payload.data.segmentation.segments).toBe(2);
    expect(payload.data.warnings).toContain('MULTI_SEGMENT');
  });

  it('enforces admin salon access', async () => {
    requireAdminSalonMock.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }),
      salon: null,
    } as never);
    const response = await POST(previewRequest({ templateKey: 'client_booking_confirmation_nolink' }));

    expect(response.status).toBe(401);
  });

  it('rejects unknown templates and malformed bodies without leaking anything', async () => {
    expect((await POST(previewRequest({ templateKey: 'totally_unknown' }))).status).toBe(404);
    expect((await POST(previewRequest({ templateKey: 'constructor' }))).status).toBe(404);
    expect((await POST(previewRequest({ templateKey: '__proto__' }))).status).toBe(404);
    expect((await POST(previewRequest({ templateKey: 'toString' }))).status).toBe(404);
    expect((await POST(previewRequest({ templateKey: '' }))).status).toBe(400);
    expect((await POST(previewRequest({ templateKey: 'x', extra: 'nope' }))).status).toBe(400);

    const missingSlug = new Request('http://localhost/api/admin/salon/communications/preview', {
      method: 'POST',
      body: JSON.stringify({ templateKey: 'client_booking_confirmation_nolink' }),
    });

    expect((await POST(missingSlug)).status).toBe(400);
  });

  it('never leaks secrets or provider identifiers in the response', async () => {
    const response = await POST(previewRequest({ templateKey: 'owner_new_booking' }));
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toMatch(/AC[0-9a-f]{32}|MG[0-9a-f]{32}|sk_live|whsec_|TWILIO|STRIPE/);
  });

  it('performs no provider call and no database write (source scan)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/from 'twilio'|@\/libs\/DB|@\/libs\/SMS|fetch\s*\(/);
  });
});
