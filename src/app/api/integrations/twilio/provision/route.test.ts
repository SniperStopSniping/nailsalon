import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envMock = vi.hoisted(() => ({
  SMS_BYO_MODE_ENABLED: undefined as string | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envMock }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: {} }));

const { GET, POST } = await import('./route');

describe('twilio provision route — BYO onboarding dormancy', () => {
  it('503s the number-preview GET while new BYO onboarding is dormant', async () => {
    const response = await GET(
      new Request('http://localhost/api/integrations/twilio/provision?salonSlug=x&areaCode=416'),
    );

    expect(response).toBeDefined();
    expect(response!.status).toBe(503);
    expect((await response!.json()).error).toBe('Twilio Connect onboarding is not available');
  });

  it('503s the purchase POST while new BYO onboarding is dormant', async () => {
    const response = await POST(
      new Request('http://localhost/api/integrations/twilio/provision', {
        method: 'POST',
        body: JSON.stringify({ salonSlug: 'x', areaCode: '416' }),
      }),
    );

    expect(response).toBeDefined();
    expect(response!.status).toBe(503);
  });
});
