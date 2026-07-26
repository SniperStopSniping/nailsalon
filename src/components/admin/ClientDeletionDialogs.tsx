'use client';

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { AdminDetailCard } from '@/components/admin/AdminDetailCard';
import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';

export type ClientDeletionSuccess = {
  action: 'archive' | 'permanent-delete';
  code:
    | 'CLIENT_ARCHIVED'
    | 'CLIENT_ALREADY_ARCHIVED'
    | 'CLIENT_PERMANENTLY_DELETED';
  requestedClientId: string;
  terminalClientId: string;
};

type ClientDeletionDialogsProps = {
  salonSlug: string;
  requestedClientId: string;
  knownTerminalClientId: string;
  expectedUpdatedAt: string;
  onSuccess: (result: ClientDeletionSuccess) => void;
};

type ApiPayload = Record<string, unknown> | null;
type PendingAction = 'archive' | 'permanent-delete' | null;

const HISTORY_REJECTION_MESSAGE
  = 'This client has history and can’t be permanently deleted. Delete them from the active list instead.';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function nestedString(
  payload: ApiPayload,
  paths: string[][],
): string | null {
  for (const path of paths) {
    let current: unknown = payload;
    for (const segment of path) {
      current = recordValue(current)?.[segment];
    }
    if (typeof current === 'string' && current.trim()) {
      return current;
    }
  }
  return null;
}

function responseCode(payload: ApiPayload): string | null {
  return nestedString(payload, [
    ['data', 'code'],
    ['data', 'outcome', 'code'],
    ['data', 'outcome'],
    ['code'],
    ['error', 'code'],
  ]);
}

function responseTerminalClientId(
  payload: ApiPayload,
  fallback: string,
): string {
  return nestedString(payload, [
    ['data', 'terminalClientId'],
    ['data', 'clientId'],
    ['data', 'client', 'id'],
    ['terminalClientId'],
  ]) ?? fallback;
}

function archiveErrorMessage(code: string | null): string {
  switch (code) {
    case 'CLIENT_ARCHIVE_CONFLICT':
      return 'This client changed elsewhere. Close and reopen the client, then try again.';
    case 'CLIENT_HAS_ACTIVE_APPOINTMENT':
      return 'This client has an active or future appointment. Update that appointment before deleting the client.';
    case 'UNSUPPORTED_CLIENT_IDENTITY':
      return 'This client can’t be deleted right now. Refresh the client and try again.';
    default:
      return 'We couldn’t delete this client. Check your connection and try again.';
  }
}

function permanentDeleteErrorMessage(code: string | null): string {
  if (code === 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED') {
    return HISTORY_REJECTION_MESSAGE;
  }
  if (
    code === 'CLIENT_ARCHIVE_CONFLICT'
    || code === 'CLIENT_PERMANENT_DELETE_CONFLICT'
  ) {
    return 'This client changed elsewhere. Close and reopen the client, then try again.';
  }
  if (code === 'UNSUPPORTED_CLIENT_IDENTITY') {
    return 'This client can’t be permanently deleted right now. Refresh the client and try again.';
  }
  return 'We couldn’t permanently delete this client. Check your connection and try again.';
}

export function ClientDeletionDialogs({
  salonSlug,
  requestedClientId,
  knownTerminalClientId,
  expectedUpdatedAt,
  onSuccess,
}: ClientDeletionDialogsProps) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [permanentOpen, setPermanentOpen] = useState(false);
  const [permanentStep, setPermanentStep] = useState<'type' | 'confirm'>('type');
  const [confirmationText, setConfirmationText] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [permanentError, setPermanentError] = useState<string | null>(null);
  const [offerArchive, setOfferArchive] = useState(false);
  const submittingRef = useRef(false);

  const pending = pendingAction !== null;

  const openArchive = () => {
    if (submittingRef.current) {
      return;
    }
    setPermanentOpen(false);
    setPermanentStep('type');
    setConfirmationText('');
    setPermanentError(null);
    setOfferArchive(false);
    setArchiveError(null);
    setArchiveOpen(true);
  };

  const closeArchive = () => {
    if (submittingRef.current) {
      return;
    }
    setArchiveError(null);
    setArchiveOpen(false);
  };

  const openPermanent = () => {
    if (submittingRef.current) {
      return;
    }
    setArchiveOpen(false);
    setPermanentStep('type');
    setConfirmationText('');
    setPermanentError(null);
    setOfferArchive(false);
    setPermanentOpen(true);
  };

  const closePermanent = () => {
    if (submittingRef.current) {
      return;
    }
    setPermanentOpen(false);
    setPermanentStep('type');
    setConfirmationText('');
    setPermanentError(null);
    setOfferArchive(false);
  };

  const reportCommittedSuccess = (result: ClientDeletionSuccess) => {
    try {
      onSuccess(result);
    } catch {
      // The server mutation is committed. A parent render or cache failure must
      // not turn it into a misleading deletion error or invite a duplicate.
    }
  };

  const submitArchive = async () => {
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setPendingAction('archive');
    setArchiveError(null);

    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(requestedClientId)}/archive`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug, expectedUpdatedAt }),
        },
      );
      const payload = await response.json().catch(() => null) as ApiPayload;
      const code = responseCode(payload);
      if (
        !response.ok
        || (code !== 'CLIENT_ARCHIVED' && code !== 'CLIENT_ALREADY_ARCHIVED')
      ) {
        setArchiveError(archiveErrorMessage(code));
        return;
      }

      setArchiveOpen(false);
      reportCommittedSuccess({
        action: 'archive',
        code,
        requestedClientId,
        terminalClientId: responseTerminalClientId(
          payload,
          knownTerminalClientId,
        ),
      });
    } catch {
      setArchiveError(archiveErrorMessage(null));
    } finally {
      submittingRef.current = false;
      setPendingAction(null);
    }
  };

  const submitPermanentDelete = async () => {
    if (
      submittingRef.current
      || permanentStep !== 'confirm'
      || confirmationText !== 'DELETE'
    ) {
      return;
    }

    submittingRef.current = true;
    setPendingAction('permanent-delete');
    setPermanentError(null);
    setOfferArchive(false);

    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(requestedClientId)}/permanent-delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug, expectedUpdatedAt }),
        },
      );
      const payload = await response.json().catch(() => null) as ApiPayload;
      const code = responseCode(payload);
      if (!response.ok || code !== 'CLIENT_PERMANENTLY_DELETED') {
        setPermanentError(permanentDeleteErrorMessage(code));
        setOfferArchive(code === 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED');
        return;
      }

      setPermanentOpen(false);
      reportCommittedSuccess({
        action: 'permanent-delete',
        code,
        requestedClientId,
        terminalClientId: responseTerminalClientId(
          payload,
          knownTerminalClientId,
        ),
      });
    } catch {
      setPermanentError(permanentDeleteErrorMessage(null));
    } finally {
      submittingRef.current = false;
      setPendingAction(null);
    }
  };

  return (
    <>
      <AdminDetailCard
        className="mb-4 border border-red-100"
        contentClassName="space-y-4"
      >
        <div>
          <h2 className="text-[15px] font-semibold text-stone-900">
            Delete client
          </h2>
          <p className="mt-1 text-sm leading-5 text-stone-500">
            Remove this client from your active list while keeping their
            appointments, payments and history.
          </p>
        </div>

        <Button
          type="button"
          variant="destructive"
          size="lg"
          data-testid="client-delete-action"
          onClick={openArchive}
          className="min-h-11 w-full"
        >
          <Trash2 className="mr-2 size-4" />
          Delete client
        </Button>

        <details
          className="group rounded-2xl border border-stone-200 bg-stone-50"
          data-testid="client-deletion-advanced"
        >
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-stone-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
            Advanced
          </summary>
          <div className="border-t border-stone-200 p-4">
            <p className="text-sm leading-5 text-stone-600">
              Permanent deletion is only available for an empty client with no
              history.
            </p>
            <button
              type="button"
              data-testid="client-permanent-delete-action"
              onClick={openPermanent}
              className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
            >
              Delete permanently
            </button>
          </div>
        </details>
      </AdminDetailCard>

      <DialogShell
        isOpen={archiveOpen}
        onClose={closeArchive}
        closeOnBackdrop={!pending}
        closeOnEscape={!pending}
        alignClassName="items-end justify-center sm:items-center sm:p-4"
        maxWidthClassName="max-w-md"
        contentClassName="flex max-h-[calc(100vh-0.5rem)] min-h-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl supports-[height:100dvh]:max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl supports-[height:100dvh]:sm:max-h-[calc(100dvh-2rem)]"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-client-title"
          aria-describedby="archive-client-description"
          data-testid="client-archive-dialog"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto px-5 py-6 sm:px-6">
            <div className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-700">
              <Trash2 className="size-5" />
            </div>
            <h2
              id="archive-client-title"
              className="mt-4 text-xl font-semibold text-stone-950"
            >
              Delete client?
            </h2>
            <p
              id="archive-client-description"
              className="mt-2 text-sm leading-6 text-stone-600"
            >
              This client will be removed from your active client list. Their
              appointments, payments and history will be kept.
            </p>
            {archiveError && (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {archiveError}
              </div>
            )}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-stone-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <Button
              type="button"
              variant="brandSoft"
              onClick={closeArchive}
              disabled={pending}
              className="min-h-11 min-w-0"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="client-archive-confirm"
              onClick={() => void submitArchive()}
              disabled={pending}
              className="min-h-11 min-w-0"
            >
              {pendingAction === 'archive'
                ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Deleting…
                    </>
                  )
                : 'Delete client'}
            </Button>
          </div>
        </div>
      </DialogShell>

      <DialogShell
        isOpen={permanentOpen}
        onClose={closePermanent}
        closeOnBackdrop={!pending}
        closeOnEscape={!pending}
        alignClassName="items-end justify-center sm:items-center sm:p-4"
        maxWidthClassName="max-w-md"
        contentClassName="flex max-h-[calc(100vh-0.5rem)] min-h-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl supports-[height:100dvh]:max-h-[calc(100dvh-0.5rem)] sm:max-h-[calc(100vh-2rem)] sm:rounded-3xl supports-[height:100dvh]:sm:max-h-[calc(100dvh-2rem)]"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="permanent-delete-client-title"
          aria-describedby="permanent-delete-client-description"
          data-testid="client-permanent-delete-dialog"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto px-5 py-6 sm:px-6">
            <div className="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-700">
              <AlertTriangle className="size-5" />
            </div>
            <h2
              id="permanent-delete-client-title"
              className="mt-4 text-xl font-semibold text-stone-950"
            >
              {permanentStep === 'type'
                ? 'Delete permanently?'
                : 'Confirm permanent deletion'}
            </h2>
            <p
              id="permanent-delete-client-description"
              className="mt-2 text-sm leading-6 text-stone-600"
            >
              {permanentStep === 'type'
                ? 'Permanent deletion is only available for an empty client with no history. This cannot be undone.'
                : 'Luster will check again that this client has no history before deleting anything.'}
            </p>

            {permanentStep === 'type' && (
              <label
                className="mt-5 block text-sm font-medium text-stone-800"
                htmlFor="permanent-delete-client-confirmation"
              >
                Type
                {' '}
                <strong>DELETE</strong>
                {' '}
                to continue
                <input
                  id="permanent-delete-client-confirmation"
                  data-testid="client-permanent-delete-input"
                  value={confirmationText}
                  onChange={(event) => {
                    setConfirmationText(event.target.value);
                    setPermanentError(null);
                    setOfferArchive(false);
                  }}
                  disabled={pending}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-2 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base text-stone-950 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:bg-stone-100"
                />
              </label>
            )}

            {permanentStep === 'confirm' && (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-900">
                This permanently removes only the empty client profile. It
                cannot be restored.
              </div>
            )}

            {permanentError && (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {permanentError}
              </div>
            )}

            {offerArchive && (
              <button
                type="button"
                data-testid="client-permanent-delete-offer-archive"
                disabled={pending}
                onClick={openArchive}
                className="mt-4 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50"
              >
                Delete client instead
              </button>
            )}
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-stone-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <Button
              type="button"
              variant="brandSoft"
              onClick={closePermanent}
              disabled={pending}
              className="min-h-11 min-w-0"
            >
              Cancel
            </Button>
            {permanentStep === 'type'
              ? (
                  <Button
                    type="button"
                    variant="destructive"
                    data-testid="client-permanent-delete-continue"
                    disabled={confirmationText !== 'DELETE' || pending}
                    onClick={() => {
                      setPermanentError(null);
                      setOfferArchive(false);
                      setPermanentStep('confirm');
                    }}
                    className="min-h-11 min-w-0"
                  >
                    Continue
                  </Button>
                )
              : (
                  <Button
                    type="button"
                    variant="destructive"
                    data-testid="client-permanent-delete-confirm"
                    disabled={pending}
                    onClick={() => void submitPermanentDelete()}
                    className="min-h-11 min-w-0"
                  >
                    {pendingAction === 'permanent-delete'
                      ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Deleting…
                          </>
                        )
                      : 'Delete permanently'}
                  </Button>
                )}
          </div>
        </div>
      </DialogShell>
    </>
  );
}
