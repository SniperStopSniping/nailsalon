import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));

const { requireAdminSalon, getReviewSettings, saveReviewSettings } = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
  getReviewSettings: vi.fn(),
  saveReviewSettings: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/reviewRequests.server', () => ({ getReviewSettings, saveReviewSettings }));

const visibleSettings = {
  googleReviewUrl: 'https://g.page/r/luster-review',
  automaticEnabled: true,
  delayMinutes: 60,
  messageTemplate: 'Thanks {{reviewLink}}',
  businessName: 'Isla Nail Studio',
  policy: { mode: 'scheduled_end', delayMinutes: 60, repeatCooldownDays: 90 },
  readiness: { status: 'configured', reasons: [] },
};

describe('/api/admin/review-requests/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1', slug: 'isla' }, error: null });
    getReviewSettings.mockResolvedValue({
      ...visibleSettings,
      enabledAt: new Date('2030-01-01T00:00:00.000Z'),
      storedAutomationMode: 'scheduled_end',
      policyRevision: 7,
      salon: { id: 'salon_1', settings: { secret: 'must-not-leak' } },
    });
    saveReviewSettings.mockResolvedValue(visibleSettings);
  });

  it('requires a selected salon slug', async () => {
    const response = await GET(new Request('http://localhost/api/admin/review-requests/settings'));

    expect(response.status).toBe(400);
    expect(requireAdminSalon).not.toHaveBeenCalled();
  });

  it('fails closed for a denied salon before reading settings', async () => {
    requireAdminSalon.mockResolvedValue({ salon: null, error: null });
    const response = await GET(new Request('http://localhost/api/admin/review-requests/settings?salonSlug=other'));

    expect(response.status).toBe(403);
    expect(getReviewSettings).not.toHaveBeenCalled();
  });

  it('reads and writes only through the resolved salon id without leaking internal tenant fields', async () => {
    const response = await GET(new Request('http://localhost/api/admin/review-requests/settings?salonSlug=isla'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getReviewSettings).toHaveBeenCalledWith('salon_1');
    expect(body.data).toEqual(visibleSettings);
    expect(body.data).not.toHaveProperty('salon');
    expect(body.data).not.toHaveProperty('storedAutomationMode');
    expect(body.data).not.toHaveProperty('policyRevision');

    const payload = { ...visibleSettings, salonId: 'foreign-salon' };
    const rejected = await PATCH(new Request('http://localhost/api/admin/review-requests/settings?salonSlug=isla', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));

    expect(rejected.status).toBe(400);
    expect(saveReviewSettings).not.toHaveBeenCalled();
  });

  it('uses the resolved salon id for a valid write', async () => {
    const payload = {
      googleReviewUrl: visibleSettings.googleReviewUrl,
      automationMode: 'scheduled_end',
      delayMinutes: 60,
      repeatCooldownDays: 90,
      messageTemplate: visibleSettings.messageTemplate,
    };
    const response = await PATCH(new Request('http://localhost/api/admin/review-requests/settings?salonSlug=isla', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));

    expect(response.status).toBe(200);
    expect(saveReviewSettings).toHaveBeenCalledWith('salon_1', payload);
  });

  it('returns 400 for validation failures and 503 without internal error details for server failures', async () => {
    saveReviewSettings.mockRejectedValueOnce(new z.ZodError([{ code: 'custom', path: [], message: 'invalid' }]))
      .mockRejectedValueOnce(new Error('database connection details'));
    const request = () => new Request('http://localhost/api/admin/review-requests/settings?salonSlug=isla', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleReviewUrl: visibleSettings.googleReviewUrl,
        automationMode: 'scheduled_end',
        delayMinutes: 60,
        repeatCooldownDays: 90,
        messageTemplate: visibleSettings.messageTemplate,
      }),
    });

    const invalid = await PATCH(request());

    expect(invalid.status).toBe(400);

    const unavailable = await PATCH(request());

    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: { message: 'Review settings are unavailable. Try again.' } });
  });
});
