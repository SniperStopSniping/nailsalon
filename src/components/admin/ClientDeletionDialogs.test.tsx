import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClientDeletionDialogs,
  type ClientDeletionSuccess,
} from './ClientDeletionDialogs';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

const expectedUpdatedAt = '2026-07-25T15:30:00.123456Z';

function renderDeletionDialogs(
  onSuccess = vi.fn<(result: ClientDeletionSuccess) => void>(),
) {
  render(
    <ClientDeletionDialogs
      salonSlug="isla-nail-studio"
      requestedClientId="source_client"
      knownTerminalClientId="terminal_client"
      expectedUpdatedAt={expectedUpdatedAt}
      onSuccess={onSuccess}
    />,
  );
  return onSuccess;
}

async function openPermanentDelete() {
  const user = userEvent.setup();
  await user.click(screen.getByText('Advanced', { exact: true }));
  await user.click(screen.getByTestId('client-permanent-delete-action'));
  return user;
}

async function reachPermanentConfirmation() {
  const user = await openPermanentDelete();
  const input = await screen.findByTestId('client-permanent-delete-input');

  await user.type(input, 'DELETE');
  await user.click(screen.getByTestId('client-permanent-delete-continue'));

  return user;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ClientDeletionDialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows the approved archive confirmation and submits the exact CAS body', async () => {
    const user = userEvent.setup();
    const onSuccess = renderDeletionDialogs();
    fetchMock.mockResolvedValue(jsonResponse({
      data: {
        code: 'CLIENT_ARCHIVED',
        clientId: 'terminal_from_server',
      },
    }));

    await user.click(screen.getByTestId('client-delete-action'));

    const dialog = await screen.findByTestId('client-archive-dialog');

    expect(within(dialog).getByRole('heading', { name: 'Delete client?' }))
      .toBeInTheDocument();
    expect(within(dialog).getByText(
      'This client will be removed from your active client list. Their appointments, payments and history will be kept.',
    )).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' }))
      .toBeInTheDocument();

    await user.click(within(dialog).getByTestId('client-archive-confirm'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith({
        action: 'archive',
        code: 'CLIENT_ARCHIVED',
        requestedClientId: 'source_client',
        terminalClientId: 'terminal_from_server',
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/clients/source_client/archive',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'isla-nail-studio',
          expectedUpdatedAt,
        }),
      },
    );
    expect(screen.queryByTestId('client-archive-dialog'))
      .not.toBeInTheDocument();
  });

  it('requires exact typed confirmation and a separate second confirmation', async () => {
    const onSuccess = renderDeletionDialogs();
    fetchMock.mockResolvedValue(jsonResponse({
      data: {
        code: 'CLIENT_PERMANENTLY_DELETED',
        clientId: 'terminal_client',
      },
    }));

    const user = await openPermanentDelete();
    const input = await screen.findByTestId('client-permanent-delete-input');
    const continueButton = screen.getByTestId('client-permanent-delete-continue');

    expect(continueButton).toBeDisabled();

    await user.type(input, 'delete');

    expect(continueButton).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'DELETE');

    expect(continueButton).toBeEnabled();

    await user.click(continueButton);

    expect(screen.getByRole('heading', { name: 'Confirm permanent deletion' }))
      .toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('client-permanent-delete-confirm'));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        action: 'permanent-delete',
        code: 'CLIENT_PERMANENTLY_DELETED',
        requestedClientId: 'source_client',
        terminalClientId: 'terminal_client',
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/clients/source_client/permanent-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'isla-nail-studio',
          expectedUpdatedAt,
        }),
      },
    );
  });

  it('keeps a history rejection open and offers the normal archive flow', async () => {
    renderDeletionDialogs();
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
        message: 'hidden backend detail must not be rendered',
      },
    }, 409));

    const user = await reachPermanentConfirmation();
    await user.click(screen.getByTestId('client-permanent-delete-confirm'));

    const permanentDialog = await screen.findByTestId(
      'client-permanent-delete-dialog',
    );

    expect(within(permanentDialog).getByRole('alert')).toHaveTextContent(
      'This client has history and can’t be permanently deleted. Delete them from the active list instead.',
    );
    expect(within(permanentDialog).queryByText(/hidden backend detail/i))
      .not.toBeInTheDocument();

    await user.click(
      within(permanentDialog).getByTestId(
        'client-permanent-delete-offer-archive',
      ),
    );

    expect(await screen.findByTestId('client-archive-dialog'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('client-permanent-delete-dialog'))
      .not.toBeInTheDocument();
  });

  it('disables submission and ignores duplicate permanent-delete clicks', async () => {
    const pending = deferredResponse();
    renderDeletionDialogs();
    fetchMock.mockReturnValue(pending.promise);

    const user = await reachPermanentConfirmation();
    const confirmButton = screen.getByTestId(
      'client-permanent-delete-confirm',
    );

    await user.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(confirmButton).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(jsonResponse({
        data: {
          code: 'CLIENT_PERMANENTLY_DELETED',
          clientId: 'terminal_client',
        },
      }));
      await pending.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('client-permanent-delete-dialog'))
        .not.toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps recoverable errors actionable and allows a retry', async () => {
    const onSuccess = renderDeletionDialogs();
    fetchMock
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          code: 'CLIENT_PERMANENTLY_DELETED',
          clientId: 'terminal_client',
        },
      }));

    const user = await reachPermanentConfirmation();
    const confirmButton = screen.getByTestId(
      'client-permanent-delete-confirm',
    );
    await user.click(confirmButton);

    const dialog = await screen.findByTestId('client-permanent-delete-dialog');

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'We couldn’t permanently delete this client. Check your connection and try again.',
    );

    await waitFor(() => expect(confirmButton).toBeEnabled());

    expect(within(dialog).getByRole('button', { name: 'Cancel' }))
      .toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
