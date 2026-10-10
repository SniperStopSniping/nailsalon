import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  missing: vi.fn(),
  audit: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ currentUser: mocks.currentUser }));
vi.mock('@/libs/DB', () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock('@/libs/clerkIdentity.server', () => ({ isClerkUserMissing: mocks.missing }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: mocks.audit }));

/* eslint-disable import/first */
import { resolveClerkAdmin } from './adminAuth';
/* eslint-enable import/first */

const candidate = {
  id: 'existing-admin',
  email: 'owner@example.test',
  clerkUserId: 'previous-clerk-user',
  emailVerifiedAt: null,
};

function selectResult(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

describe('shared verified owner identity recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.currentUser.mockResolvedValue({
      id: 'current-clerk-user',
      emailAddresses: [{ emailAddress: ' Owner@Example.Test ', verification: { status: 'verified' } }],
    });
    mocks.select.mockReturnValueOnce(selectResult([])).mockReturnValue(selectResult([candidate]));
    mocks.missing.mockResolvedValue(false);
    mocks.returning.mockResolvedValue([{ ...candidate, clerkUserId: 'current-clerk-user' }]);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.audit.mockResolvedValue(undefined);
  });

  it('preserves an existing matching link without relinking or calling Clerk', async () => {
    mocks.select.mockReset().mockReturnValue(selectResult([{ ...candidate, clerkUserId: 'current-clerk-user' }]));

    expect(await resolveClerkAdmin('current-clerk-user')).toMatchObject({ id: 'existing-admin' });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(['other-session', 'unverified-email'] as const)('refuses recovery for %s', async (reason) => {
    mocks.currentUser.mockResolvedValue({
      id: reason === 'other-session' ? 'other-user' : 'current-clerk-user',
      emailAddresses: [{ emailAddress: 'owner@example.test', verification: { status: 'unverified' } }],
    });

    expect(await resolveClerkAdmin('current-clerk-user')).toBeNull();
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.missing).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not replace a different Clerk identity that still exists', async () => {
    expect(await resolveClerkAdmin('current-clerk-user')).toBeNull();
    expect(mocks.missing).toHaveBeenCalledWith('previous-clerk-user');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('fails closed when the previous identity cannot be checked', async () => {
    mocks.missing.mockRejectedValue(new Error('Provider unavailable'));

    expect(await resolveClerkAdmin('current-clerk-user')).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('repairs only a confirmed missing identity with a guarded update and audit record', async () => {
    mocks.missing.mockResolvedValue(true);

    expect(await resolveClerkAdmin('current-clerk-user')).toMatchObject({ id: 'existing-admin', clerkUserId: 'current-clerk-user' });
    expect(mocks.set).toHaveBeenCalledWith({ clerkUserId: 'current-clerk-user', emailVerifiedAt: expect.any(Date), updatedAt: expect.any(Date) });

    const guard = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);

    expect(guard.params).toEqual(['existing-admin', 'previous-clerk-user']);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'existing-admin',
      action: 'clerk_owner_relinked',
      metadata: { reason: 'verified_email_stale_identity' },
    }));
  });

  it('does not report a successful repair when another request changes the link first', async () => {
    mocks.missing.mockResolvedValue(true);
    mocks.returning.mockResolvedValue([]);

    expect(await resolveClerkAdmin('current-clerk-user')).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('keeps verified legacy email linking under a null-link guard', async () => {
    mocks.select.mockReset().mockReturnValueOnce(selectResult([])).mockReturnValue(selectResult([{ ...candidate, clerkUserId: null }]));

    expect(await resolveClerkAdmin('current-clerk-user')).toMatchObject({ id: 'existing-admin' });
    expect(mocks.missing).not.toHaveBeenCalled();

    const guard = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);

    expect(guard.sql).toContain('is null');
    expect(guard.params).toEqual(['existing-admin']);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'clerk_owner_linked', metadata: null }));
  });
});
