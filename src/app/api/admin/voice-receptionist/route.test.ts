import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));

const {
  requireAdminSalon,
  requireRealSalonOwner,
  getVoiceSettings,
  listVoiceCalls,
  listVoiceNumberRoutes,
  updateVoiceSettings,
} = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
  requireRealSalonOwner: vi.fn(),
  getVoiceSettings: vi.fn(),
  listVoiceCalls: vi.fn(),
  listVoiceNumberRoutes: vi.fn(),
  updateVoiceSettings: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon, requireRealSalonOwner }));
vi.mock('@/libs/voiceReceptionist/storage.server', () => ({ getVoiceSettings, listVoiceCalls, listVoiceNumberRoutes, updateVoiceSettings }));

const settings = {
  salonId: 'salon_1',
  enabled: false,
  bookingEnabled: false,
  greeting: null,
  voice: 'marin',
  language: 'auto',
  answerMode: 'always',
  callbackEnabled: true,
  summaryRetentionDays: 30,
};

describe('/api/admin/voice-receptionist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ salon: { id: 'salon_1', slug: 'isla' }, error: null });
    requireRealSalonOwner.mockResolvedValue({ ok: true, admin: { id: 'owner_1' } });
    getVoiceSettings.mockResolvedValue(settings);
    listVoiceNumberRoutes.mockResolvedValue([{ id: 'route_1' }]);
    listVoiceCalls.mockResolvedValue([{ id: 'call_1', provider: 'twilio', callerNumber: '+15551234567', status: 'completed', outcome: 'booked', summary: 'Booked.', appointmentId: 'apt_1', callbackRequested: false, durationSeconds: 60, createdAt: new Date(), endedAt: new Date(), draft: { secret: 'never returned' } }]);
  });

  it('requires the resolved salon owner and returns history without draft data', async () => {
    const response = await GET(new Request('http://localhost/api/admin/voice-receptionist?salonSlug=isla'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireRealSalonOwner).toHaveBeenCalledWith('salon_1');
    expect(listVoiceCalls).toHaveBeenCalledWith('salon_1');
    expect(body.data.calls[0]).not.toHaveProperty('draft');
  });

  it('rejects cross-origin and foreign setting fields before any write', async () => {
    const foreign = await PATCH(new Request('http://localhost/api/admin/voice-receptionist?salonSlug=isla', { method: 'PATCH', headers: { 'origin': 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) }));

    expect(foreign.status).toBe(403);

    const invalid = await PATCH(new Request('http://localhost/api/admin/voice-receptionist?salonSlug=isla', { method: 'PATCH', headers: { 'origin': 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ salonId: 'other' }) }));

    expect(invalid.status).toBe(400);
    expect(updateVoiceSettings).not.toHaveBeenCalled();
  });

  it('uses the resolved salon id for valid settings writes', async () => {
    listVoiceNumberRoutes.mockResolvedValue([]);
    const response = await PATCH(new Request('http://localhost/api/admin/voice-receptionist?salonSlug=isla', { method: 'PATCH', headers: { 'origin': 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ greeting: 'Hi from Isla', voice: 'cedar', callbackEnabled: false }) }));

    expect(response.status).toBe(200);
    expect(updateVoiceSettings).toHaveBeenCalledWith('salon_1', { greeting: 'Hi from Isla', voice: 'cedar', callbackEnabled: false });
  });
});
