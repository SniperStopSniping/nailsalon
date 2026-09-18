import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  snapshot: vi.fn(),
  selection: vi.fn(),
  fingerprint: vi.fn(),
  database: null as { select: ReturnType<typeof vi.fn> } | null,
}));

vi.mock('@/libs/bookingCatalog', () => ({ resolveCatalogDomainView: mocks.view }));
vi.mock('@/libs/DB', () => ({ get db() {
  return mocks.database;
} }));
vi.mock('@/libs/catalogResolver.server', () => ({
  resolvePublicCatalogSnapshot: mocks.snapshot,
  resolveCatalogSelectionForSalon: mocks.selection,
  finalizeCatalogResolutionFingerprintNode: mocks.fingerprint,
}));

const { resolveL1BookingAuthority } = await import('./l1BookingAuthority.server');

const snapshot = { services: [], addOns: [], addOnGroups: [], ruleProjections: [], currency: 'CAD', revision: { fingerprint: 'snapshot' } };
const resolved = (blocksContinue: boolean) => ({
  ok: true as const,
  selection: {
    serviceId: 'service',
    basePriceCents: 5000,
    baseDurationMinutes: 50,
    addOns: [{ addOnId: 'auto', quantity: 1, unitPriceCents: 0, lineTotalCents: 0, unitDurationMinutes: 0, lineDurationMinutes: 0, autoAdded: true }],
    subtotalCents: 5000,
    totalDurationMinutes: 50,
    explanations: [],
    violations: [],
    blocksContinue,
  },
});

function database(features: unknown, technicianIds: string[]) {
  const select = vi.fn((fields?: Record<string, unknown>) => {
    const rows = fields && 'features' in fields
      ? [{ features }]
      : technicianIds.map(technicianId => ({ technicianId }));
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(rows)),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  });
  return { select };
}

describe('resolveL1BookingAuthority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses only active assigned candidates, resolves auto-adds once, and never evaluates any-artist with null', async () => {
    mocks.view.mockReturnValue('l1');
    mocks.database = database({ catalog: { variantsV1: true } }, ['active-assigned', 'inactive-or-unassigned-is-not-returned']);
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot });
    mocks.selection.mockImplementation(async ({ selection }) => resolved(selection.technicianId !== 'active-assigned'));
    mocks.fingerprint.mockResolvedValue({ revision: { fingerprint: 'selection' } });

    const result = await resolveL1BookingAuthority({
      salonId: 'salon-a',
      selection: { serviceId: 'service', selectedAddOns: [] },
      readContext: { salonId: 'salon-a', database: mocks.database as never },
    });

    expect(result?.eligibleTechnicianIds).toEqual(['active-assigned']);
    expect(result?.resolution.totalDurationMinutes).toBe(50);
    expect(result?.resolution.addOns[0]?.autoAdded).toBe(true);
    expect(mocks.selection.mock.calls.map(([args]) => args.selection.technicianId)).toEqual(['active-assigned', 'inactive-or-unassigned-is-not-returned']);
    expect(JSON.stringify(result)).not.toContain('capabilityId');
  });

  it('returns null outside L1 and rejects a cross-tenant read context before querying', async () => {
    mocks.view.mockReturnValue('legacy');
    mocks.database = database(null, []);

    await expect(resolveL1BookingAuthority({ salonId: 'salon-a', selection: { serviceId: 'service', selectedAddOns: [] } })).resolves.toBeNull();
    await expect(resolveL1BookingAuthority({ salonId: 'salon-a', selection: { serviceId: 'service', selectedAddOns: [] }, readContext: { salonId: 'salon-b', database: mocks.database as never } })).rejects.toThrow('L1_BOOKING_READ_CONTEXT_SALON_MISMATCH');
  });

  it('reports a selected technician capability-only failure as unsupported with public recovery', async () => {
    mocks.view.mockReturnValue('l1');
    mocks.database = database({ catalog: { variantsV1: true } }, ['selected-tech']);
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot });
    mocks.selection.mockResolvedValue({
      ...resolved(true),
      selection: {
        ...resolved(true).selection,
        violations: [{ code: 'capability_unavailable', anchor: { kind: 'technician', technicianId: 'selected-tech' } }],
      },
    });

    await expect(resolveL1BookingAuthority({
      salonId: 'salon-a',
      selection: { serviceId: 'service', technicianId: 'selected-tech', selectedAddOns: [] },
      readContext: { salonId: 'salon-a', database: mocks.database as never },
    })).rejects.toMatchObject({ code: 'unsupported_technician', recovery: { snapshot } });
  });

  it('fails closed when a selected technician is inactive or lacks the required active assignment', async () => {
    mocks.view.mockReturnValue('l1');
    mocks.database = database({ catalog: { variantsV1: true } }, []);
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot });

    await expect(resolveL1BookingAuthority({
      salonId: 'salon-a',
      selection: { serviceId: 'service', technicianId: 'inactive-tech', selectedAddOns: [] },
      readContext: { salonId: 'salon-a', database: mocks.database as never },
    })).rejects.toMatchObject({
      code: 'unsupported_technician',
    });
    expect(mocks.selection).not.toHaveBeenCalled();
  });
});
