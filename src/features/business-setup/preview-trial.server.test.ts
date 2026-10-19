import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupAiAvailableForSalon, setupPreviewTrialEnabled } from './access.server';
import { openPreviewTrial } from './preview-trial.server';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ transaction: vi.fn(), identity: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: { transaction: state.transaction } }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalonForSlug: vi.fn(), requireRealSalonOwner: vi.fn() }));
vi.mock('@/features/onboarding-v1-integration/persistence.server', () => ({ ensureOnboardingIdentityAdmin: state.identity }));
const owner = { clerkUserId: 'verified-user', email: 'verified@example.invalid', name: null, phoneE164: null };

beforeEach(() => vi.clearAllMocks());

afterEach(() => vi.unstubAllEnvs());

describe('isolated owner trial', () => {
  it('cannot be enabled in Production', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('BUSINESS_SETUP_PREVIEW_TRIAL', 'true');
    vi.stubEnv('BUSINESS_SETUP_AI_ENABLED', 'true');

    expect(setupPreviewTrialEnabled()).toBe(false);
    expect(setupAiAvailableForSalon(`ai_trial_${'a'.repeat(32)}`)).toBe(false);
    await expect(openPreviewTrial(owner)).rejects.toThrow('not available');
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it('refuses a mislabeled connection before creating an owner or salon', async () => {
    vi.stubEnv('APP_ENV', 'preview');
    vi.stubEnv('BUSINESS_SETUP_PREVIEW_TRIAL', 'true');
    state.transaction.mockImplementation(fn => fn({ execute: vi.fn().mockResolvedValue({ rows: [{ environment: 'production' }] }) }));

    await expect(openPreviewTrial(owner)).rejects.toThrow('isolated test database');
    expect(state.identity).not.toHaveBeenCalled();
  });

  it('keeps ordinary salons outside the trial allowlist', () => {
    vi.stubEnv('APP_ENV', 'preview');
    vi.stubEnv('BUSINESS_SETUP_PREVIEW_TRIAL', 'true');
    vi.stubEnv('BUSINESS_SETUP_AI_ENABLED', 'true');
    vi.stubEnv('BUSINESS_SETUP_SALON_ALLOWLIST', '');

    expect(setupAiAvailableForSalon('ordinary-salon')).toBe(false);
    expect(setupAiAvailableForSalon(`ai_trial_${'a'.repeat(32)}`)).toBe(true);
  });
});
