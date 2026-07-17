import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { requireAppointmentManagerAccess, getSalonById, getOrCreateSalonClient, getRetentionSettingsForSalon, updateCalls } = vi.hoisted(() => {
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];
  return {
    requireAppointmentManagerAccess: vi.fn(),
    getSalonById: vi.fn(),
    getOrCreateSalonClient: vi.fn(),
    getRetentionSettingsForSalon: vi.fn(),
    updateCalls,
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/queries', () => ({ getSalonById, getOrCreateSalonClient }));
vi.mock('@/libs/retentionSettings.server', () => ({ getRetentionSettingsForSalon }));
vi.mock('@/libs/DB', () => ({
  db: {
    update: vi.fn(() => {
      const chain: any = {
        set: vi.fn((values: Record<string, unknown>) => {
          updateCalls.push({ set: values });
          return chain;
        }),
        where: vi.fn(async () => []),
      };
      return chain;
    }),
  },
}));

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  salonClientId: 'salon_client_1',
  clientName: 'Ava Nguyen',
  clientPhone: '4165551234',
  status: 'completed',
};

function post(action: string, url = 'https://app.test/api/appointments/appt_1/review-followup') {
  return POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: { id: 'appt_1' } },
  );
}

describe('POST /api/appointments/[id]/review-followup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls.length = 0;
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment,
      actorRole: 'admin',
    });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      name: 'Isla Nail Studio',
      settings: { googleReviewUrl: 'https://legacy.example/review' },
    });
    getRetentionSettingsForSalon.mockResolvedValue({ googleReviewUrl: 'https://g.page/r/isla/review' });
  });

  it('threads the explicit salon hint into the access guard', async () => {
    const response = await post('satisfaction_question', 'https://app.test/api/appointments/appt_1/review-followup?salonSlug=glow');

    expect(response.status).toBe(200);
    expect(requireAppointmentManagerAccess).toHaveBeenCalledWith('appt_1', expect.objectContaining({
      assignedOnly: true,
      salonSlugHint: 'glow',
    }));
  });

  it('prefers the retention-settings review URL over the legacy salon setting', async () => {
    const response = await post('google_review_link');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toContain('https://g.page/r/isla/review');
    expect(body.data.message).not.toContain('https://legacy.example/review');
  });

  it('falls back to the legacy salon-settings review URL when retention settings have none', async () => {
    getRetentionSettingsForSalon.mockResolvedValue({ googleReviewUrl: null });

    const response = await post('google_review_link');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.message).toContain('https://legacy.example/review');
  });

  it('marks the client as reviewed for already_reviewed without composing a message', async () => {
    const response = await post('already_reviewed');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.clientHasGoogleReview).toBe(true);
    expect(body.data.message).toBeNull();

    const reviewedUpdate = updateCalls.find(call => call.set.hasGoogleReview === true);

    expect(reviewedUpdate).toBeTruthy();
  });

  it('preserves authorization failures from the guard', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    });

    const response = await post('satisfaction_question');

    expect(response.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects unknown actions', async () => {
    const response = await post('spam_everyone');

    expect(response.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });
});
