import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const { insert, fetchProvider } = vi.hoisted(() => ({ insert: vi.fn(), fetchProvider: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: { insert } }));

describe('Twilio provision retirement', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, 'false', 'true'])('GET rejects onboarding even with the legacy flag %s', async (flag) => {
    vi.stubEnv('SMS_BYO_MODE_ENABLED', flag);
    vi.stubGlobal('fetch', fetchProvider);
    try {
      const response = await GET(new Request('https://luster.test/api/integrations/twilio/provision?salonSlug=isla&state=previously-signed&AccountSid=AC11111111111111111111111111111111', { method: 'GET' }));

      expect(response.status).toBe(410);
      expect((await response.json()).error).toContain('Luster texting uses SMS credits');
      expect(response.headers.get('location')).toBeNull();
      expect(insert).not.toHaveBeenCalled();
      expect(fetchProvider).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([undefined, 'false', 'true'])('POST rejects onboarding even with the legacy flag %s', async (flag) => {
    vi.stubEnv('SMS_BYO_MODE_ENABLED', flag);
    vi.stubGlobal('fetch', fetchProvider);
    try {
      const response = await POST(new Request('https://luster.test/api/integrations/twilio/provision?salonSlug=isla&state=previously-signed&AccountSid=AC11111111111111111111111111111111', { method: 'POST' }));

      expect(response.status).toBe(410);
      expect((await response.json()).error).toContain('Luster texting uses SMS credits');
      expect(response.headers.get('location')).toBeNull();
      expect(insert).not.toHaveBeenCalled();
      expect(fetchProvider).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
