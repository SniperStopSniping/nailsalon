/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  archiveSalonClient,
  getClientDependencySummary,
  getClientMergePreview,
  mergeSalonClients,
  permanentlyDeleteSalonClient,
  requireClientManagerSalon,
  restoreSalonClient,
} = vi.hoisted(() => ({
  archiveSalonClient: vi.fn(),
  getClientDependencySummary: vi.fn(),
  getClientMergePreview: vi.fn(),
  mergeSalonClients: vi.fn(),
  permanentlyDeleteSalonClient: vi.fn(),
  requireClientManagerSalon: vi.fn(),
  restoreSalonClient: vi.fn(),
}));

vi.mock('@/libs/clientManagementAuth', () => ({
  requireClientManagerSalon,
}));

vi.mock('@/libs/clientLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/clientLifecycle')>();
  return {
    ...actual,
    archiveSalonClient,
    getClientDependencySummary,
    getClientMergePreview,
    mergeSalonClients,
    permanentlyDeleteSalonClient,
    restoreSalonClient,
  };
});

vi.mock('server-only', () => ({}));

import { ClientLifecycleError } from '@/libs/clientLifecycle';

import { POST as archiveClient } from './archive/route';
import { POST as previewMerge } from './merge/preview/route';
import { POST as mergeClient } from './merge/route';
import { POST as restoreClient } from './restore/route';
import { DELETE as permanentlyDeleteClient } from './route';

const primaryVersion = '2026-07-20T12:00:00.000Z';
const duplicateVersion = '2026-07-20T13:00:00.000Z';
const managerGuard = {
  ok: true as const,
  salon: {
    id: 'salon_1',
    slug: 'salon-one',
  },
  actor: {
    id: 'admin_1',
    role: 'owner' as const,
  },
};

const emptyCounts = {
  appointments: 0,
  payments: 0,
  communications: 0,
  campaigns: 0,
  communicationConsents: 0,
  rewards: 0,
  referrals: 0,
  reviews: 0,
  photos: 0,
  preferences: 0,
  notes: 0,
  fraudSignals: 0,
  contactAliases: 0,
  mergedProfiles: 0,
  profileState: 0,
};

function clientFixture(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    fullName: id === 'client_primary' ? 'Ava Primary' : 'Ava Duplicate',
    phone: id === 'client_primary' ? '14165550101' : '14165550102',
    email: `${id}@example.com`,
    birthday: null,
    preferredTechnicianId: null,
    notes: null,
    sensitivities: null,
    nailPreferences: {},
    tags: [],
    rebookIntervalDays: null,
    adminFlags: {},
    isBlocked: false,
    blockedReason: null,
    archivedAt: null,
    mergedIntoClientId: null,
    updatedAt: new Date(
      id === 'client_primary' ? primaryVersion : duplicateVersion,
    ),
    ...overrides,
  };
}

function jsonRequest(path: string, body: unknown, method = 'POST'): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('client lifecycle action routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireClientManagerSalon.mockResolvedValue(managerGuard);
  });

  it('previews a same-salon merge without doing any browser-side aggregation', async () => {
    getClientMergePreview.mockResolvedValue({
      primary: {
        client: clientFixture('client_primary'),
        aliases: {
          phones: ['14165550101'],
          emails: ['client_primary@example.com'],
        },
        records: {
          upcomingAppointments: 1,
          completedAppointments: 3,
          otherAppointments: 0,
          paymentRecords: 3,
          paymentsReceivedCents: 24000,
          completedValueCents: 30000,
          completedOutstandingCents: 6000,
          unresolvedCompletedBalances: 0,
          notes: 1,
          photos: 2,
          preferences: 1,
          communications: 4,
          campaigns: 1,
          rewards: 2,
          reviews: 1,
          fraudSignals: 0,
        },
        externalPreferences: [],
      },
      duplicate: {
        client: clientFixture('client_duplicate'),
        aliases: {
          phones: ['14165550102'],
          emails: ['client_duplicate@example.com'],
        },
        records: {
          upcomingAppointments: 2,
          completedAppointments: 1,
          otherAppointments: 1,
          paymentRecords: 1,
          paymentsReceivedCents: 8000,
          completedValueCents: 8000,
          completedOutstandingCents: 0,
          unresolvedCompletedBalances: 0,
          notes: 2,
          photos: 1,
          preferences: 1,
          communications: 2,
          campaigns: 0,
          rewards: 1,
          reviews: 1,
          fraudSignals: 1,
        },
        externalPreferences: [],
      },
      conflicts: [{
        field: 'phone',
        primaryValue: '14165550101',
        duplicateValue: '14165550102',
        defaultSelection: 'primary',
      }],
    });

    const response = await previewMerge(
      jsonRequest('/api/admin/clients/client_primary/merge/preview', {
        salonSlug: 'salon-one',
        duplicateClientId: 'client_duplicate',
      }),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(getClientMergePreview).toHaveBeenCalledWith({
      salonId: 'salon_1',
      primaryClientId: 'client_primary',
      duplicateClientId: 'client_duplicate',
    });
    expect(body.data.preview.recordCounts).toMatchObject({
      upcomingAppointments: 2,
      completedAppointments: 1,
      paymentRecords: 1,
      rewards: 1,
    });
    expect(body.data.preview.conflicts).toEqual([{
      field: 'phone',
      primaryValue: '14165550101',
      duplicateValue: '14165550102',
      defaultSelection: 'primary',
    }]);
    expect(body.data.preview.versions).toEqual({
      primary: primaryVersion,
      duplicate: duplicateVersion,
    });
  });

  it('forwards explicit conflict selections and both stale-state versions to merge', async () => {
    mergeSalonClients.mockResolvedValue({
      primary: clientFixture('client_primary', {
        email: 'client_duplicate@example.com',
      }),
      duplicate: clientFixture('client_duplicate', {
        archivedAt: new Date('2026-07-21T00:00:00.000Z'),
        mergedIntoClientId: 'client_primary',
      }),
      idempotent: false,
    });

    const selections = {
      fullName: 'primary',
      phone: 'primary',
      email: 'duplicate',
      birthday: 'duplicate',
      nailPreferences: 'primary',
      notes: 'duplicate',
    };
    const response = await mergeClient(
      jsonRequest('/api/admin/clients/client_primary/merge', {
        salonSlug: 'salon-one',
        primaryClientId: 'client_primary',
        duplicateClientId: 'client_duplicate',
        expectedPrimaryUpdatedAt: primaryVersion,
        expectedDuplicateUpdatedAt: duplicateVersion,
        selections,
      }),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mergeSalonClients).toHaveBeenCalledWith({
      salonId: 'salon_1',
      primaryClientId: 'client_primary',
      duplicateClientId: 'client_duplicate',
      expectedPrimaryUpdatedAt: primaryVersion,
      expectedDuplicateUpdatedAt: duplicateVersion,
      actor: managerGuard.actor,
      selections,
    });
    expect(body.data).toMatchObject({
      primaryClientId: 'client_primary',
      primary: {
        id: 'client_primary',
        email: 'client_duplicate@example.com',
      },
      duplicate: {
        id: 'client_duplicate',
        mergedIntoClientId: 'client_primary',
      },
      idempotent: false,
    });
  });

  it('rejects a mismatched primary id before authorization or service access', async () => {
    const response = await mergeClient(
      jsonRequest('/api/admin/clients/client_primary/merge', {
        salonSlug: 'salon-one',
        primaryClientId: 'different_client',
        duplicateClientId: 'client_duplicate',
        expectedPrimaryUpdatedAt: primaryVersion,
        expectedDuplicateUpdatedAt: duplicateVersion,
      }),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );

    expect(response.status).toBe(400);
    expect(requireClientManagerSalon).not.toHaveBeenCalled();
    expect(mergeSalonClients).not.toHaveBeenCalled();
  });

  it('does not disclose a foreign-salon client when the tenant guard denies access', async () => {
    requireClientManagerSalon.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: 'NOT_FOUND', message: 'Client not found' } },
        { status: 404 },
      ),
    });

    const response = await previewMerge(
      jsonRequest('/api/admin/clients/client_foreign/merge/preview', {
        salonSlug: 'foreign-salon',
        duplicateClientId: 'duplicate_foreign',
      }),
      { params: Promise.resolve({ id: 'client_foreign' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Client not found',
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/client_foreign|duplicate_foreign|phone|email/);
    expect(getClientMergePreview).not.toHaveBeenCalled();
  });

  it('maps a same-salon missing merge participant to a non-disclosing 404', async () => {
    getClientMergePreview.mockRejectedValue(
      new ClientLifecycleError('CLIENT_NOT_FOUND', 'Client not found'),
    );

    const response = await previewMerge(
      jsonRequest('/api/admin/clients/client_primary/merge/preview', {
        salonSlug: 'salon-one',
        duplicateClientId: 'client_unknown',
      }),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'CLIENT_NOT_FOUND',
        message: 'Client not found',
      },
    });
  });

  it('archives a client and reports hard-delete eligibility from canonical dependencies', async () => {
    archiveSalonClient.mockResolvedValue(clientFixture('client_primary', {
      archivedAt: new Date('2026-07-22T00:00:00.000Z'),
      updatedAt: new Date('2026-07-22T00:00:01.000Z'),
    }));
    getClientDependencySummary.mockResolvedValue({
      clientId: 'client_primary',
      hasExternalClientIdentity: false,
      counts: emptyCounts,
      hardDeleteEligible: true,
    });

    const response = await archiveClient(
      jsonRequest('/api/admin/clients/client_primary/archive', {
        salonSlug: 'salon-one',
        expectedUpdatedAt: primaryVersion,
      }),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(archiveSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'client_primary',
      expectedUpdatedAt: primaryVersion,
      actor: managerGuard.actor,
    });
    expect(getClientDependencySummary).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'client_primary',
    });
    expect(body.data.canPermanentlyDelete).toBe(true);
    expect(body.data.client.archivedAt).toBe('2026-07-22T00:00:00.000Z');
  });

  it('restores an archived client through the owner/admin guard', async () => {
    restoreSalonClient.mockResolvedValue(clientFixture('client_primary', {
      updatedAt: new Date('2026-07-23T00:00:00.000Z'),
    }));

    const response = await restoreClient(
      jsonRequest('/api/admin/clients/client_primary/restore', {
        salonSlug: 'salon-one',
        expectedUpdatedAt: primaryVersion,
      }),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(restoreSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'client_primary',
      expectedUpdatedAt: primaryVersion,
      actor: managerGuard.actor,
    });
    expect(body.data).toMatchObject({
      client: {
        id: 'client_primary',
        archivedAt: null,
      },
      canPermanentlyDelete: false,
    });
  });

  it('permanently deletes only after the server-side eligibility check succeeds', async () => {
    permanentlyDeleteSalonClient.mockResolvedValue({
      deleted: true,
      clientId: 'client_primary',
    });

    const response = await permanentlyDeleteClient(
      jsonRequest('/api/admin/clients/client_primary', {
        salonSlug: 'salon-one',
        expectedUpdatedAt: primaryVersion,
      }, 'DELETE'),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );

    expect(response.status).toBe(200);
    expect(permanentlyDeleteSalonClient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'client_primary',
      expectedUpdatedAt: primaryVersion,
      actor: managerGuard.actor,
    });
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: true,
        clientId: 'client_primary',
      },
    });
  });

  it('returns dependency evidence when permanent deletion is protected by history', async () => {
    const dependencies = {
      clientId: 'client_primary',
      hasExternalClientIdentity: false,
      counts: {
        ...emptyCounts,
        appointments: 2,
        payments: 1,
      },
      hardDeleteEligible: false,
    };
    permanentlyDeleteSalonClient.mockRejectedValue(
      new ClientLifecycleError(
        'CLIENT_HAS_HISTORY',
        'Clients with history cannot be permanently deleted',
        { dependencies },
      ),
    );

    const response = await permanentlyDeleteClient(
      jsonRequest('/api/admin/clients/client_primary', {
        salonSlug: 'salon-one',
        expectedUpdatedAt: primaryVersion,
      }, 'DELETE'),
      { params: Promise.resolve({ id: 'client_primary' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'CLIENT_HAS_HISTORY',
        message: 'Clients with history cannot be permanently deleted',
      },
      data: {
        dependencies,
      },
    });
  });
});
