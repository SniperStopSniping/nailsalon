import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isSuperAdmin: vi.fn(), redirect: vi.fn(), select: vi.fn(), execute: vi.fn() }));
vi.mock('@/libs/superAdmin', () => ({ isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/libs/DB', () => ({ db: { select: mocks.select, execute: mocks.execute } }));
vi.mock('@/core/redis/redisClient', () => ({ redis: null, isRedisAvailable: vi.fn() }));
vi.mock('@/libs/resendHealth', () => ({ isResendSenderVerified: vi.fn() }));
vi.mock('./client', () => ({ SystemStatusClient: () => null }));

const { default: SystemStatusPage } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSuperAdmin.mockResolvedValue(false);
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});

it.each(['en', 'fr'])('requires platform sign-in before reading any system data (%s)', async (locale) => {
  await expect(SystemStatusPage({ params: Promise.resolve({ locale }) })).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledWith(`/${locale}/super-admin-login`);
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
});
