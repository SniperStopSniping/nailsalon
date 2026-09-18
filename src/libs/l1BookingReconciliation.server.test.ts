import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPublicCatalogSnapshot, resolveCatalogSelection } from './catalogResolverCore';
import { makeFixtureService } from './catalogResolverFixtures';
import { L1BookingAuthorityError } from './l1BookingAuthority.server';
import { projectL1ConflictPayload, reconcileAuthoritativeL1Selection } from './l1BookingReconciliation.server';

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./l1BookingAuthority.server', async importOriginal => ({
  ...await importOriginal<typeof import('./l1BookingAuthority.server')>(),
  resolveL1BookingAuthority: mocks.resolve,
}));

function fixture() {
  const built = buildPublicCatalogSnapshot({ salonSettings: null, services: [makeFixtureService({ id: 'bookable-service' }), makeFixtureService({ id: 'hidden', name: 'HIDDEN_SENTINEL' })], addOns: [], addOnGroups: [], serviceAddOnBindings: [], rules: [] });
  if (!built.ok) {
    throw new Error('Invalid synthetic snapshot');
  }
  const resolved = resolveCatalogSelection(built.snapshot, { serviceId: 'bookable-service', selectedAddOns: [] });
  if (!resolved.ok) {
    throw new Error('Invalid synthetic selection');
  }
  return { snapshot: built.snapshot, resolution: resolved.selection };
}

describe('L1 public conflict projection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns unavailable without exposing recovery when no bookable technician exists', async () => {
    mocks.resolve.mockRejectedValue(new L1BookingAuthorityError('unavailable', fixture()));

    await expect(reconcileAuthoritativeL1Selection({ salonId: 'salon', features: { catalog: { variantsV1: true } }, selection: { serviceId: 'bookable-service', selectedAddOns: [] } })).resolves.toEqual({ status: 'unavailable', failure: null });
  });

  it('redacts unrelated menu entries without changing authority material', () => {
    const original = fixture();
    const payload = projectL1ConflictPayload({ ...original, reason: 'material_change', recovery: 'reload_catalog_and_reselect', resolutionFingerprint: 'f'.repeat(64) });

    expect(JSON.stringify(payload)).not.toContain('HIDDEN_SENTINEL');
    expect(payload.resolution).toBe(original.resolution);
    expect(payload.resolutionFingerprint).toBe('f'.repeat(64));
  });

  it('projects the serialized acknowledgment-conflict response', async () => {
    mocks.resolve.mockResolvedValue({ ...fixture(), fingerprint: 'f'.repeat(64), eligibleTechnicianIds: ['tech'] });
    const result = await reconcileAuthoritativeL1Selection({ salonId: 'salon', features: { catalog: { variantsV1: true } }, selection: { serviceId: 'bookable-service', selectedAddOns: [] } });

    expect(result.status).toBe('conflict');
    expect(JSON.stringify(result)).not.toContain('HIDDEN_SENTINEL');
    expect(result).toMatchObject({ payload: { resolutionFingerprint: 'f'.repeat(64) } });
  });
});
