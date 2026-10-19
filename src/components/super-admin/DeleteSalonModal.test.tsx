import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SALON_DELETION_RETAINED } from '@/models/salonDeletion';

import { DeleteSalonModal } from './DeleteSalonModal';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const IMPACT = {
  salon: { id: 'salon_1', name: 'Nail Salon No.5', slug: 'nail-salon-no5', deletedAt: null },
  tables: { appointment: 104, salon_client: 32, service: 15, fraud_signal: 1 },
  totalRows: 152,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof DeleteSalonModal>> = {}) {
  return render(
    <DeleteSalonModal
      isOpen
      onClose={vi.fn()}
      salonId="salon_1"
      salonName="Nail Salon No.5"
      salonSlug="nail-salon-no5"
      isDeleted={false}
      onSuccess={vi.fn()}
      {...overrides}
    />,
  );
}

describe('DeleteSalonModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(IMPACT), { status: 200 }));
  });

  it('puts a space between "Type" and the slug', async () => {
    renderModal({ isDeleted: true });

    // Regression: JSX stripped the newline after "Type", so the label rendered
    // as "Typenail-salon-no5 to confirm permanent deletion".
    const label = await screen.findByText(/to confirm permanent deletion/);

    expect(label).toHaveTextContent(/Type nail-salon-no5 to confirm/);
    expect(label).not.toHaveTextContent(/Typenail-salon-no5/);
  });

  it('offers archiving, not permanent deletion, for a salon that is still live', async () => {
    renderModal({ isDeleted: false });

    expect(await screen.findByText(/Marks the salon as deleted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive Salon/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Permanently/ })).not.toBeInTheDocument();
    expect(screen.getByText(/to confirm/)).toHaveTextContent(/Type DELETE to confirm/);
  });

  it('shows the real row counts a purge would remove', async () => {
    renderModal({ isDeleted: true });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/super-admin/organizations/salon_1/impact');
    });

    // The old modal showed a hardcoded category list; the operator now sees the
    // actual tables, biggest first, including the blocker that caused the bug.
    expect(await screen.findByText('152 rows:', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('appointment')).toBeInTheDocument();
    expect(screen.getByText('104')).toBeInTheDocument();
    expect(screen.getByText('fraud_signal')).toBeInTheDocument();
  });

  it('keeps the permanent delete button disabled until the slug matches exactly', async () => {
    const user = userEvent.setup();
    renderModal({ isDeleted: true });

    const button = await screen.findByRole('button', { name: /Delete Permanently/ });

    expect(button).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'nail-salon-no');

    expect(button).toBeDisabled();

    await user.type(screen.getByRole('textbox'), '5');

    expect(button).toBeEnabled();
  });

  it('never arms the button when the slug has not loaded yet', async () => {
    const user = userEvent.setup();
    // SalonDetailPanel passes `salon?.slug || ''` while the salon is loading.
    renderModal({ isDeleted: true, salonSlug: '' });

    const button = await screen.findByRole('button', { name: /Delete Permanently/ });

    expect(button).toBeDisabled();

    // An empty confirmation box must not satisfy an empty required string.
    await user.click(screen.getByRole('textbox'));

    expect(button).toBeDisabled();
  });

  it('sends the confirmation slug to the server for permanent deletion', async () => {
    const user = userEvent.setup();
    renderModal({ isDeleted: true });

    await screen.findByRole('button', { name: /Delete Permanently/ });
    await user.type(screen.getByRole('textbox'), 'nail-salon-no5');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await user.click(screen.getByRole('button', { name: /Delete Permanently/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/super-admin/organizations/salon_1?hard=true',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ confirmSlug: 'nail-salon-no5' }),
        }),
      );
    });
  });

  it('surfaces the server error instead of failing silently', async () => {
    const user = userEvent.setup();
    renderModal({ isDeleted: true });

    await screen.findByRole('button', { name: /Delete Permanently/ });
    await user.type(screen.getByRole('textbox'), 'nail-salon-no5');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Cannot delete salon: related records still reference it' }), {
        status: 409,
      }),
    );
    await user.click(screen.getByRole('button', { name: /Delete Permanently/ }));

    expect(
      await screen.findByText('Cannot delete salon: related records still reference it'),
    ).toBeInTheDocument();
  });
});

describe('deletion completion reporting', () => {
  const pending = { jobId: '00000000-0000-4000-8000-000000000001', status: 'pending', databaseDeleted: true, rowsDeleted: 152, mediaTotal: 2, mediaRemoved: 1, mediaRemaining: 1, reviewRequired: 0, attempts: 1, nextAttemptAt: '2026-10-19T12:00:00Z', retained: SALON_DELETION_RETAINED };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === 'DELETE'
      ? Response.json({ success: false, cleanup: pending }, { status: 202 })
      : Response.json(IMPACT));
  });

  it('keeps unfinished cleanup visible until acknowledged and shows retained records', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderModal({ isDeleted: true, onSuccess });

    expect(screen.queryByText(/Remove ALL data/)).not.toBeInTheDocument();
    expect(screen.getByText(/Required billing, payment/)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'nail-salon-no5');
    await user.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    const result = await screen.findByRole('status');

    expect(result).toHaveTextContent('Media cleanup is unfinished. Remaining references: 1.');
    expect(result).toHaveTextContent('People’s sign-in accounts');
    expect(result).toHaveTextContent('Existing events in Google Calendar');
    expect(result).toHaveTextContent('Database backups');
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Acknowledge and close' }));

    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('checks durable cleanup status without repeating the destructive delete', async () => {
    const user = userEvent.setup();
    renderModal({ isDeleted: true });
    await user.type(screen.getByRole('textbox'), 'nail-salon-no5');
    await user.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    await screen.findByRole('status');
    fetchMock.mockResolvedValueOnce(Response.json({ cleanup: { ...pending, status: 'completed', mediaRemoved: 2, mediaRemaining: 0 } }));
    await user.click(screen.getByRole('button', { name: 'Check cleanup status' }));

    expect(await screen.findByText('Tracked media cleanup is complete.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/super-admin/deletion-cleanup/${pending.jobId}`, { method: 'POST' });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
});
