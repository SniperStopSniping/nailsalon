import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const requireAdminSalonMock = vi.hoisted(() =>
  vi.fn(async () => ({ error: null as Response | null, salon: { id: 'salon-1', name: 'Isla', slug: 'isla-nail-studio' } })),
);

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: requireAdminSalonMock }));
vi.mock('@/libs/lusterSecurity', () => ({ signOAuthState: vi.fn(() => 'signed-state') }));

const envMock = vi.hoisted(() => ({
  SMS_BYO_MODE_ENABLED: undefined as string | undefined,
  TWILIO_CONNECT_APP_SID: 'CN00000000000000000000000000000000',
  TWILIO_CONNECT_REDIRECT_URI: 'https://example.com/api/integrations/twilio/callback',
}));

vi.mock('@/libs/Env', () => ({ Env: envMock }));

const { GET } = await import('./route');

const connectRequest = () =>
  new Request('http://localhost/api/integrations/twilio/connect?salonSlug=isla-nail-studio');

describe('GET /api/integrations/twilio/connect — BYO onboarding dormancy', () => {
  afterEach(() => {
    envMock.SMS_BYO_MODE_ENABLED = undefined;
  });

  it('returns 503 while new BYO onboarding is dormant (flag unset)', async () => {
    const response = await GET(connectRequest());

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('Twilio Connect onboarding is not available');
  });

  it('returns 503 for any value other than the literal "true"', async () => {
    envMock.SMS_BYO_MODE_ENABLED = 'false';

    expect((await GET(connectRequest())).status).toBe(503);

    envMock.SMS_BYO_MODE_ENABLED = 'TRUE';

    expect((await GET(connectRequest())).status).toBe(503);
  });

  it('redirects to the Twilio authorize page when onboarding is explicitly enabled', async () => {
    envMock.SMS_BYO_MODE_ENABLED = 'true';
    const response = await GET(connectRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('https://www.twilio.com/authorize/');
  });
});
