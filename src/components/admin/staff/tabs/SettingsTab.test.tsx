import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}));

import { SettingsTab } from './SettingsTab';

describe('SettingsTab destructive action errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the real permanent-delete failure reason from the API', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'TECHNICIAN_HAS_HISTORY',
        message: 'This staff member has booking or client history and cannot be permanently removed. Disable them instead.',
      },
    }), { status: 409 }));

    render(
      <SettingsTab
        salonSlug="locked-salon"
        technician={{
          id: 'tech_1',
          name: 'Taylor',
          email: null,
          phone: '+15551234567',
          role: 'tech',
          skillLevel: 'standard',
          languages: null,
          commissionRate: 0.4,
          acceptingNewClients: true,
          notes: null,
          isActive: true,
          hiredAt: '2026-03-01T00:00:00.000Z',
          terminatedAt: null,
          onboardingStatus: 'active',
          userId: null,
        }}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Permanently Remove' }));
    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'delete' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(screen.getByText(
        'This staff member has booking or client history and cannot be permanently removed. Disable them instead.',
      )).toBeInTheDocument();
    });
  });
});
