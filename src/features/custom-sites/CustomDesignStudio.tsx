'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { CustomSitePayload, CustomSiteSource } from './contracts';
import { CustomTextEditor } from './CustomTextEditor';
import { CustomWebsiteFrame } from './CustomWebsiteFrame';
import { GenerationEvidence } from './GenerationEvidence';

type State = {
  payload: CustomSitePayload | null;
  rendererOrigin: string | null;
  configured: boolean;
  assets: { id: string; name: string; role: string; mimeType: string }[];
  history: { id: string; title: string; createdAt: string; assetIds: string[] }[];
  attempts: { id: string; message: string; status: string; phase: string; recoverable: boolean; createdAt: string; artifactId: string | null; inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null }[];
};
export function CustomDesignStudio({ salonSlug, revision, artifactId, disabled, aiEnabled, onSaved, selected, setSelected, missingDetails, onContinueConversation, entryMode, onReadBusinessDetails }: { salonSlug: string; revision: number; artifactId?: string; disabled: boolean; aiEnabled: boolean; onSaved: () => Promise<void>; selected: string[]; setSelected: Dispatch<SetStateAction<string[]>>; missingDetails: string[]; onContinueConversation: () => void; entryMode?: 'upload' | 'describe' | null; onReadBusinessDetails?: (ids: string[]) => Promise<void> }) {
  const [state, setState] = useState<State | null>(null);
  const [source, setSource] = useState<CustomSiteSource | null>(null);
  const [message, setMessage] = useState('');
  const initializedSelection = useRef(false);
  const [startOver, setStartOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [uploadSource, setUploadSource] = useState<'own' | 'inspiration'>('inspiration');
  const [showUpload, setShowUpload] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  useEffect(() => {
    if (entryMode === 'upload') {
      setShowUpload(true);
    }
    if (entryMode === 'describe') {
      setShowBrief(true);
    }
  }, [entryMode]);
  useEffect(() => {
    if ((entryMode === 'upload' && showUpload) || (entryMode === 'describe' && showBrief)) {
      const frame = window.requestAnimationFrame(() => document.getElementById(entryMode === 'upload' ? 'custom-design-upload' : 'custom-design-brief')?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [entryMode, showUpload, showBrief]);
  const hasPreview = Boolean(state?.payload);
  const previewBox = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(680);
  useEffect(() => {
    const box = previewBox.current;
    if (!box || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(entries => setPreviewWidth(entries[0]?.contentRect.width ?? 680));
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasPreview]);
  const [previewSize, setPreviewSize] = useState<'desktop' | 'mobile'>('desktop');
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) {
      setPreviewSize('mobile');
    }
  }, []);
  const endpoint = `/api/admin/custom-sites?salonSlug=${encodeURIComponent(salonSlug)}`;
  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Your design could not be loaded.');
    }
    setState(data);
    setSource(data.payload?.source ?? null);
    if (!initializedSelection.current) {
      initializedSelection.current = true;
      // Unused uploads survive refresh/device changes in the private asset store.
      // Restore them visibly; consumed references are not silently reattached.
      const used = new Set((data.history as State['history']).flatMap(item => item.assetIds));
      const unused = (data.assets as State['assets']).filter(asset => !used.has(asset.id)).slice(0, 6);
      setSelected(unused.map(asset => asset.id));
      if (unused.length) {
        setMessage('Create my website from the selected inspiration, but make it even better.');
        setShowUpload(true);
        setShowBrief(true);
      }
    }
    if (data.head.revision.revision !== revision) {
      await onSaved();
    }
  }
  useEffect(() => {
    void load().catch(e => setError(e.message));
  }, [endpoint, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = state?.attempts.some(item => item.status === 'pending' && Date.now() - new Date(item.createdAt).getTime() < 300000);
  useEffect(() => {
    if (!busy && !pending) {
      return;
    }
    const timer = window.setInterval(() => {
      void load().catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [busy, pending, endpoint]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await work();
      await onSaved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
      // A lost response may follow a committed result. Read it before offering
      // a new paid generation. The server keeps the original operation ID.
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  }
  async function post(body: unknown) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? 'The design could not be saved.');
    }
    return result;
  }
  const current = state?.history.find(item => item.id === artifactId);
  return (
    <div id="custom-design" className="custom-design-studio">
      {!artifactId && !entryMode && !state?.assets.length && (
        <div className="setup-preview-empty">
          <span aria-hidden="true">✦</span>
          <h3>A website that feels like you.</h3>
          <p>Choose how you’d like to start above. Your design will take shape here, with your services and booking details already connected.</p>
        </div>
      )}
      {state && !state.configured && <p role="status">AI is not connected yet. Your business details, uploads and saved designs are safe. You can keep using the manual controls.</p>}
      {error && (
        <p role="alert">
          {error}
          {' '}
          <button type="button" onClick={() => void action('Loading saved design…', load)}>Reload saved design</button>
        </p>
      )}
      {(busy || pending) && (
        <p role="status">
          {state?.attempts[0]?.phase === 'repairing' ? 'Correcting the design after its automatic checks…' : busy || 'Your design is still being created…'}
          {' '}
          Your published website stays unchanged. You can return to your saved design after this finishes.
        </p>
      )}
      {state?.payload && (
        <div className="studio-preview">
          <p>
            <strong>{state.payload.source.title}</strong>
            {' '}
            · Saved as draft
          </p>
          <details>
            <summary>About this design</summary>
            <p>{state.payload.source.analysis}</p>
          </details>
          {state.payload.source.limitations.length > 0 && (
            <div>
              <strong>Design differences to review</strong>
              <ul>{state.payload.source.limitations.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          <div role="group" aria-label="Preview size">
            <button type="button" aria-pressed={previewSize === 'desktop'} onClick={() => setPreviewSize('desktop')}>Desktop preview</button>
            <button type="button" aria-pressed={previewSize === 'mobile'} onClick={() => setPreviewSize('mobile')}>Mobile preview</button>
            <a href={`/admin/business-setup/design-preview/${encodeURIComponent(salonSlug)}?revision=${revision}`} target="_blank" rel="noreferrer">Open full preview</a>
          </div>
          <div ref={previewBox} className="studio-frame-wrap">
            <div style={{ width: previewSize === 'mobile' ? 390 : 1280, maxWidth: previewSize === 'mobile' ? '100%' : undefined, zoom: previewSize === 'desktop' ? Math.min(1, previewWidth / 1280) : 1, margin: 'auto' }}>
              {state.rendererOrigin ? <CustomWebsiteFrame key={`${artifactId}-${revision}`} payload={state.payload} rendererOrigin={state.rendererOrigin} /> : <p>Your website preview is not available right now. Your design is saved. Please try again before publishing.</p>}
            </div>
          </div>
        </div>
      )}
      <details className="studio-step" open={showUpload} onToggle={event => setShowUpload(event.currentTarget.open)}>
        <summary>
          Your images & inspiration
          <span>Add a design, menu or photographs</span>
        </summary>
        <section id="custom-design-upload" className="custom-design-upload" tabIndex={-1} aria-labelledby="custom-design-upload-title">
          <h3 id="custom-design-upload-title">Upload an image</h3>
          <p>Is this your business, or a style you love?</p>
          <div className="studio-source-options" role="group" aria-label="What is in your upload?">
            <button type="button" aria-pressed={uploadSource === 'own'} onClick={() => setUploadSource('own')}>
              <strong>My own business</strong>
              <span>Read my name, services, prices and hours.</span>
            </button>
            <button type="button" aria-pressed={uploadSource === 'inspiration'} onClick={() => setUploadSource('inspiration')}>
              <strong>Style inspiration</strong>
              <span>Use the look, with my business details.</span>
            </button>
          </div>
          {uploadSource === 'own' && <p className="studio-hint">Already written in your image? Leave those details for now. Upload it, then let Luster read them for your review.</p>}
          <form onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void action('Checking and saving your upload…', async () => {
              data.set('rightsConfirmed', data.get('rightsConfirmed') === 'on' ? 'true' : 'false');
              const response = await fetch(endpoint, { method: 'POST', body: data });
              const result = await response.json();
              if (!response.ok) {
                throw new Error(result.error ?? 'The upload failed.');
              }
              setSelected(ids => [...ids.slice(-5), result.asset.id]);
              setReply('Your image is saved and selected. Describe what you like below, then choose Create my website. You can also ask Luster in Conversation.');
              setMessage(current => current || 'Create my website from the selected inspiration, but make it even better.');
              setShowBrief(true);
            });
          }}
          >
            <label>
              Use this as
              <select name="role">
                <option value="reference">Design inspiration</option>
                <option value="photo">My website photograph</option>
                <option value="logo">My logo</option>
              </select>
            </label>
            <label>
              PNG, JPG, WebP or PDF · up to 3 MB
              <input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" required />
            </label>
            <label>
              <input type="checkbox" name="rightsConfirmed" required />
              I may use this file. Other businesses’ content is for inspiration only.
            </label>
            <button type="submit" disabled={disabled || Boolean(busy)}>Upload</button>
          </form>
          {uploadSource === 'own' && selected.length > 0 && onReadBusinessDetails && (
            <div className="studio-read-details">
              <p>Does your image include your salon’s details? I can read them, then we’ll check them together.</p>
              <button type="button" disabled={disabled || !aiEnabled || Boolean(busy)} onClick={() => void action('Reading your business details…', () => onReadBusinessDetails(selected))}>Read my business details</button>
              <button type="button" onClick={onContinueConversation}>I’ll tell Luster instead</button>
            </div>
          )}
        </section>
      </details>
      {reply && <p role="status" className="setup-notice">{reply}</p>}
      <details className="studio-step" open={showBrief} onToggle={event => setShowBrief(event.currentTarget.open)}>
        <summary>
          Your design direction
          <span>Tell us what you like</span>
        </summary>
        <form onSubmit={(event) => {
          event.preventDefault();
          void action('Studying your references and writing your website…', async () => {
            const result = await post({ action: 'generate', input: { expectedRevision: revision, operationId: crypto.randomUUID(), message, referenceIds: selected, startOver } });
            setReply(result.reply ?? 'Your new design is saved as a draft. Review it before publishing.');
            setMessage('');
            setStartOver(false);
          });
        }}
        >
          <label>
            What do you like about your references, or what should change?
            <textarea id="custom-design-brief" value={message} onChange={event => setMessage(event.target.value)} maxLength={4000} rows={4} required placeholder="Something warm and elegant. Cream backgrounds, bold photography and a little personality…" />
          </label>
          {artifactId && (
            <label>
              <input type="checkbox" checked={startOver} onChange={event => setStartOver(event.target.checked)} />
              Start over with an entirely new design
            </label>
          )}
          <p>{selected.length ? `${selected.length} uploaded file(s) will be used for this request.` : 'Describe your idea, or select an uploaded image below.'}</p>
          {missingDetails.length > 0 && (
            <div className="setup-notice">
              <p>{`Before creating your website, Luster needs ${missingDetails.join(', ')}. You can tell us in the conversation or read them from your own uploaded design.`}</p>
              <button type="button" onClick={onContinueConversation}>Continue with Luster</button>
            </div>
          )}
          <button type="submit" disabled={disabled || !aiEnabled || !state?.configured || Boolean(busy) || pending || !message.trim() || missingDetails.length > 0}>{busy.includes('writing your website') || pending ? 'Creating your website…' : 'Create my website'}</button>
        </form>
      </details>
      {state?.assets.length
        ? (
            <fieldset className="studio-assets">
              <legend>References for this request (up to six)</legend>
              {state.assets.map(asset => (
                <label key={asset.id}>
                  <input type="checkbox" checked={selected.includes(asset.id)} disabled={!selected.includes(asset.id) && selected.length >= 6} onChange={event => setSelected(ids => event.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id))} />
                  {asset.name}
                  {' '}
                  ·
                  {asset.role === 'reference' ? 'Design reference' : 'Website asset'}
                  {asset.mimeType.startsWith('image/') && (
                    // Private authenticated asset endpoint; never an external URL.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${endpoint}&asset=${asset.id}`} alt={`${asset.name} reference`} style={{ display: 'block', maxWidth: 180, maxHeight: 140, objectFit: 'contain' }} />
                  )}
                </label>
              ))}
            </fieldset>
          )
        : null}
      {state?.attempts.length
        ? (
            <details>
              <summary>Saved design conversation</summary>
              {[...state.attempts].reverse().map(attempt => (
                <div key={attempt.id}>
                  <p>
                    <strong>You:</strong>
                    {' '}
                    {attempt.message}
                  </p>
                  <p>{attempt.status === 'completed' ? 'Design saved for review.' : attempt.status === 'generated' ? 'Design generated; reload or retry to apply it.' : attempt.status === 'pending' ? Date.now() - new Date(attempt.createdAt).getTime() < 300000 ? 'Generation in progress. Reload to check for a result.' : 'This attempt was interrupted. Your saved design is safe; you can start a new attempt.' : 'This attempt did not finish. Your earlier design is safe.'}</p>
                  {attempt.status !== 'completed' && attempt.recoverable && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void action('Applying your saved design…', async () => {
                        await post({ action: 'resume', operationId: attempt.id });
                      })}
                    >
                      Check and apply saved result without generating again
                    </button>
                  )}
                  <GenerationEvidence endpoint={endpoint} operationId={attempt.id} />
                </div>
              ))}
            </details>
          )
        : null}
      {state?.payload && (
        <>
          <details>
            <summary>Edit website source</summary>
            <p>HTML, CSS and interactions stay editable. Saving creates a new draft version.</p>
            {source && <CustomTextEditor source={source} onChange={setSource} />}
            {source && (
              <form onSubmit={(event) => {
                event.preventDefault();
                void action('Validating and saving your design…', async () => {
                  await post({ action: 'save', input: { expectedRevision: revision, operationId: crypto.randomUUID(), source, assetIds: current?.assetIds ?? [] } });
                });
              }}
              >
                <label>
                  Design name
                  <input value={source.title} onChange={event => setSource({ ...source, title: event.target.value })} maxLength={100} />
                </label>
                {(['html', 'css', 'javascript'] as const).map(file => (
                  <label key={file}>
                    {file === 'javascript' ? 'Visual interactions (isolated worker)' : file.toUpperCase()}
                    <textarea aria-label={file === 'javascript' ? 'Visual interactions (isolated worker)' : file.toUpperCase()} spellCheck={false} value={source[file]} onChange={event => setSource({ ...source, [file]: event.target.value })} rows={12} />
                  </label>
                ))}
                <button type="submit" disabled={disabled || Boolean(busy)}>Save design changes</button>
              </form>
            )}
          </details>
          <details>
            <summary>Previous designs</summary>
            {state.history.map(item => (
              <p key={item.id}>
                {item.title}
                {' '}
                <button
                  type="button"
                  disabled={disabled || Boolean(busy) || item.id === artifactId}
                  onClick={() => void action('Restoring this design as a new draft…', async () => {
                    await post({ action: 'restore', input: { expectedRevision: revision, operationId: crypto.randomUUID(), artifactId: item.id } });
                  })}
                >
                  Restore as draft
                </button>
              </p>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
