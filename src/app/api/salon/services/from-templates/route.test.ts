import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const {
  requireAdminSalon,
  getSalonTemplateKeys,
  seedStarterMenuForSalon,
  ensureServiceAssignments,
  activeTechnicianRows,
} = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
  getSalonTemplateKeys: vi.fn(),
  seedStarterMenuForSalon: vi.fn(),
  ensureServiceAssignments: vi.fn(),
  activeTechnicianRows: { rows: [] as Array<{ id: string }> },
}));

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/DB', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => activeTechnicianRows.rows,
      }),
    }),
  },
}));
vi.mock('@/libs/starterMenu', () => ({ getSalonTemplateKeys, seedStarterMenuForSalon }));
vi.mock('@/libs/serviceAssignments', () => ({ ensureServiceAssignments }));

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
    ensureServiceAssignments.mockResolvedValue({
      assignedTechnicianIds: ['tech_1'],
      assignmentRequired: false,
    });
    activeTechnicianRows.rows = [{ id: 'tech_1' }];
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
      activeTechnicianCount: 1,
      autoAssignedServiceCount: 1,
      assignmentRequired: false,
    });
    // Single-technician salon: created base services auto-assign so they are
    // publicly bookable immediately (never silently hidden).
    expect(ensureServiceAssignments).toHaveBeenCalledWith(expect.anything(), {
      salonId: 'salon_1',
      serviceId: 'svc_a',
    });
  });

  it('does not auto-assign in a multi-technician salon and flags assignmentRequired', async () => {
    activeTechnicianRows.rows = [{ id: 'tech_1' }, { id: 'tech_2' }];

    const response = await POST(new Request('http://localhost/api/salon/services/from-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        templateKeys: ['classic_pedicure'],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ensureServiceAssignments).not.toHaveBeenCalled();
    expect(body.data.assignmentRequired).toBe(true);
    expect(body.data.activeTechnicianCount).toBe(2);
    expect(body.data.autoAssignedServiceCount).toBe(0);
  });

  it('does not claim bookability in a salon with no active technicians', async () => {
    activeTechnicianRows.rows = [];

    const response = await POST(new Request('http://localhost/api/salon/services/from-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'isla-nail-studio',
        templateKeys: ['classic_pedicure'],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ensureServiceAssignments).not.toHaveBeenCalled();
    expect(body.data.activeTechnicianCount).toBe(0);
    expect(body.data.assignmentRequired).toBe(false);
    expect(body.data.autoAssignedServiceCount).toBe(0);
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
