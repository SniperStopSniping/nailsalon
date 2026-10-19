'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';

import { AI_REQUEST_CREDIT_LIMIT, formatAiCredits } from '@/features/ai-credits/catalog';
import { AI_CREDITS_CHANGED } from '@/features/ai-credits/client';

import { prepareCanvaPages } from './canva-upload';
import { CanvaAreaEditor } from './CanvaAreaEditor';
import { CanvaArtworkQuality } from './CanvaArtworkQuality';
import { CanvaUploadQuality } from './CanvaImageQuality';
import { type CustomSiteGenerateInput, customSiteGenerateSchema, type CustomSitePayload, type CustomSiteSource, type DesignBrief } from './contracts';
import { CustomTextEditor } from './CustomTextEditor';
import { CustomWebsiteFrame } from './CustomWebsiteFrame';
import { GenerationEvidence } from './GenerationEvidence';
import { prepareWebsiteImage } from './image-upload';
import type { DesignAsset } from './WebsitePhotoLibrary';
import { WebsitePhotoLibrary } from './WebsitePhotoLibrary';

type State = {
  head: { revision: { revision: number; document: { website: { config: { customFrontendId?: string } } } } };
  preferences: DesignBrief | null;
  payload: CustomSitePayload | null;
  rendererOrigin: string | null;
  configured: boolean;
  assets: { id: string; name: string; role: string; mimeType: string }[];
  history: { id: string; title: string; createdAt: string; assetIds: string[] }[];
  attempts: { id: string; message: string; status: string; phase: string; recoverable: boolean; createdAt: string; artifactId: string | null; inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null }[];
};
export function CustomDesignStudio({ salonSlug, revision, artifactId, disabled, published = false, aiEnabled, onSaved, selected, setSelected, missingDetails, onContinueConversation, entryMode, onReadBusinessDetails, onBusyChange, compact = false, previewVisible = true, onAssetsChange, creditsEnabled = false }: { creditsEnabled?: boolean; compact?: boolean; previewVisible?: boolean; onAssetsChange?: (assets: DesignAsset[]) => void; salonSlug: string; revision: number; artifactId?: string; disabled: boolean; published?: boolean; aiEnabled: boolean; onSaved: () => Promise<void>; selected: string[]; setSelected: Dispatch<SetStateAction<string[]>>; missingDetails: string[]; onContinueConversation: () => void; entryMode?: 'upload' | 'describe' | null; onBusyChange?: (busy: boolean) => void; onReadBusinessDetails?: (ids: string[]) => Promise<void> }) {
  const [state, setState] = useState<State | null>(null);
  const [source, setSource] = useState<CustomSiteSource | null>(null);
  const [message, setMessage] = useState('');
  const [generationRequest, setGenerationRequest] = useState<CustomSiteGenerateInput | null>(null);
  const generationRequestRef = useRef<CustomSiteGenerateInput | null>(null);
  const generating = useRef(false);
  const generationStorageKey = `luster-design-request:${salonSlug}`;
  function saveGenerationRequest(input: CustomSiteGenerateInput | null) {
    generationRequestRef.current = input;
    setGenerationRequest(input);
    try {
      if (input) {
        sessionStorage.setItem(generationStorageKey, JSON.stringify(input));
      } else {
        sessionStorage.removeItem(generationStorageKey);
      }
    } catch { /* The server also retains requests that reached it. */ }
  }
  const initializedSelection = useRef(false);
  const [startOver, setStartOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [uploadSource, setUploadSource] = useState<'own' | 'inspiration'>('inspiration');
  const [showUpload, setShowUpload] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [canvaEditorOpen, setCanvaEditorOpen] = useState(false);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const replacementUploads = useRef(new Map<File, DesignAsset>());
  const replacementOperation = useRef<{ file: File; page: string; revision: number; id: string } | null>(null);
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
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      // Chat hides this panel. Keep the last useful scale instead of creating
      // a zero-size renderer before the owner opens their preview.
      if (width && width > 0) {
        setPreviewWidth(width);
      }
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasPreview]);
  const [previewSize, setPreviewSize] = useState<'desktop' | 'mobile'>('desktop');
  const [share, setShare] = useState<{ path: string; token: string; revision: number } | null>(null);
  const [artworkPreviewAcknowledged, setArtworkPreviewAcknowledged] = useState(false);
  useEffect(() => setArtworkPreviewAcknowledged(false), [revision]);
  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) {
      setPreviewSize('mobile');
    }
  }, []);
  const loadSequence = useRef(0);
  const endpoint = `/api/admin/custom-sites?salonSlug=${encodeURIComponent(salonSlug)}`;
  async function load() {
    const sequence = ++loadSequence.current;
    const response = await fetch(endpoint, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? 'Your design could not be loaded.');
    }
    if (sequence !== loadSequence.current) {
      return;
    }
    setState(data);
    onAssetsChange?.(data.assets);
    setSource(data.payload?.source ?? null);
    if (data.preferences) {
      setSelected([...data.preferences.referenceIds, ...data.preferences.websiteAssetIds]);
    }
    if (!initializedSelection.current) {
      initializedSelection.current = true;
      try {
        const saved = customSiteGenerateSchema.safeParse(JSON.parse(sessionStorage.getItem(generationStorageKey) ?? 'null'));
        if (saved.success) {
          saveGenerationRequest(saved.data);
        }
      } catch { /* Private browsing can disable session storage. */ }
      // Unused uploads survive refresh/device changes in the private asset store.
      // Restore them visibly; consumed references are not silently reattached.
      const used = new Set((data.history as State['history']).flatMap(item => item.assetIds));
      const unused = data.preferences ? [] : (data.assets as State['assets']).filter(asset => !used.has(asset.id)).slice(0, 6);
      if (!data.preferences) {
        setSelected([...new Set([...unused.map(asset => asset.id), ...Object.keys(data.payload?.images ?? {})])]);
      }
      if (unused.length && !generationRequestRef.current) {
        setMessage('Create my website from the selected inspiration, but make it even better.');
        setShowUpload(true);
        setShowBrief(true);
      }
    }
    const request = generationRequestRef.current;
    const receipt = request && (data.attempts as State['attempts']).find(attempt => attempt.id === request.operationId);
    if (receipt?.status === 'completed') {
      saveGenerationRequest(null);
      setReply('Your new design is saved as a draft. Review it before publishing.');
      setStartOver(false);
      setError('');
    } else if (receipt?.status === 'failed') {
      saveGenerationRequest(null);
      setMessage(current => current || request!.message);
    }
    if (data.head.revision.revision !== revision) {
      await onSaved();
    }
  }
  function invalidateLoads() {
    // A fresh conversation must not inherit images from an unmounted studio.
    loadSequence.current++;
  }
  useEffect(() => {
    void load().catch(e => setError(e.message));
    return invalidateLoads;
  }, [endpoint, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = state?.attempts.some(item => item.status === 'pending' && Date.now() - new Date(item.createdAt).getTime() < 300000);
  useEffect(() => {
    onBusyChange?.(Boolean(busy || pending));
  }, [busy, pending, onBusyChange]);
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
    const metered = creditsEnabled && typeof body === 'object' && body !== null && 'action' in body && body.action === 'generate';
    if (metered) {
      body = { ...body as Record<string, unknown>, acceptedCreditLimitMicroCad: AI_REQUEST_CREDIT_LIMIT };
    }
    let response: Response;
    try {
      response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } finally {
      if (metered) {
        window.dispatchEvent(new Event(AI_CREDITS_CHANGED));
      }
    }
    const result = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(result.error ?? 'The design could not be saved.'), { code: result.code, status: response.status });
    }
    return result;
  }
  async function submitGeneration(input: CustomSiteGenerateInput) {
    if (generating.current) {
      return;
    }
    generating.current = true;
    saveGenerationRequest(input);
    setMessage('');
    try {
      await action('Studying your references and writing your website…', async () => {
        let result;
        try {
          result = await post({ action: 'generate', input });
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && ['INVALID', 'INSUFFICIENT_CREDITS', 'NOT_CONFIGURED', 'STALE'].includes(String(error.code))) {
            saveGenerationRequest(null);
            setMessage(current => current || input.message);
          }
          throw error;
        }
        saveGenerationRequest(null);
        setReply(result.reply ?? 'Your new design is saved as a draft. Review it before publishing.');
        setStartOver(false);
      });
    } finally {
      generating.current = false;
    }
  }
  const brief: DesignBrief = state?.preferences ?? { fidelity: 'inspiration', referenceIds: selected.filter(id => state?.assets.some(asset => asset.id === id && asset.role === 'reference')), ownedReferenceIds: [], websiteAssetIds: [...new Set([...selected.filter(id => state?.assets.some(asset => asset.id === id && asset.role !== 'reference')), ...Object.keys(state?.payload?.images ?? {})])].slice(0, 6) };
  async function saveBrief(values: DesignBrief) {
    await post({ action: 'preferences', input: { expectedRevision: revision, operationId: crypto.randomUUID(), values } });
    setSelected([...values.referenceIds, ...values.websiteAssetIds]);
  }
  function changeBrief(values: DesignBrief) {
    void action('Saving your design choices…', () => saveBrief(values));
  }
  async function uploadFiles(files: File[], role: 'photo' | 'logo', replaceId?: string) {
    await action('Saving your photos…', async () => {
      if (files.length > 6 || (!replaceId && brief.websiteAssetIds.length + files.length > 6)) {
        throw new Error('Choose up to six photos and logos for this design.');
      }
      const uploaded: DesignAsset[] = [];
      for (const file of files) {
        const data = new FormData();
        setBusy('Preparing your image…');
        data.set('file', await prepareWebsiteImage(file));
        data.set('role', role);
        data.set('rightsConfirmed', 'true');
        const response = await fetch(endpoint, { method: 'POST', body: data });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error ?? 'This photo could not be uploaded. Earlier uploads are saved in your library.');
        }
        uploaded.push(result.asset);
      }
      if (replaceId) {
        await post({ action: 'edit_media', input: { expectedRevision: revision, operationId: crypto.randomUUID(), assetId: replaceId, replacementId: uploaded[0]!.id } });
      } else {
        await saveBrief({ ...brief, websiteAssetIds: [...new Set([...brief.websiteAssetIds, ...uploaded.map(asset => asset.id)])] });
      }
      setReply(replaceId ? 'Your draft now uses the replacement photo. Your published site is unchanged.' : 'Your photos are saved and selected for your next design.');
    });
  }
  async function replaceArtwork(pageIndex: number, file: File, kind: 'sharper' | 'new_design') {
    await action('Checking and replacing your Canva image…', async () => {
      const pageAssetId = state?.payload?.source.canva?.pages[pageIndex]?.assetId;
      if (!pageAssetId) {
        throw new Error('Open your saved design before replacing its image.');
      }
      let uploaded = replacementUploads.current.get(file);
      if (!uploaded) {
        const body = new FormData();
        const [page] = await prepareCanvaPages(file, 1, setBusy);
        body.set('file', page!);
        body.set('role', 'reference');
        body.set('purpose', 'canva_artwork');
        body.set('rightsConfirmed', 'true');
        const response = await fetch(endpoint, { method: 'POST', body });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error ?? 'Your design image could not be saved. Try again.');
        }
        uploaded = result.asset as DesignAsset;
        replacementUploads.current.set(file, uploaded);
      }
      const previous = replacementOperation.current;
      const page = `${pageIndex}:${pageAssetId}:${kind}`;
      const operation = previous?.file === file && previous.page === page && previous.revision === revision ? previous : { file, page, revision, id: crypto.randomUUID() };
      replacementOperation.current = operation;
      await post({ action: 'replace_canva_page', input: { expectedRevision: revision, operationId: operation.id, pageAssetId, pageIndex, replacementId: uploaded.id, ...(kind === 'new_design' ? { newDesignConfirmed: true } : { sameDesignConfirmed: true }) } });
      setReply(kind === 'new_design' ? 'Your new design image is saved. Add its clickable areas, then review the artwork before publishing. Your other pages and published website are unchanged.' : 'Your new image is saved with the same links. Check the artwork and links before publishing. Your published website is unchanged.');
    });
  }
  const current = state?.history.find(item => item.id === artifactId);
  const previewIsCurrent = state?.head.revision.revision === revision && state?.head.revision.document.website.config.customFrontendId === artifactId;
  const sourceEditingDisabled = disabled || Boolean(busy || pending) || !previewIsCurrent;
  return (
    <div id="custom-design" className="custom-design-studio">
      {!artifactId && !entryMode && !state?.assets.length && (
        <div className="setup-preview-empty">
          <span aria-hidden="true">✦</span>
          <h3>A website that feels like you.</h3>
          <p>Tell Luster what you have in mind in chat, or attach a design. Your website will take shape here, with your services and booking details connected.</p>
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
          {state.payload.source.canva && <CanvaArtworkQuality key={`quality-${state.head.revision.document.website.config.customFrontendId}`} pages={state.payload.source.canva.pages} disabled={disabled || Boolean(busy || pending) || !previewIsCurrent} onReplace={replaceArtwork} />}
          {state.payload.source.canva && reply && <p role="status">{reply}</p>}
          {state.payload.source.canva && !state.payload.source.canva.ownerReviewed && (
            <label>
              <input type="checkbox" checked={artworkPreviewAcknowledged} disabled={disabled || Boolean(busy || pending) || !previewIsCurrent} onChange={event => setArtworkPreviewAcknowledged(event.target.checked)} />
              Share this original image as a preview, including its printed contact details and location. Anyone with the link can view it. Booking stays disabled; this does not approve prices or policies for publication.
            </label>
          )}
          <div role="group" aria-label="Preview size">
            <button type="button" aria-pressed={previewSize === 'desktop'} onClick={() => setPreviewSize('desktop')}>Desktop preview</button>
            <button type="button" aria-pressed={previewSize === 'mobile'} onClick={() => setPreviewSize('mobile')}>Mobile preview</button>
            {previewIsCurrent && !busy && !pending
              ? <a href={`/admin/business-setup/design-preview/${encodeURIComponent(salonSlug)}?revision=${state.head.revision.revision}`} target="_blank" rel="noreferrer">Open full preview</a>
              : <span role="status">Updating your preview…</span>}
          </div>
          {share && (
            <div role="status">
              <p>Anyone with this link can view this saved version for 30 days. Booking is disabled. Later changes won’t replace it.</p>
              <a href={share.path} target="_blank" rel="noreferrer">
                View shared preview · version
                {share.revision}
              </a>
              {' '}
              <button type="button" onClick={() => void navigator.clipboard.writeText(new URL(share.path, window.location.origin).href).then(() => setReply('Preview link copied.')).catch(() => setReply('Open the preview link and copy its address.'))}>Copy link</button>
              {' '}
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void action('Removing shared access…', async () => {
                  await post({ action: 'revoke_share', token: share.token });
                  setShare(null);
                })}
              >
                Remove link
              </button>
            </div>
          )}
          <div ref={previewBox} className="studio-frame-wrap">
            <div style={{ width: previewSize === 'mobile' ? 390 : 1280, maxWidth: previewSize === 'mobile' ? '100%' : undefined, zoom: previewSize === 'desktop' ? Math.min(1, previewWidth / 1280) : 1, margin: 'auto' }}>
              {previewVisible && (state.rendererOrigin ? <CustomWebsiteFrame key={`${state.head.revision.document.website.config.customFrontendId}-${state.head.revision.revision}`} payload={state.payload} rendererOrigin={state.rendererOrigin} /> : <p>Your website preview is not available right now. Your design is saved. Please try again before publishing.</p>)}
            </div>
          </div>
          <p>
            <strong>{state.payload.source.title}</strong>
            {' '}
            ·
            {' '}
            <span>{published ? previewIsCurrent ? 'Published' : 'Saved design' : 'Saved as draft'}</span>
          </p>
          <details>
            <summary>{state.payload.source.limitations.length ? `Design notes · ${state.payload.source.limitations.length} differences to review` : 'About this design'}</summary>
            <p>{state.payload.source.analysis}</p>
            {state.payload.source.limitations.length > 0 && <ul>{state.payload.source.limitations.map(item => <li key={item}>{item}</li>)}</ul>}
          </details>
          <button
            type="button"
            disabled={disabled || Boolean(busy || pending) || !previewIsCurrent || Boolean(state.payload.source.canva && !state.payload.source.canva.ownerReviewed && !artworkPreviewAcknowledged)}
            onClick={() => void action('Creating your preview link…', async () => {
              const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
              const result = await post({ action: 'share', input: { expectedRevision: revision, token, ...(artworkPreviewAcknowledged ? { artworkPreviewAcknowledged: true } : {}) } });
              setShare({ path: result.path, token, revision: result.revision });
            })}
          >
            Share this preview
          </button>
        </div>
      )}
      {state?.payload?.source.canva && (
        <CanvaAreaEditor
          key={state.head.revision.document.website.config.customFrontendId}
          payload={state.payload}
          endpoint={endpoint}
          open={canvaEditorOpen}
          onOpenChange={setCanvaEditorOpen}
          disabled={disabled || Boolean(busy || pending) || state.head.revision.revision !== revision}
          onSave={source => void action('Saving clickable areas…', async () => {
            await post({ action: 'save', input: { expectedRevision: revision, operationId: crypto.randomUUID(), source, assetIds: current?.assetIds ?? [] } });
          })}
          onReview={() => void action('Saving your artwork check…', async () => {
            await post({ action: 'review_canva', input: { expectedRevision: revision, operationId: crypto.randomUUID() } });
          })}
        />
      )}
      {!compact && (
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
                const file = data.get('file');
                const isReference = data.get('role') === 'reference';
                const existing = isReference ? brief.referenceIds : brief.websiteAssetIds;
                const pages = brief.mode === 'keep_design' && isReference && file instanceof File ? await prepareCanvaPages(file, 6 - existing.length, setBusy) : [!isReference && file instanceof File ? await prepareWebsiteImage(file) : file];
                if (existing.length + pages.length > 6) {
                  throw new Error('Choose up to six images or pages. Remove an attached image to make room.');
                }
                const uploaded: DesignAsset[] = [];
                for (const [index, page] of pages.entries()) {
                  if (!(page instanceof File)) {
                    throw new TypeError('Choose a file to upload.');
                  }
                  setBusy(`Uploading ${index + 1} of ${pages.length}…`);
                  data.set('file', page);
                  if (isReference && uploadSource === 'own' && page.type.startsWith('image/')) {
                    data.set('purpose', 'canva_artwork');
                  }
                  const response = await fetch(endpoint, { method: 'POST', body: data });
                  const result = await response.json();
                  if (!response.ok) {
                    throw new Error(result.error ?? 'The upload failed. Earlier uploads are saved; retry to finish.');
                  }
                  uploaded.push(result.asset as DesignAsset);
                }
                const ids = uploaded.map(asset => asset.id);
                const referenceIds = isReference ? [...new Set([...brief.referenceIds, ...ids])] : brief.referenceIds;
                await saveBrief({ ...brief, referenceIds, ownedReferenceIds: [...new Set([...brief.ownedReferenceIds, ...(isReference && uploadSource === 'own' ? ids : [])])], websiteAssetIds: isReference ? brief.websiteAssetIds : [...new Set([...brief.websiteAssetIds, ...ids])] });
                setReply('Your image is saved and selected. Describe what you like below, then choose Create my website. You can also ask Luster in Conversation.');
                setMessage(current => current || (brief.fidelity === 'match' ? 'Recreate my uploaded design as a working, editable booking website.' : 'Create my website from the selected inspiration, but make it even better.'));
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
                {brief.mode === 'keep_design' ? 'Canva images or PDF · up to 20 MB · six pages · prepared automatically' : 'PNG, JPG, WebP or PDF · up to 3 MB'}
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp,application/pdf" required onChange={event => setReferenceFiles(Array.from(event.target.files ?? []))} />
              </label>
              <small>Photos and logos can be up to 20 MB. Larger images are prepared automatically.</small>
              {brief.mode === 'keep_design' && referenceFiles.length > 0 && <CanvaUploadQuality files={referenceFiles} />}
              <label>
                <input type="checkbox" name="rightsConfirmed" required />
                I may use this file. Other businesses’ content is for inspiration only.
              </label>
              <button type="submit" disabled={disabled || Boolean(busy)}>Upload</button>
            </form>
            {uploadSource === 'own' && brief.referenceIds.length > 0 && onReadBusinessDetails && (
              <div className="studio-read-details">
                <p>Does your image include your salon’s details? I can read them, then we’ll check them together.</p>
                <button type="button" disabled={disabled || !aiEnabled || Boolean(busy)} onClick={() => void action('Reading your business details…', () => onReadBusinessDetails(brief.referenceIds))}>Read my business details</button>
                <button type="button" onClick={onContinueConversation}>I’ll tell Luster instead</button>
              </div>
            )}
          </section>
        </details>
      )}
      {!state?.payload?.source.canva && (
        <details className="studio-media-controls">
          <summary>Photos & design settings</summary>
          {reply && <p role="status" className="setup-notice">{reply}</p>}
          {state && (
            <WebsitePhotoLibrary
              assets={state.assets.filter(asset => asset.role !== 'reference')}
              selected={brief.websiteAssetIds}
              displayed={Object.keys(state.payload?.images ?? {})}
              endpoint={endpoint}
              disabled={disabled || Boolean(busy) || pending === true}
              onUpload={uploadFiles}
              onSelect={(id, checked) => changeBrief({ ...brief, websiteAssetIds: checked ? [...brief.websiteAssetIds, id] : brief.websiteAssetIds.filter(item => item !== id) })}
              onEdit={(assetId, replacementId) => action('Updating your draft photo…', async () => {
                await post({ action: 'edit_media', input: { expectedRevision: revision, operationId: crypto.randomUUID(), assetId, replacementId } });
                setReply('Photo removed from this draft. Earlier versions and your published website are unchanged.');
              })}
            />
          )}
          {state?.assets.some(asset => asset.role === 'reference') && (
            <fieldset className="studio-assets">
              <legend>Your design references</legend>
              {state.assets.filter(asset => asset.role === 'reference').map(asset => (
                <div key={asset.id} className="studio-reference-card">
                  <label>
                    <input
                      type="checkbox"
                      checked={brief.referenceIds.includes(asset.id)}
                      disabled={disabled || Boolean(busy) || (!brief.referenceIds.includes(asset.id) && brief.referenceIds.length >= 6)}
                      onChange={(event) => {
                        const ids = event.target.checked ? [...brief.referenceIds, asset.id] : brief.referenceIds.filter(id => id !== asset.id);
                        changeBrief({ ...brief, referenceIds: ids, ownedReferenceIds: brief.ownedReferenceIds.filter(id => ids.includes(id)) });
                      }}
                    />
                    {asset.name}
                    {' '}
                    · Design reference
                  </label>
                  {asset.mimeType.startsWith('image/') && <img src={`${endpoint}&asset=${asset.id}`} alt={`${asset.name} reference`} /> /* eslint-disable-line @next/next/no-img-element */}
                  {brief.referenceIds.includes(asset.id) && (
                    <label>
                      <input type="checkbox" checked={brief.ownedReferenceIds.includes(asset.id)} disabled={disabled || Boolean(busy)} onChange={event => changeBrief({ ...brief, ownedReferenceIds: event.target.checked ? [...brief.ownedReferenceIds, asset.id] : brief.ownedReferenceIds.filter(id => id !== asset.id) })} />
                      {' '}
                      This is my own design; I may reuse its branding and artwork.
                    </label>
                  )}
                </div>
              ))}
            </fieldset>
          )}
          <details className="studio-step" open={showBrief} onToggle={event => setShowBrief(event.currentTarget.open)}>
            <summary>
              Your design direction
              <span>Tell us what you like</span>
            </summary>
            <fieldset className="studio-fidelity" disabled={disabled || Boolean(busy) || pending === true}>
              <legend>How should Luster use your design?</legend>
              <button type="button" aria-pressed={brief.fidelity === 'match'} onClick={() => changeBrief({ ...brief, fidelity: 'match', mode: 'rebuild' })}>
                <strong>Match my design closely</strong>
                <span>Keep its layout, proportions and details. Make it responsive and interactive.</span>
              </button>
              <button type="button" aria-pressed={brief.fidelity === 'inspiration'} onClick={() => changeBrief({ ...brief, fidelity: 'inspiration', mode: 'rebuild' })}>
                <strong>Use it as inspiration</strong>
                <span>Keep the feeling, with freedom to create something new.</span>
              </button>
              <button type="button" aria-pressed={brief.mode === 'keep_design'} disabled={!brief.referenceIds.length || brief.referenceIds.some(id => !brief.ownedReferenceIds.includes(id))} onClick={() => changeBrief({ ...brief, fidelity: 'match', mode: 'keep_design' })}>
                <strong>Keep my Canva design</strong>
                <span>Keep the original artwork. Add clickable booking and contact areas.</span>
              </button>
              <p>Your original Canva artwork can be recreated as editable website elements. Upload the original photos and logo for the closest match. Unavailable fonts or interactions will be explained in the result.</p>
              {brief.fidelity === 'match' && brief.referenceIds.length === 0 && <p role="status">Upload or select a design to match before creating your website.</p>}
            </fieldset>
            {!compact && (
              <form onSubmit={(event) => {
                event.preventDefault();
                if (generationRequestRef.current) {
                  return;
                }
                void submitGeneration({ expectedRevision: revision, operationId: crypto.randomUUID(), message, referenceIds: selected, startOver });
              }}
              >
                <label>
                  What do you like about your references, or what should change?
                  <textarea id="custom-design-brief" value={message} disabled={Boolean(generationRequest)} onChange={event => setMessage(event.target.value)} maxLength={4000} rows={4} required placeholder="Something warm and elegant. Cream backgrounds, bold photography and a little personality…" />
                </label>
                {artifactId && (
                  <label>
                    <input type="checkbox" checked={startOver} onChange={event => setStartOver(event.target.checked)} />
                    Start over with an entirely new design
                  </label>
                )}
                <p>{selected.length ? `${selected.length} uploaded file(s) will be used for this request.` : 'Describe your idea, or select an uploaded image below.'}</p>
                {creditsEnabled && (
                  <p>
                    Uses up to
                    {' '}
                    {formatAiCredits(AI_REQUEST_CREDIT_LIMIT)}
                    {' '}
                    in AI credits. Only actual usage is charged.
                  </p>
                )}
                {missingDetails.length > 0 && (
                  <div className="setup-notice">
                    <p>Your first design can be created now. Missing business and booking details can be added before publishing.</p>
                    <button type="button" onClick={onContinueConversation}>Continue with Luster</button>
                  </div>
                )}
                <button type="submit" disabled={disabled || !aiEnabled || !state?.configured || Boolean(busy || generationRequest) || pending || !message.trim() || (brief.fidelity === 'match' && brief.referenceIds.length === 0)}>{busy.includes('writing your website') || pending ? 'Creating your website…' : 'Create my website'}</button>
                {generationRequest && (
                  <div role="status">
                    <p>{generationRequest.message}</p>
                    <p>{busy || pending ? 'Creating your website. Your request is saved here.' : 'Your request is saved. Check it before starting another design.'}</p>
                    <button type="button" disabled={disabled || !aiEnabled || Boolean(busy) || pending} onClick={() => void submitGeneration(generationRequest)}>Check my request</button>
                  </div>
                )}
              </form>
            )}
          </details>
        </details>
      )}
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
                  {!creditsEnabled && <GenerationEvidence endpoint={endpoint} operationId={attempt.id} />}
                </div>
              ))}
            </details>
          )
        : null}
      {state?.payload && (
        <>
          {!state.payload.source.canva && (
            <>
              {source && (
                <CustomTextEditor
                  source={source}
                  onChange={setSource}
                  disabled={sourceEditingDisabled}
                  onSave={() => action('Saving your website wording…', async () => {
                    await post({ action: 'save', input: { expectedRevision: revision, operationId: crypto.randomUUID(), source, assetIds: current?.assetIds ?? [] } });
                  })}
                />
              )}
              <details>
                <summary>Edit website source</summary>
                <p>HTML, CSS and interactions stay editable. Saving creates a new draft version.</p>
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
                      <input value={source.title} onChange={event => setSource({ ...source, title: event.target.value })} maxLength={100} disabled={sourceEditingDisabled} />
                    </label>
                    {(['html', 'css', 'javascript'] as const).map(file => (
                      <label key={file}>
                        {file === 'javascript' ? 'Visual interactions (isolated worker)' : file.toUpperCase()}
                        <textarea aria-label={file === 'javascript' ? 'Visual interactions (isolated worker)' : file.toUpperCase()} spellCheck={false} value={source[file]} onChange={event => setSource({ ...source, [file]: event.target.value })} rows={12} disabled={sourceEditingDisabled} />
                      </label>
                    ))}
                    <button type="submit" disabled={sourceEditingDisabled}>Save design changes</button>
                  </form>
                )}
              </details>
            </>
          )}
          <details>
            <summary>Previous designs</summary>
            <p>Restore a design into your draft. Your business details and published website stay as they are.</p>
            <ol className="studio-design-history" aria-label="Saved website designs">
              {state.history.map((item) => {
                const request = state.attempts.find(attempt => attempt.artifactId === item.id)?.message;
                const saved = new Date(item.createdAt);
                const savedAt = Number.isNaN(saved.getTime()) ? null : saved.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
                return (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    {item.id === artifactId && <span className="studio-current-design">Current design</span>}
                    {savedAt && <time dateTime={item.createdAt}>{`Saved ${savedAt}`}</time>}
                    {request && <p>{request.length > 180 ? `${request.slice(0, 180)}…` : request}</p>}
                    <button
                      type="button"
                      disabled={sourceEditingDisabled || item.id === artifactId}
                      onClick={() => void action('Restoring this design as a new draft…', async () => {
                        await post({ action: 'restore', input: { expectedRevision: revision, operationId: crypto.randomUUID(), artifactId: item.id } });
                      })}
                    >
                      Restore as draft
                    </button>
                  </li>
                );
              })}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}
