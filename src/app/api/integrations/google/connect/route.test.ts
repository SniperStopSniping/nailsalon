import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { requireAdminSalon, signOAuthState, Env } = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
  signOAuthState: vi.fn(() => 'signed-state'),
  Env: {
    GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_OAUTH_REDIRECT_URI: 'https://islanailsalon.com/api/integrations/google/callback',
    INTEGRATION_ENCRYPTION_KEY: 'integration-key',
    OAUTH_STATE_SECRET: 'oauth-state-secret',
  } as Record<string, string | undefined>,
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/Env', () => ({ Env }));
vi.mock('@/libs/lusterSecurity', () => ({ signOAuthState }));

describe('GET /api/integrations/google/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(Env, {
      GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://islanailsalon.com/api/integrations/google/callback',
      INTEGRATION_ENCRYPTION_KEY: 'integration-key',
      OAUTH_STATE_SECRET: 'oauth-state-secret',
    });
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1', slug: 'hello' },
    });
  });

  it('redirects back to the branded integrations page when OAuth is incomplete', async () => {
    Env.OAUTH_STATE_SECRET = undefined;

    const response = await GET(new Request(
      'https://islanailsalon.com/api/integrations/google/connect?salonSlug=hello',
    ));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://islanailsalon.com/en/admin/luster?salon=hello&google=not_configured',
    );
    expect(signOAuthState).not.toHaveBeenCalled();
  });

  it('redirects to Google with offline access when OAuth is fully configured', async () => {
    const response = await GET(new Request(
      'https://islanailsalon.com/api/integrations/google/connect?salonSlug=hello',
    ));
    const location = new URL(response.headers.get('location')!);

    expect(response.status).toBe(302);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('access_type')).toBe('offline');
    expect(location.searchParams.get('prompt')).toBe('consent');
    expect(location.searchParams.get('state')).toBe('signed-state');
    expect(location.searchParams.get('scope')).toContain('calendar.events');
    expect(signOAuthState).toHaveBeenCalledWith({
      provider: 'google',
      salonId: 'salon_1',
      salonSlug: 'hello',
    });
  });
});
