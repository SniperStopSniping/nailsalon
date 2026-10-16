'use client';

import { useRef, useState } from 'react';

import type { DesignBrief } from '@/features/custom-sites/contracts';

/** A fresh source revision, never a reset of the salon or its booking data. */
export function StartOverDesign({ salonSlug, revision, brief, disabled, missingDetails, onBusyChange, onSaved }: {
  salonSlug: string;
  revision: number;
  brief: DesignBrief;
  disabled: boolean;
  missingDetails: string[];
  onBusyChange: (busy: boolean) => void;
  onSaved: (generated: boolean) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState('');
  const [useReferences, setUseReferences] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{
    preferences: { expectedRevision: number; operationId: string; values: DesignBrief };
    generation: { expectedRevision: number; operationId: string; message: string; referenceIds: string[]; startOver: true };
    sent: boolean;
  } | null>(null);
  const endpoint = `/api/admin/custom-sites?salonSlug=${encodeURIComponent(salonSlug)}`;
  async function post(body: unknown) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? 'We could not finish your new design. Your previous design is safe.');
    }
    return result;
  }
  async function create() {
    if (saving || (!attempt.current && (disabled || !message.trim() || missingDetails.length))) {
      return;
    }
    if (!attempt.current) {
      const values: DesignBrief = useReferences ? brief : { ...brief, fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [] };
      attempt.current = {
        preferences: { expectedRevision: revision, operationId: crypto.randomUUID(), values },
        generation: { expectedRevision: revision, operationId: crypto.randomUUID(), message: message.trim(), referenceIds: [...values.referenceIds, ...values.websiteAssetIds], startOver: true },
        sent: false,
      };
    }
    const request = attempt.current;
    setSaving(true);
    setError('');
    onBusyChange(true);
    try {
      if (request.sent) {
        // A lost response must never launch another paid generation.
        await post({ action: 'resume', operationId: request.generation.operationId });
      } else {
        const saved = await post({ action: 'preferences', input: request.preferences });
        request.generation.expectedRevision = saved.head.revision.revision;
        request.sent = true;
        await post({ action: 'generate', input: request.generation });
      }
      await onSaved(true);
      dialog.current?.close();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Your previous design is safe. Check the saved result or try again later.');
      await onSaved(false).catch(() => {});
    } finally {
      setSaving(false);
      onBusyChange(false);
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
          setMessage('');
          setUseReferences(false);
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
          <h2 id="setup-start-over-title">Try a fresh design</h2>
          <button type="button" aria-label="Close start over" disabled={saving} onClick={() => dialog.current?.close()}>×</button>
        </div>
        <p id="setup-start-over-description">Your business details, services, prices and hours stay saved. Your current design stays until the new one is ready, and earlier designs remain available in Preview.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        >
          <label htmlFor="setup-fresh-design">Describe your new look</label>
          <textarea id="setup-fresh-design" value={message} onChange={event => setMessage(event.target.value)} rows={3} maxLength={4000} required disabled={saving || Boolean(attempt.current)} placeholder="A completely new look: cream and black, large photos, elegant lettering…" />
          {brief.referenceIds.length > 0 && (
            <label className="setup-attachment-permission">
              <input type="checkbox" checked={useReferences} onChange={event => setUseReferences(event.target.checked)} disabled={saving || Boolean(attempt.current)} />
              Use the reference images currently selected
            </label>
          )}
          <p className="setup-fresh-note">Your photos and logo stay available. To add a new reference, close this and use + in chat. This creates a draft for your review.</p>
          {missingDetails.length > 0 && <p role="status">{`First, tell Luster about ${missingDetails.join(', ')} in chat. You won’t need to enter them again.`}</p>}
          {saving && <p role="status" className="setup-thinking">Creating your new design… This may take a few minutes. Your current design is safe.</p>}
          {error && <p role="alert">{error}</p>}
          <div className="setup-fresh-actions">
            <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="setup-add-files" disabled={saving || (!attempt.current && (disabled || !message.trim() || missingDetails.length > 0))}>{saving ? 'Creating…' : attempt.current?.sent ? 'Check saved result' : 'Create new design'}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
