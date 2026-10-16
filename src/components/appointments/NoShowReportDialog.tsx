'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { NO_SHOW_REASONS, type NoShowReport } from '@/libs/noShowReporting';

export function NoShowReportDialog({ isOpen, startTime, timeZone, busy, error, onClose, onConfirm }: {
  isOpen: boolean;
  startTime: string;
  timeZone: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (report: NoShowReport) => Promise<'shared' | 'not_shared' | null>;
}) {
  const [reason, setReason] = useState<NoShowReport['reason'] | ''>('');
  const [explanation, setExplanation] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [result, setResult] = useState<'shared' | 'not_shared' | null>(null);
  const beforeStart = Date.now() < new Date(startTime).getTime();
  const close = () => {
    setReason('');
    setExplanation('');
    setPrivateNote('');
    setResult(null);
    onClose();
  };
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={result ? 'No-show saved' : 'Mark as no-show?'}
      description={result
        ? result === 'shared'
          ? 'The eligible record is now shared with participating Luster salons. Private notes and appointment details are not shared.'
          : 'The status was saved locally but was not shared. This booking does not currently meet the network eligibility, identity, history or platform requirements.'
        : beforeStart
          ? `Scheduled: ${new Date(startTime).toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}. Before start, record only a confirmed late cancellation or nonattendance. Existing deposit forfeiture rules apply.`
          : 'Record what happened. This frees the time slot and applies existing deposit forfeiture rules. Eligible history is shared without salon identity or private appointment details.'}
      confirmLabel={result ? 'Done' : 'Confirm no-show'}
      cancelLabel={result ? 'Close' : 'Go back'}
      busy={busy}
      confirmDisabled={!result && (!reason || (reason === 'other' && !explanation.trim()))}
      onClose={close}
      onConfirm={() => {
        if (result) {
          close();
        } else if (reason) {
          void onConfirm({ reason, ...(reason === 'other' ? { explanation } : {}), ...(privateNote.trim() ? { privateNote } : {}) }).then(setResult);
        }
      }}
    >
      {result
        ? <p role="status" className="text-sm text-neutral-700">You can correct a mistake in More → No-show records.</p>
        : (
            <div className="space-y-3">
              <fieldset className="min-w-0 space-y-2">
                <legend className="mb-2 text-sm font-medium text-neutral-900">Reason</legend>
                {NO_SHOW_REASONS.map(([value, label]) => {
                  const disabled = beforeStart && (value === 'did_not_attend' || value === 'other');
                  return (
                    <label key={value} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-neutral-200 p-3 text-sm text-neutral-900">
                      <input type="radio" name="no-show-reason" className="shrink-0" value={value} checked={reason === value} disabled={disabled || busy} onChange={() => setReason(value)} />
                      <span className={disabled ? 'min-w-0 break-words text-neutral-400' : 'min-w-0 break-words'}>
                        {label}
                        {disabled ? ' (available after start)' : ''}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              {reason === 'other' && (
                <label className="block text-sm text-neutral-900">
                  Explanation (required)
                  <textarea value={explanation} onChange={event => setExplanation(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-neutral-200 p-3" />
                </label>
              )}
              <details className="text-sm text-neutral-900">
                <summary className="min-h-11 cursor-pointer py-3">Add a private note (optional)</summary>
                <label className="block">
                  Private note
                  <textarea value={privateNote} onChange={event => setPrivateNote(event.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded-xl border border-neutral-200 p-3" />
                </label>
                <p className="mt-1 text-xs text-neutral-500">Only your salon and authorized Luster reviewers can see this note. It is not shared with other salons or the customer.</p>
              </details>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </div>
          )}
    </ConfirmDialog>
  );
}
