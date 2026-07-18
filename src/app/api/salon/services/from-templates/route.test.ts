import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const {
  requireAdminSalon,
  getSalonTemplateKeys,
  seedStarterMenuForSalon,
} = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
  getSalonTemplateKeys: vi.fn(),
  seedStarterMenuForSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/starterMenu', () => ({ getSalonTemplateKeys, seedStarterMenuForSalon }));

describe('salon services from-templates route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      salon: { id: 'salon_1', slug: 'isla-nail-studio' },
      error: null,
    });
    getSalonTemplateKeys.mockResolvedValue(new Set(['gel_manicure']));
    seedStarterMenuForSalon.mockResolvedValue({
      createdServiceIds: ['svc_a'],
      createdAddOnIds: ['addon_a'],
      skippedTemplateKeys: ['gel_manicure'],
    });
  });

  it('returns the template keys already on the salon menu', async () => {
    const response = await GET(
      new Request('http://localhost/api/salon/services/from-templates?salonSlug=isla-nail-studio'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalon).toHaveBeenCalledWith('isla-nail-studio');
    expect(body.data.ownedTemplateKeys).toEqual(['gel_manicure']);
  });

  it('seeds requested catalog templates in restore mode and reports skips', async () => {
    const response = await POST(new Request('http://localhost/api/salon/services/from-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        templateKeys: ['gel_manicure', 'classic_pedicure'],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(seedStarterMenuForSalon).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      mode: 'restore',
      templateKeys: ['gel_manicure', 'classic_pedicure'],
    }));
    expect(body.data).toEqual({
      createdServiceCount: 1,
      createdAddOnCount: 1,
      skippedTemplateKeys: ['gel_manicure'],
    });
  });

  it('rejects template keys that are not in the catalog', async () => {
    const response = await POST(new Request('http://localhost/api/salon/services/from-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        templateKeys: ['not_a_real_template'],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('UNKNOWN_TEMPLATE_KEYS');
    expect(seedStarterMenuForSalon).not.toHaveBeenCalled();
  });

  it('requires an authorized salon admin', async () => {
    requireAdminSalon.mockResolvedValue({
      salon: null,
      error: Response.json({ error: 'forbidden' }, { status: 403 }),
    });

    const response = await POST(new Request('http://localhost/api/salon/services/from-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'someone-elses-salon', templateKeys: ['gel_manicure'] }),
    }));

    expect(response.status).toBe(403);
    expect(seedStarterMenuForSalon).not.toHaveBeenCalled();
  });
});
