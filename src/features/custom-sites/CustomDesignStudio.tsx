'use client';

import { useEffect, useState } from 'react';

import type { CustomSitePayload, CustomSiteSource } from './contracts';
import { CustomTextEditor } from './CustomTextEditor';
import { CustomWebsiteFrame } from './CustomWebsiteFrame';

type State = {
  payload: CustomSitePayload | null;
  rendererOrigin: string | null;
  assets: { id: string; name: string; role: string; mimeType: string }[];
  history: { id: string; title: string; createdAt: string; assetIds: string[] }[];
  attempts: { id: string; message: string; status: string; artifactId: string | null; inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null }[];
};
export function CustomDesignStudio({ salonSlug, revision, artifactId, disabled, aiEnabled, onSaved }: { salonSlug: string; revision: number; artifactId?: string; disabled: boolean; aiEnabled: boolean; onSaved: () => Promise<void> }) {
  const [state, setState] = useState<State | null>(null);
  const [source, setSource] = useState<CustomSiteSource | null>(null);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [startOver, setStartOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const endpoint = `/api/admin/custom-sites?salonSlug=${encodeURIComponent(salonSlug)}`;
  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Your design could not be loaded.');
    }
    setState(data);
    setSource(data.payload?.source ?? null);
  }
  useEffect(() => {
    void load().catch(e => setError(e.message));
  }, [endpoint, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await work();
      await onSaved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
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
      {error && (
        <p role="alert">
          {error}
          {' '}
          <button type="button" onClick={() => void action('Loading saved design…', load)}>Reload saved design</button>
        </p>
      )}
      {busy && (
        <p role="status">
          {busy}
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
                </label>
              ))}
            </fieldset>
          )
        : null}
      <form onSubmit={(event) => {
        event.preventDefault();
        void action('Studying your references and writing your website…', async () => {
          await post({ action: 'generate', input: { expectedRevision: revision, operationId: crypto.randomUUID(), message, referenceIds: selected, startOver } });
          setMessage('');
          setStartOver(false);
        });
      }}
      >
        <label>
          Describe your design or a change
          <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={4000} rows={4} required placeholder="Use this Canva composition, my salon name and my photos. Make the mobile version less crowded." />
        </label>
        {artifactId && (
          <label>
            <input type="checkbox" checked={startOver} onChange={event => setStartOver(event.target.checked)} />
            Start over with an entirely new design
          </label>
        )}
        <button type="submit" disabled={disabled || !aiEnabled || Boolean(busy) || !message.trim()}>{artifactId ? 'Update my custom design' : 'Generate my custom website'}</button>
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
                  <p>{attempt.status === 'completed' ? 'Design saved for review.' : attempt.status === 'generated' ? 'Design generated; reload or retry to apply it.' : attempt.status === 'pending' ? 'Generation in progress. Reload to check for a result.' : 'This attempt did not finish. Your earlier design is safe.'}</p>
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
          {state.rendererOrigin ? <CustomWebsiteFrame key={`${artifactId}-${revision}`} payload={state.payload} rendererOrigin={state.rendererOrigin} /> : <p>Your website preview is not available right now. Your design is saved. Please try again before publishing.</p>}
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
