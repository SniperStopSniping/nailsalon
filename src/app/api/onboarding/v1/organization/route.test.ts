import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  currentUser: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  requireEnabled: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn(async () => ({
    organizations: { createOrganization: mocks.createOrganization },
    users: { getOrganizationMembershipList: mocks.getOrganizationMembershipList },
  })),
  currentUser: mocks.currentUser,
}));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({
  OnboardingIntegrationDisabledError: class OnboardingIntegrationDisabledError extends Error {
    code = 'ONBOARDING_INTEGRATION_DISABLED';
  },
  requireOnboardingV1IntegrationEnabled: mocks.requireEnabled,
}));
vi.mock('@/features/onboarding-v1-integration/persistence.server', () => ({
  OnboardingPersistenceError: class OnboardingPersistenceError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

function organizationRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/v1/organization', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('POST /api/onboarding/v1/organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ id: 'user_1' });
    mocks.getOrganizationMembershipList.mockResolvedValue({ data: [] });
    mocks.createOrganization.mockResolvedValue({ id: 'org_new', name: 'Isla Nail Studio' });
  });

  it('accepts a pending session and creates one organization named after the salon', async () => {
    const response = await POST(organizationRequest({ businessName: 'Isla Nail Studio' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        created: true,
        organizations: [{ id: 'org_new', name: 'Isla Nail Studio' }],
      },
    });
    expect(mocks.currentUser).toHaveBeenCalledWith({ treatPendingAsSignedOut: false });
    expect(mocks.createOrganization).toHaveBeenCalledWith({
      createdBy: 'user_1',
      name: 'Isla Nail Studio',
    });
  });

  it('returns existing memberships without creating a duplicate organization', async () => {
    mocks.getOrganizationMembershipList.mockResolvedValue({
      data: [
        { organization: { id: 'org_a', name: 'Studio A' } },
        { organization: { id: 'org_b', name: 'Studio B' } },
      ],
    });

    const response = await POST(organizationRequest({ businessName: 'Ignored' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        created: false,
        organizations: [
          { id: 'org_a', name: 'Studio A' },
          { id: 'org_b', name: 'Studio B' },
        ],
      },
    });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request with 401', async () => {
    mocks.currentUser.mockResolvedValue(null);

    const response = await POST(organizationRequest({ businessName: 'Isla Nail Studio' }));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it('falls back to a neutral organization name when none is provided', async () => {
    mocks.createOrganization.mockResolvedValue({ id: 'org_new', name: 'My nail studio' });

    const response = await POST(organizationRequest({}));

    expect(response.status).toBe(200);
    expect(mocks.createOrganization).toHaveBeenCalledWith({
      createdBy: 'user_1',
      name: 'My nail studio',
    });
  });

  it('is dark when the integration flag is off', async () => {
    const { OnboardingIntegrationDisabledError } = await import(
      '@/features/onboarding-v1-integration/config.server'
    );
    mocks.requireEnabled.mockImplementation(() => {
      throw new OnboardingIntegrationDisabledError();
    });

    const response = await POST(organizationRequest({}));

    expect(response.status).toBe(404);
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });
});
