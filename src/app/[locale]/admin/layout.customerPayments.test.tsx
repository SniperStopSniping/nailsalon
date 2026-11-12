import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OwnerAdminLayout from './layout';

const mocks = vi.hoisted(() => ({ boundary: vi.fn(), gate: vi.fn(() => false) }));
vi.mock('@/libs/customerPayments/preparationGate', () => ({ isCustomerPaymentPreparationEnabled: mocks.gate }));
vi.mock('@/features/business-setup/access.server', () => ({ businessSetupSelfServeEnabled: () => false }));
vi.mock('@/features/section-library-v1/config.server', () => ({ isSectionLibraryV1Enabled: () => false }));
vi.mock('@/features/onboarding-v1-integration/config.server', () => ({ isOnboardingV1IntegrationEnabled: () => false }));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-owner-sans', className: 'font-owner-sans', style: { fontFamily: 'Inter' } }),
  Newsreader: () => ({ variable: '--font-owner-display', className: 'font-owner-display', style: { fontFamily: 'Newsreader' } }),
}));
vi.mock('./OwnerAdminClientBoundary', () => ({ OwnerAdminClientBoundary: (props: { children: React.ReactNode }) => {
  mocks.boundary(props);
  return <div>{props.children}</div>;
} }));

beforeEach(() => vi.clearAllMocks());

describe('server-provided payment draft flag', () => {
  it.each([false, true])('passes only server gate value %s', async (enabled) => {
    mocks.gate.mockReturnValue(enabled);
    render(await OwnerAdminLayout({ params: Promise.resolve({ locale: 'en' }), children: <p>Owner workspace</p> }));

    expect(mocks.boundary).toHaveBeenCalledWith(expect.objectContaining({ customerPaymentDraftsEnabled: enabled }));
  });
});
