/**
 * Luster L1 PR3 — server wrapper tests.
 *
 * Real PGlite-backed integration tests, following the exact pattern in
 * `ownerPreview.test.ts` / `bookingQuote.addOnGating.test.ts`: PGlite +
 * drizzle + migrate, with only the DB module, `next/headers` cookies, and
 * the dev-role override mocked. This wrapper's whole job is DB loading +
 * authorization + private-data narrowing, so it is tested against real rows
 * rather than stubbed query results.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer: () => false,
  readDevRoleFromCookies: () => null,
  getMockAdminSession: () => {
    throw new Error('getMockAdminSession should not be reachable in this test');
  },
}));

const cookieJar = vi.hoisted(() => new Map<string, { value: string }>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
    getAll: () => [...cookieJar].map(([name, cookie]) => ({ name, value: cookie.value })),
    set: (name: string, value: string) => {
      cookieJar.set(name, { value });
    },
  }),
}));

function setCookie(name: string, value: string) {
  cookieJar.set(name, { value });
}

function clearCookies() {
  cookieJar.clear();
}

/* eslint-disable import/first */
import { ADMIN_SESSION_COOKIE } from '@/libs/adminAuth';
import type { CatalogSelectionInput } from '@/libs/catalogDomain';
import { hashCatalogFingerprintWebCrypto } from '@/libs/catalogFingerprint';
import { hashCatalogFingerprintNode } from '@/libs/catalogFingerprint.server';
import {
  authorizeCatalogSource,
  CatalogSourceAuthorizationError,
  CatalogSourceUnimplementedError,
  finalizeCatalogResolutionFingerprintNode,
  resolveCatalogSelectionForSalon,
  resolvePublicCatalogSnapshot,
} from '@/libs/catalogResolver.server';
import {
  buildCatalogResolutionFingerprintInput,
  buildPublicCatalogSnapshot,
  finalizeCatalogResolutionFingerprint,
  resolveCatalogSelection,
} from '@/libs/catalogResolverCore';
import {
  makeFixtureAddOn,
  makeFixtureAddOnGroup,
  makeFixtureBinding,
  makeFixtureRule,
  makeFixtureService,
} from '@/libs/catalogResolverFixtures';
/* eslint-enable import/first */

function expectOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false: ${JSON.stringify(result)}`);
  }
}

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

const SALON_ID = 'salon_catalog_wrapper';
const OTHER_SALON_ID = 'salon_catalog_wrapper_other';

const OWNER_ADMIN_ID = 'admin_catalog_owner';
const OTHER_OWNER_ADMIN_ID = 'admin_catalog_other_owner';
const OWNER_SESSION_ID = 'session_catalog_owner_valid';
const OTHER_OWNER_SESSION_ID = 'session_catalog_other_owner_valid';

const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');

const SERVICE_ID = 'svc_wrapper';
const ADD_ON_ID = 'addon_wrapper';
const GROUP_ID = 'group_wrapper';
const CAPABILITY_ID = 'capability_ombre_secret_id';
const TECHNICIAN_WITH_ID = 'tech_with_capability';
const TECHNICIAN_WITHOUT_ID = 'tech_without_capability';

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_ID, name: 'Wrapper Salon', slug: 'wrapper-salon', settings: { booking: { currency: 'USD' } } },
    { id: OTHER_SALON_ID, name: 'Other Salon', slug: 'wrapper-salon-other', settings: {} },
  ]);

  await db.insert(schema.adminUserSchema).values([
    { id: OWNER_ADMIN_ID, phoneE164: '+15559990001', name: 'Wrapper Owner', isSuperAdmin: false },
    { id: OTHER_OWNER_ADMIN_ID, phoneE164: '+15559990002', name: 'Other Owner', isSuperAdmin: false },
  ]);
  await db.insert(schema.adminSalonMembershipSchema).values([
    { adminId: OWNER_ADMIN_ID, salonId: SALON_ID, role: 'owner' },
    { adminId: OTHER_OWNER_ADMIN_ID, salonId: OTHER_SALON_ID, role: 'owner' },
  ]);
  await db.insert(schema.adminSessionSchema).values([
    { id: OWNER_SESSION_ID, adminId: OWNER_ADMIN_ID, expiresAt: FAR_FUTURE },
    { id: OTHER_OWNER_SESSION_ID, adminId: OTHER_OWNER_ADMIN_ID, expiresAt: FAR_FUTURE },
  ]);

  await db.insert(schema.serviceSchema).values([makeFixtureService({ id: SERVICE_ID, salonId: SALON_ID })]);
  await db.insert(schema.addOnGroupSchema).values([makeFixtureAddOnGroup({ id: GROUP_ID, salonId: SALON_ID })]);
  await db.insert(schema.addOnSchema).values([
    makeFixtureAddOn({ id: ADD_ON_ID, salonId: SALON_ID, groupId: GROUP_ID }),
  ]);
  await db.insert(schema.serviceAddOnSchema).values([
    makeFixtureBinding({ id: 'sao_wrapper', salonId: SALON_ID, serviceId: SERVICE_ID, addOnId: ADD_ON_ID }),
  ]);

  // A capability requirement on the service itself, and the technicians who
  // do/don't hold it — this is what proves `deriveCatalogEligibility` reads
  // real private rows rather than trusting a caller-supplied opinion.
  await db.insert(schema.capabilitySchema).values([
    { id: CAPABILITY_ID, salonId: SALON_ID, slug: 'ombre-specialist', name: 'Ombré Specialist' },
  ]);
  await db.insert(schema.technicianSchema).values([
    { id: TECHNICIAN_WITH_ID, salonId: SALON_ID, name: 'Tech With Skill' },
    { id: TECHNICIAN_WITHOUT_ID, salonId: SALON_ID, name: 'Tech Without Skill' },
  ]);
  await db.insert(schema.technicianCapabilitySchema).values([
    { id: 'tc_1', salonId: SALON_ID, technicianId: TECHNICIAN_WITH_ID, capabilityId: CAPABILITY_ID },
  ]);
  // A real `catalog_rule` row, inserted directly against the DB shape
  // (`CatalogRuleCoreInput` — what `makeFixtureRule` builds — deliberately
  // has no `salonId`/`capabilityId`/`note`, so it is not the right shape for
  // a DB insert; it is the CORE's input type, produced by the wrapper's own
  // `toCatalogRuleCoreInput`, not something a seed step should construct).
  await db.insert(schema.catalogRuleSchema).values([
    {
      id: 'rule_wrapper_capability',
      salonId: SALON_ID,
      serviceId: null,
      ruleType: 'requires_capability',
      subjectServiceId: SERVICE_ID,
      subjectAddOnId: null,
      objectAddOnId: null,
      capabilityId: CAPABILITY_ID,
      params: {},
      priority: 0,
      isActive: true,
      note: null,
    },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('authorizeCatalogSource — the ONE authorization matrix for catalog source selection', () => {
  beforeEach(() => {
    clearCookies();
  });

  it('MANDATORY — "live" is always authorized, with no session at all (public visitors receive live source only)', async () => {
    await expect(authorizeCatalogSource(SALON_ID, 'live')).resolves.toBe('live');
  });

  it('MANDATORY — "draft" is rejected for an anonymous caller (draft data must never reach an unauthenticated caller)', async () => {
    await expect(authorizeCatalogSource(SALON_ID, 'draft')).rejects.toBeInstanceOf(CatalogSourceAuthorizationError);
  });

  it('"draft" is rejected for an authenticated owner of a DIFFERENT salon', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OTHER_OWNER_SESSION_ID);

    await expect(authorizeCatalogSource(SALON_ID, 'draft')).rejects.toBeInstanceOf(CatalogSourceAuthorizationError);
  });

  it('MANDATORY — "draft" is available only to an authenticated, tenant-authorized owner preview: the correct owner clears authorization, then hits the honest "not implemented" wall (never a silent live substitution)', async () => {
    setCookie(ADMIN_SESSION_COOKIE, OWNER_SESSION_ID);

    await expect(authorizeCatalogSource(SALON_ID, 'draft')).rejects.toBeInstanceOf(CatalogSourceUnimplementedError);
  });
});

describe('resolvePublicCatalogSnapshot', () => {
  beforeEach(() => {
    clearCookies();
  });

  it('loads the real salon/service/add-on/group rows and projects them through the frozen core', async () => {
    const result = await resolvePublicCatalogSnapshot({ salonId: SALON_ID, requestedSource: 'live' });
    expectOk(result);

    expect(result.snapshot.services.map(s => s.id)).toEqual([SERVICE_ID]);
    expect(result.snapshot.addOns.map(a => a.id)).toEqual([ADD_ON_ID]);
    expect(result.snapshot.addOnGroups.map(g => g.id)).toEqual([GROUP_ID]);
    // The capability rule is real and active, but produces NO public
    // projection — capability handling never reaches the client this way.
    expect(result.snapshot.ruleProjections).toHaveLength(0);
    expect(result.snapshot.currency).toBe('USD');
  });

  it('MANDATORY — never leaks the raw capability id, even though it was just read from the database', async () => {
    const result = await resolvePublicCatalogSnapshot({ salonId: SALON_ID, requestedSource: 'live' });
    expectOk(result);

    expect(JSON.stringify(result.snapshot)).not.toContain(CAPABILITY_ID);
  });

  it('rejects a draft request from an anonymous caller before touching draft-only logic', async () => {
    await expect(resolvePublicCatalogSnapshot({ salonId: SALON_ID, requestedSource: 'draft' }))
      .rejects.toBeInstanceOf(CatalogSourceAuthorizationError);
  });

  it('an unknown salonId resolves to an empty, valid snapshot rather than throwing', async () => {
    const result = await resolvePublicCatalogSnapshot({ salonId: 'salon_does_not_exist', requestedSource: 'live' });
    expectOk(result);

    expect(result.snapshot.services).toHaveLength(0);
  });
});

describe('resolveCatalogSelectionForSalon — private capability enrichment, narrowed', () => {
  async function snapshotForWrapperSalon() {
    const result = await resolvePublicCatalogSnapshot({ salonId: SALON_ID, requestedSource: 'live' });
    expectOk(result);
    return result.snapshot;
  }

  it('a technician WITHOUT the required capability is blocked', async () => {
    const snapshot = await snapshotForWrapperSalon();
    const selection: CatalogSelectionInput = { serviceId: SERVICE_ID, technicianId: TECHNICIAN_WITHOUT_ID, selectedAddOns: [] };

    const result = await resolveCatalogSelectionForSalon({ salonId: SALON_ID, snapshot, selection });
    expectOk(result);

    expect(result.selection.violations).toContainEqual({
      code: 'capability_unavailable',
      anchor: { kind: 'technician', technicianId: TECHNICIAN_WITHOUT_ID },
    });
  });

  it('a technician WITH the required capability is not blocked', async () => {
    const snapshot = await snapshotForWrapperSalon();
    const selection: CatalogSelectionInput = { serviceId: SERVICE_ID, technicianId: TECHNICIAN_WITH_ID, selectedAddOns: [] };

    const result = await resolveCatalogSelectionForSalon({ salonId: SALON_ID, snapshot, selection });
    expectOk(result);

    expect(result.selection.violations).toHaveLength(0);
  });

  it('no technician chosen at all fails closed when a capability is required somewhere in the selection', async () => {
    const snapshot = await snapshotForWrapperSalon();
    const selection: CatalogSelectionInput = { serviceId: SERVICE_ID, selectedAddOns: [] };

    const result = await resolveCatalogSelectionForSalon({ salonId: SALON_ID, snapshot, selection });
    expectOk(result);

    expect(result.selection.violations).toContainEqual(expect.objectContaining({ code: 'capability_unavailable' }));
  });

  it('never leaks the raw capability id through the resolved selection either', async () => {
    const snapshot = await snapshotForWrapperSalon();
    const selection: CatalogSelectionInput = { serviceId: SERVICE_ID, technicianId: TECHNICIAN_WITHOUT_ID, selectedAddOns: [] };

    const result = await resolveCatalogSelectionForSalon({ salonId: SALON_ID, snapshot, selection });
    expectOk(result);

    expect(JSON.stringify(result.selection)).not.toContain(CAPABILITY_ID);
  });
});

// =============================================================================
// SELECTION-LEVEL RESOLUTION FINGERPRINT — mandatory regression tests
//
// `catalogRevision` (snapshot-level: "did the salon's catalog change?") and
// `catalogResolutionFingerprint` (selection-level: "did THIS customer's
// configuration materially change?") are two DIFFERENT deliverables. Both
// mandatory tests below are pointed at the real per-selection value —
// `buildCatalogResolutionFingerprintInput` / `finalizeCatalogResolutionFingerprint`
// (`catalogResolverCore.ts`) — never at the snapshot-level one.
// =============================================================================

describe('catalogResolutionFingerprint — the selection-level material fingerprint', () => {
  it('MANDATORY — localized reason text is excluded BY THE SHAPE ITSELF: an en -> fr swap of a real explanation\'s reasonText does not change the fingerprint input at all', async () => {
    // A real resolved selection with an auto-added line, so `autoAdditions`
    // is non-empty and actually exercises the reasonCode-only shape.
    const snapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'svc_locale' })],
      addOnGroups: [],
      addOns: [makeFixtureAddOn({ id: 'addon_locale_base_coat', priceCents: 0, durationMinutes: 5 })],
      serviceAddOnBindings: [],
      rules: [makeFixtureRule({
        id: 'rule_locale_include',
        ruleType: 'include',
        subjectServiceId: 'svc_locale',
        objectAddOnId: 'addon_locale_base_coat',
        params: { autoAdd: true },
      })],
    });
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_locale', selectedAddOns: [] });
    expectOk(resolution);

    expect(resolution.selection.explanations.some(e => e.kind === 'add_on_auto_added')).toBe(true);

    const englishInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, resolution.selection);

    // Hand-translate every explanation's reasonText on a COPY of the real
    // resolved selection — simulating an en -> fr switch — and rebuild the
    // fingerprint input from it.
    const frenchSelection = {
      ...resolution.selection,
      explanations: resolution.selection.explanations.map(e => ({
        ...e,
        reasonText: 'Inclus automatiquement avec votre sélection.',
      })),
    };
    const frenchInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, frenchSelection);

    expect(frenchInput).toEqual(englishInput);

    // Structural proof, not just a value comparison — the shape itself has
    // no slot reasonText (or reasonText's cousin, presentation) could
    // occupy.
    expect(Object.keys(englishInput.autoAdditions[0]!).sort()).toEqual(['addOnId', 'reasonCode']);

    const serializedEnglishInput = JSON.stringify(englishInput);

    expect(serializedEnglishInput).not.toContain('reasonText');
    expect(serializedEnglishInput).not.toContain('presentation');
    expect(serializedEnglishInput).not.toContain('sélection'); // no French prose
    expect(serializedEnglishInput).not.toContain('Included automatically'); // no English prose either

    // And the actual hashed fingerprints agree too, end to end.
    const englishFinalized = await finalizeCatalogResolutionFingerprint(snapshot.snapshot, resolution.selection, hashCatalogFingerprintWebCrypto);
    const frenchFinalized = await finalizeCatalogResolutionFingerprint(snapshot.snapshot, frenchSelection, hashCatalogFingerprintWebCrypto);

    expect(frenchFinalized.revision.fingerprint).toBe(englishFinalized.revision.fingerprint);
  });

  it('MANDATORY — a material quantity/line-duration change DOES change the resolution fingerprint', async () => {
    const beforeSnapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'svc_qty' })],
      addOnGroups: [],
      addOns: [makeFixtureAddOn({ id: 'addon_qty', pricingType: 'per_unit', maxQuantity: 10, durationMinutes: 10 })],
      serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_qty', serviceId: 'svc_qty', addOnId: 'addon_qty' })],
      rules: [],
    });
    const afterSnapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'svc_qty' })],
      // Same add-on id, but its per-unit DURATION moved — a material
      // change to a resolved LINE's lineDurationMinutes even when the
      // client requests the identical quantity.
      addOns: [makeFixtureAddOn({ id: 'addon_qty', pricingType: 'per_unit', maxQuantity: 10, durationMinutes: 12 })],
      addOnGroups: [],
      serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_qty', serviceId: 'svc_qty', addOnId: 'addon_qty' })],
      rules: [],
    });
    expectOk(beforeSnapshot);
    expectOk(afterSnapshot);

    const selection: CatalogSelectionInput = { serviceId: 'svc_qty', selectedAddOns: [{ addOnId: 'addon_qty', quantity: 5 }] };
    const beforeResolution = resolveCatalogSelection(beforeSnapshot.snapshot, selection);
    const afterResolution = resolveCatalogSelection(afterSnapshot.snapshot, selection);
    expectOk(beforeResolution);
    expectOk(afterResolution);

    expect(beforeResolution.selection.addOns[0]!.lineDurationMinutes).toBe(50);
    expect(afterResolution.selection.addOns[0]!.lineDurationMinutes).toBe(60);

    const beforeFinalized = await finalizeCatalogResolutionFingerprint(beforeSnapshot.snapshot, beforeResolution.selection, hashCatalogFingerprintWebCrypto);
    const afterFinalized = await finalizeCatalogResolutionFingerprint(afterSnapshot.snapshot, afterResolution.selection, hashCatalogFingerprintWebCrypto);

    expect(beforeFinalized.revision.canonical).not.toBe(afterFinalized.revision.canonical);
    expect(beforeFinalized.revision.fingerprint).not.toBe(afterFinalized.revision.fingerprint);

    // Also exercise a QUANTITY-only change (same duration/price, different
    // requested quantity) against the SAME snapshot, to isolate quantity
    // specifically from duration.
    const qty3 = resolveCatalogSelection(beforeSnapshot.snapshot, { serviceId: 'svc_qty', selectedAddOns: [{ addOnId: 'addon_qty', quantity: 3 }] });
    const qty7 = resolveCatalogSelection(beforeSnapshot.snapshot, { serviceId: 'svc_qty', selectedAddOns: [{ addOnId: 'addon_qty', quantity: 7 }] });
    expectOk(qty3);
    expectOk(qty7);
    const qty3Finalized = await finalizeCatalogResolutionFingerprint(beforeSnapshot.snapshot, qty3.selection, hashCatalogFingerprintWebCrypto);
    const qty7Finalized = await finalizeCatalogResolutionFingerprint(beforeSnapshot.snapshot, qty7.selection, hashCatalogFingerprintWebCrypto);

    expect(qty3Finalized.revision.fingerprint).not.toBe(qty7Finalized.revision.fingerprint);
  });

  it('deterministic: the same resolved selection always finalizes to the same fingerprint', async () => {
    const snapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'svc_stable' })],
      addOnGroups: [],
      addOns: [makeFixtureAddOn({ id: 'addon_stable' })],
      serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_stable', serviceId: 'svc_stable', addOnId: 'addon_stable' })],
      rules: [],
    });
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_stable', selectedAddOns: [{ addOnId: 'addon_stable' }] });
    expectOk(resolution);

    const first = await finalizeCatalogResolutionFingerprint(snapshot.snapshot, resolution.selection, hashCatalogFingerprintWebCrypto);
    const second = await finalizeCatalogResolutionFingerprint(snapshot.snapshot, resolution.selection, hashCatalogFingerprintWebCrypto);

    expect(first.revision.fingerprint).toBe(second.revision.fingerprint);
  });

  it('browser (Web Crypto) and server (Node crypto) hashers agree byte-for-byte on the resolution fingerprint', async () => {
    const snapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [makeFixtureService({ id: 'svc_parity' })],
      addOnGroups: [],
      addOns: [makeFixtureAddOn({ id: 'addon_parity', pricingType: 'per_unit', maxQuantity: 10 })],
      serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_parity', serviceId: 'svc_parity', addOnId: 'addon_parity' })],
      rules: [],
    });
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_parity', selectedAddOns: [{ addOnId: 'addon_parity', quantity: 4 }] });
    expectOk(resolution);

    const webCryptoFinalized = await finalizeCatalogResolutionFingerprint(snapshot.snapshot, resolution.selection, hashCatalogFingerprintWebCrypto);
    const nodeFinalized = await finalizeCatalogResolutionFingerprint(snapshot.snapshot, resolution.selection, hashCatalogFingerprintNode);

    expect(webCryptoFinalized.revision.fingerprint).toBe(nodeFinalized.revision.fingerprint);

    // The wrapper's server-only convenience agrees too — same rails, same bytes.
    const wrapperFinalized = await finalizeCatalogResolutionFingerprintNode(snapshot.snapshot, resolution.selection);

    expect(wrapperFinalized.revision.fingerprint).toBe(webCryptoFinalized.revision.fingerprint);
  });

  it('familyId/selectedVariantId: legacy has no family, a parent booked directly IS its own family, a child carries its parent\'s familyId', () => {
    const snapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [
        makeFixtureService({ id: 'svc_legacy_id' }),
        makeFixtureService({ id: 'svc_family_parent' }),
        makeFixtureService({ id: 'svc_family_child', parentServiceId: 'svc_family_parent', variantLabel: 'Long' }),
      ],
      addOnGroups: [],
      addOns: [],
      serviceAddOnBindings: [],
      rules: [],
    });
    expectOk(snapshot);

    const legacyResolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_legacy_id', selectedAddOns: [] });
    const parentResolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_family_parent', selectedAddOns: [] });
    const childResolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_family_child', selectedAddOns: [] });
    expectOk(legacyResolution);
    expectOk(parentResolution);
    expectOk(childResolution);

    const legacyInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, legacyResolution.selection);
    const parentInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, parentResolution.selection);
    const childInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, childResolution.selection);

    // Legacy: no synthetic family — familyId is genuinely absent — but the
    // service's own identity still anchors selectedVariantId.
    expect(legacyInput.familyId).toBeNull();
    expect(legacyInput.selectedVariantId).toBe('svc_legacy_id');

    // Parent booked directly: the family IS itself.
    expect(parentInput.familyId).toBe('svc_family_parent');
    expect(parentInput.selectedVariantId).toBe('svc_family_parent');

    // Child: familyId points at the parent; selectedVariantId is the child's own id.
    expect(childInput.familyId).toBe('svc_family_parent');
    expect(childInput.selectedVariantId).toBe('svc_family_child');
  });

  it('explicitConfirmationMode: a legacy NULL row is null (never normalized to "instant"), an owner-set "instant" is NOT null, and a child inherits its parent\'s explicit mode', () => {
    const snapshot = buildPublicCatalogSnapshot({
      salonSettings: null,
      services: [
        makeFixtureService({ id: 'svc_legacy_null', confirmationMode: null }),
        makeFixtureService({ id: 'svc_explicit_instant', confirmationMode: 'instant' }),
        makeFixtureService({ id: 'svc_inherit_parent', confirmationMode: 'consultation' }),
        makeFixtureService({ id: 'svc_inherit_child', parentServiceId: 'svc_inherit_parent', variantLabel: 'X', confirmationMode: null }),
      ],
      addOnGroups: [],
      addOns: [],
      serviceAddOnBindings: [],
      rules: [],
    });
    expectOk(snapshot);

    const byId = new Map(snapshot.snapshot.services.map(s => [s.id, s]));

    // Both resolve to the SAME effective mode ('instant') — the point of
    // this test is that explicitConfirmationMode tells them apart anyway.
    expect(byId.get('svc_legacy_null')!.effectiveConfirmationMode).toBe('instant');
    expect(byId.get('svc_legacy_null')!.explicitConfirmationMode).toBeNull();

    expect(byId.get('svc_explicit_instant')!.effectiveConfirmationMode).toBe('instant');
    expect(byId.get('svc_explicit_instant')!.explicitConfirmationMode).toBe('instant');

    // Parent-inherited counts as explicit — it is real, deliberate owner
    // data, not the hardcoded default.
    expect(byId.get('svc_inherit_child')!.effectiveConfirmationMode).toBe('consultation');
    expect(byId.get('svc_inherit_child')!.explicitConfirmationMode).toBe('consultation');

    const legacyResolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_legacy_null', selectedAddOns: [] });
    const explicitResolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_explicit_instant', selectedAddOns: [] });
    expectOk(legacyResolution);
    expectOk(explicitResolution);

    const legacyInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, legacyResolution.selection);
    const explicitInput = buildCatalogResolutionFingerprintInput(snapshot.snapshot, explicitResolution.selection);

    expect(legacyInput.explicitConfirmationMode).toBeNull();
    expect(explicitInput.explicitConfirmationMode).toBe('instant');
  });
});
