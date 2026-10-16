'use client';

import { useRef, useState } from 'react';

/** Reset is an owner action; creating the next website is a separate request. */
export function StartOverDesign({ disabled, revision, onReset }: {
  disabled: boolean;
  revision: number;
  onReset: (upload: boolean, operationId: string, expectedRevision: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef<{ upload: boolean; operationId: string; expectedRevision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function reset(upload: boolean) {
    if (saving || (disabled && !attempt.current)) {
      return;
    }
    attempt.current ??= { upload, operationId: crypto.randomUUID(), expectedRevision: revision };
    setSaving(true);
    setError('');
    try {
      await onReset(attempt.current.upload, attempt.current.operationId, attempt.current.expectedRevision);
      dialog.current?.close();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'We could not start over. Your saved work is safe. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="setup-start-over"
        disabled={disabled}
        onClick={() => {
          attempt.current = null;
          setError('');
          dialog.current?.showModal();
        }}
      >
        ↻ Start over
      </button>
      <dialog
        ref={dialog}
        className="setup-attach-dialog"
        aria-labelledby="setup-start-over-title"
        aria-describedby="setup-start-over-description"
        onCancel={(event) => {
          if (saving) {
            event.preventDefault();
          }
        }}
      >
        <div className="setup-dialog-heading">
          <h2 id="setup-start-over-title">Start from scratch?</h2>
          <button type="button" aria-label="Close start over" disabled={saving} onClick={() => dialog.current?.close()}>×</button>
        </div>
        <p id="setup-start-over-description">Clear this chat, draft design and selected images. Start again with a new image or idea. Unfinished setup answers will reset; saved live business settings and bookings stay unchanged.</p>
        <p className="setup-fresh-note">Your previous draft will be saved so you can restore it. Starting over does not use AI credit.</p>
        {saving && <p role="status">Starting fresh…</p>}
        {error && <p role="alert">{error}</p>}
        <div className="setup-reset-actions">
          <button type="button" className="setup-add-files" disabled={saving} onClick={() => void reset(true)}>{saving ? 'Starting…' : attempt.current ? 'Retry start over' : 'Start fresh & upload image'}</button>
          {!attempt.current && <button type="button" disabled={saving} onClick={() => void reset(false)}>Start fresh with an idea</button>}
          <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>Cancel</button>
        </div>
      </dialog>
    </>
  );
}
