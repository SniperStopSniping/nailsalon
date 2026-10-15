'use client';

import { useEffect, useState } from 'react';

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
export function CustomDesignStudio({ salonSlug, revision, artifactId, disabled, aiEnabled, onSaved }: { salonSlug: string; revision: number; artifactId?: string; disabled: boolean; aiEnabled: boolean; onSaved: () => Promise<void> }) {
  const [state, setState] = useState<State | null>(null);
  const [source, setSource] = useState<CustomSiteSource | null>(null);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [startOver, setStartOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
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
      <h2>Custom design with AI</h2>
      <p>Show Luster your inspiration, or describe an original design. It builds an editable website around your business and booking system.</p>
      {reply && <p role="status">{reply}</p>}
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
      <details>
        <summary>Upload inspiration, a logo or your photographs</summary>
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
      </details>
      {state?.assets.length
        ? (
            <fieldset>
              <legend>References for this request (up to six)</legend>
              {state.assets.map(asset => (
                <label key={asset.id}>
                  <input type="checkbox" checked={selected.includes(asset.id)} disabled={!selected.includes(asset.id) && selected.length >= 6} onChange={event => setSelected(ids => event.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id))} />
                  {asset.name}
                  {' '}
                  ·
                  {asset.role === 'reference' ? 'Inspiration only' : 'Website asset'}
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
          <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={4000} rows={4} required placeholder="Use this Canva composition, my salon name and my photos. Make the mobile version less crowded." />
        </label>
        {artifactId && (
          <label>
            <input type="checkbox" checked={startOver} onChange={event => setStartOver(event.target.checked)} />
            Start over with an entirely new design
          </label>
        )}
        <button type="submit" disabled={disabled || !aiEnabled || !state?.configured || Boolean(busy) || pending || !message.trim()}>{artifactId ? 'Update my custom design' : 'Generate my custom website'}</button>
      </form>
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
                      Apply saved result without generating again
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
          <p>
            <strong>{state.payload.source.title}</strong>
            {' '}
            · Saved as draft
          </p>
          <p>{state.payload.source.analysis}</p>
          {state.payload.source.limitations.length > 0 && (
            <div>
              <strong>Design differences to review</strong>
              <ul>{state.payload.source.limitations.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          <div role="group" aria-label="Preview size">
            <button type="button" aria-pressed={previewSize === 'desktop'} onClick={() => setPreviewSize('desktop')}>Desktop preview</button>
            <button type="button" aria-pressed={previewSize === 'mobile'} onClick={() => setPreviewSize('mobile')}>Mobile preview</button>
          </div>
          {previewSize === 'desktop' && <p>Scroll sideways to inspect the full desktop layout.</p>}
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <div style={{ width: previewSize === 'mobile' ? 390 : 1280, maxWidth: previewSize === 'mobile' ? '100%' : undefined, margin: 'auto' }}>
              {state.rendererOrigin ? <CustomWebsiteFrame key={`${artifactId}-${revision}`} payload={state.payload} rendererOrigin={state.rendererOrigin} /> : <p>Your website preview is not available right now. Your design is saved. Please try again before publishing.</p>}
            </div>
          </div>
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
