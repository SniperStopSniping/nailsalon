import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import { CustomDesignStudio } from './CustomDesignStudio';

vi.mock('./CustomWebsiteFrame', () => ({ CustomWebsiteFrame: () => <div>Isolated artwork preview</div> }));

function savedPreviewFixture() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const source = { title: 'Owner design', html: '<h1 data-edit="welcome">Welcome</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ head: { revision: { revision: 3, document: { website: { config: { customFrontendId: 'saved' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: true, rendererOrigin: 'https://renderer.example' })));
}

it('starts the isolated renderer only while preview is open and keeps unsaved manual wording', async () => {
  savedPreviewFixture();
  const editor = (previewVisible: boolean) => <CustomDesignStudio salonSlug="test" revision={3} artifactId="saved" disabled={false} aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} previewVisible={previewVisible} compact />;
  const view = render(editor(false));
  await screen.findByText('Owner design');

  expect(screen.queryByText('Isolated artwork preview')).not.toBeInTheDocument();

  fireEvent.click(await screen.findByText('Edit website wording', { exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Website text: welcome' }), { target: { value: 'My unsaved wording' } });
  view.rerender(editor(true));

  expect(screen.getByText('Isolated artwork preview')).toBeVisible();

  view.rerender(editor(false));

  expect(screen.queryByText('Isolated artwork preview')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Website text: welcome' })).toHaveValue('My unsaved wording');
});

it('keeps the desktop preview scale when its hidden panel reports zero width', async () => {
  savedPreviewFixture();
  let resized: (entries: { contentRect: { width: number } }[]) => void = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: typeof resized) {
      resized = callback;
    }

    observe() {}
    disconnect() {}
  });
  render(<CustomDesignStudio salonSlug="test" revision={3} artifactId="saved" disabled={false} aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);
  const viewport = (await screen.findByText('Isolated artwork preview')).parentElement!;
  const initial = viewport.style.zoom;
  act(() => resized([{ contentRect: { width: 0 } }]));

  expect(Number.parseFloat(viewport.style.zoom)).toBeGreaterThan(0);
  expect(viewport.style.zoom).toBe(initial);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('distinguishes same-named designs by their request and date and restores the chosen saved design', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const source = { title: 'My salon', html: '<h1>My salon</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  const history = [
    { id: 'current', title: 'My salon', createdAt: '2026-10-19T04:15:00Z', assetIds: [] },
    { id: 'overlap', title: 'My salon', createdAt: '2026-10-19T04:10:00Z', assetIds: [] },
  ];
  const posts: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push(JSON.parse(String(options.body)));
    }
    return Response.json({ head: { revision: { revision: 7, document: { website: { config: { customFrontendId: 'current' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history, attempts: [{ id: 'request-overlap', artifactId: 'overlap', message: 'Make the images larger and overlap them.', status: 'completed' }], configured: true, rendererOrigin: null });
  }));
  render(<CustomDesignStudio salonSlug="test" revision={7} artifactId="current" disabled={false} aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);
  fireEvent.click(await screen.findByText('Previous designs'));
  const items = within(screen.getByRole('list', { name: 'Saved website designs' })).getAllByRole('listitem');

  expect(within(items[0]!).getByText('Current design')).toBeVisible();
  expect(within(items[0]!).getByRole('button', { name: 'Restore as draft' })).toBeDisabled();
  expect(items[1]!.querySelector('time')).toHaveAttribute('datetime', '2026-10-19T04:10:00Z');
  expect(within(items[1]!).getByText('Make the images larger and overlap them.')).toBeVisible();

  fireEvent.click(within(items[1]!).getByRole('button', { name: 'Restore as draft' }));
  await waitFor(() => expect(posts).toHaveLength(1));

  expect(posts[0]).toMatchObject({ action: 'restore', input: { expectedRevision: 7, artifactId: 'overlap', operationId: expect.any(String) } });
});

it.each([{ pending: true, revision: 7 }, { pending: false, revision: 8 }])('holds design restoration while generation or newer saved data is loading: %j', async ({ pending, revision }) => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const source = { title: 'My salon', html: '<h1>My salon</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push(options.body);
    }
    return Response.json({ head: { revision: { revision: 7, document: { website: { config: { customFrontendId: 'current' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [{ id: 'old', title: 'Earlier look', createdAt: '2026-10-19T04:10:00Z', assetIds: [] }], attempts: pending ? [{ id: 'working', status: 'pending', createdAt: new Date().toISOString() }] : [], configured: true, rendererOrigin: null });
  }));
  render(<CustomDesignStudio salonSlug="test" revision={revision} artifactId="current" disabled={false} aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);
  fireEvent.click(await screen.findByText('Previous designs'));
  const restore = screen.getByRole('button', { name: 'Restore as draft' });

  expect(restore).toBeDisabled();

  fireEvent.click(restore);

  expect(posts).toEqual([]);
});

it('waits for the displayed preview and parent draft to agree before opening a full preview', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const source = { title: 'New design', html: '<h1 data-edit="welcome">Welcome</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  const onSaved = vi.fn(async () => {});
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ head: { revision: { revision: 3, document: { website: { config: { customFrontendId: 'new' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: true, rendererOrigin: null })));
  const editor = (revision: number, artifactId: string) => <CustomDesignStudio salonSlug="test" revision={revision} artifactId={artifactId} disabled={false} aiEnabled onSaved={onSaved} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />;
  const view = render(editor(2, 'old'));
  await screen.findByText('New design');

  expect(screen.queryByRole('link', { name: 'Open full preview' })).not.toBeInTheDocument();
  expect(screen.getByText('Updating your preview…')).toBeVisible();

  view.rerender(editor(3, 'new'));

  expect(await screen.findByRole('link', { name: 'Open full preview' })).toHaveAttribute('href', '/admin/business-setup/design-preview/test?revision=3');
});

it.each([{ pending: true, revision: 2 }, { pending: false, revision: 3 }])('holds manual wording/source edits while generation or a later preview is loading: %j', async ({ pending, revision }) => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const source = { title: 'Studio', html: '<h1 data-edit="welcome">Welcome</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push(options.body);
    }
    return { ok: true, json: async () => ({ head: { revision: { revision: 2, document: { website: { config: { customFrontendId: 'first' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: pending ? [{ id: 'waiting', status: 'pending', phase: 'generating', createdAt: new Date().toISOString() }] : [], configured: true, rendererOrigin: null }) };
  }));
  render(<CustomDesignStudio salonSlug="test" revision={revision} artifactId="first" disabled={false} aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);
  fireEvent.click(await screen.findByText('Edit website wording'));

  expect(screen.getByRole('textbox', { name: 'Website text: welcome' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save wording' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: 'Open full preview' })).not.toBeInTheDocument();
  expect(screen.getByText('Updating your preview…')).toBeVisible();

  fireEvent.click(screen.getByText('Edit website source', { exact: true }));

  expect(screen.getByRole('textbox', { name: 'CSS' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save design changes' })).toBeDisabled();
  expect(posts).toEqual([]);
});

it('saves wording through the existing draft action without opening code or charging for AI', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  let revision = 2;
  let artifactId = 'first';
  let source = { title: 'Studio', html: '<h1 data-edit="welcome">Welcome</h1><p data-luster-field="business.name"></p>', css: 'h1{color:#222}', javascript: '', analysis: '', limitations: [] };
  const requests: any[] = [];
  const head = () => ({ revision: { revision, document: { website: { config: { customFrontendId: artifactId } } } } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      requests.push(body);
      source = body.input.source;
      revision++;
      artifactId = 'second';
      return { ok: true, json: async () => ({ head: head() }) };
    }
    return { ok: true, json: async () => ({ head: head(), payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: false, rendererOrigin: null }) };
  }));
  const view = render(<div />);
  const editor = () => (
    <CustomDesignStudio
      salonSlug="test"
      revision={revision}
      artifactId={artifactId}
      disabled={false}
      aiEnabled={false}
      creditsEnabled
      onSaved={async () => {
        view.rerender(editor());
      }}
      selected={[]}
      setSelected={vi.fn()}
      missingDetails={[]}
      onContinueConversation={vi.fn()}
      compact
    />
  );
  view.rerender(editor());
  fireEvent.click(await screen.findByText('Edit website wording'));

  expect(screen.getByLabelText('CSS', { exact: true })).not.toBeVisible();

  fireEvent.change(screen.getByRole('textbox', { name: 'Website text: welcome' }), { target: { value: 'Your next appointment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));

  await waitFor(() => expect(requests).toHaveLength(1));

  expect(requests[0]).toMatchObject({ action: 'save', input: { expectedRevision: 2, source: { html: '<h1 data-edit="welcome">Your next appointment</h1><p data-luster-field="business.name"></p>', css: 'h1{color:#222}', javascript: '' } } });
  expect(requests[0]).not.toHaveProperty('acceptedCreditLimitMicroCad');
});

it('requires separate preview consent and clears it for a later revision without reviewing artwork', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} disconnect() {}
  });
  const requests: any[] = [];
  const source = compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 279, height: 1280, alt: 'Original artwork' }], areas: [], visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: false });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      requests.push(JSON.parse(String(options.body)));
      return { ok: true, json: async () => ({ path: '/website-preview/example', revision: 2 }) };
    }
    return { ok: true, json: async () => ({ head: { revision: { revision: 2, document: { website: { config: { customFrontendId: 'first' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: true, rendererOrigin: null }) };
  }));
  const editor = (revision: number) => <CustomDesignStudio salonSlug="test" revision={revision} artifactId="first" disabled={false} aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />;
  const view = render(editor(2));
  const consent = await screen.findByRole('checkbox', { name: /Share this original image as a preview/ });

  expect(screen.getByRole('button', { name: 'Share this preview' })).toBeDisabled();

  fireEvent.click(consent);
  fireEvent.click(screen.getByRole('button', { name: 'Share this preview' }));
  await screen.findByRole('link', { name: /View shared preview/ });

  expect(requests).toEqual([expect.objectContaining({ action: 'share', input: expect.objectContaining({ expectedRevision: 2, artworkPreviewAcknowledged: true }) })]);

  view.rerender(editor(3));

  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Share this original image as a preview/ })).not.toBeChecked());

  expect(screen.getByRole('button', { name: 'Share this preview' })).toBeDisabled();
});

it('shows the saved artwork review when the parent draft arrives before its preview payload', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} disconnect() {}
  });
  const source = compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 300, height: 600, alt: 'Owner artwork' }], areas: [], visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: false });
  const data = { business: { name: 'Test Studio', city: '', address: null, bio: '', hours: {} }, services: [], preview: true, currency: 'CAD' };
  const snapshot = (reviewed: boolean) => ({
    head: { revision: { revision: reviewed ? 3 : 2, document: { website: { config: { customFrontendId: reviewed ? 'second' : 'first' } } } } },
    preferences: { mode: 'keep_design', fidelity: 'match', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] },
    payload: { source: { ...source, canva: { ...source.canva!, ownerReviewed: reviewed } }, data, images: {}, canvaReviewRequired: !reviewed },
    configured: true,
    rendererOrigin: null,
    assets: [],
    history: [],
    attempts: [],
  });
  let pending = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posted = false;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posted = true;
      return { ok: true, json: async () => ({ head: snapshot(true).head }) };
    }
    if (posted) {
      pending++;
      await gate;
    }
    return { ok: true, json: async () => snapshot(posted) };
  }));
  const view = render(<div />);
  const editor = (revision: number, artifactId: string) => (
    <CustomDesignStudio
      salonSlug="test"
      revision={revision}
      artifactId={artifactId}
      disabled={false}
      aiEnabled
      onSaved={async () => {
        view.rerender(editor(3, 'second'));
      }}
      selected={[]}
      setSelected={vi.fn()}
      missingDetails={[]}
      onContinueConversation={vi.fn()}
      compact
    />
  );
  view.rerender(editor(2, 'first'));
  fireEvent.click(await screen.findByText('Check Canva links & artwork'));
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked all printed/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Artwork is correct' }));
    for (let tick = 0; tick < 20; tick++) {
      if (pending > 0) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    expect(pending).toBeGreaterThan(0);

    release();
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  await waitFor(() => expect(screen.getByText('Artwork checked. Review and publish when you’re ready.')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share this preview' })).toBeEnabled());
});

it.each(['sharper', 'new_design'] as const)('retries a %s replacement with one uploaded asset and the same operation without AI generation', async (kind) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} disconnect() {}
  });
  const source = compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 279, height: 1280, alt: 'Original export' }], areas: [], visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: false });
  const writes: any[] = [];
  let uploads = 0;
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.body instanceof FormData) {
      uploads++;

      expect(options.body.get('rightsConfirmed')).toBe('true');

      return { ok: true, json: async () => ({ asset: { id: 'b0000000-0000-4000-8000-000000000001', role: 'reference', name: 'sharper.png', mimeType: 'image/png' } }) };
    }
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      attempts++;
      if (attempts === 1) {
        throw new Error('Connection interrupted. Your saved image is safe.');
      }
      return { ok: true, json: async () => ({ head: {} }) };
    }
    return { ok: true, json: async () => ({ head: { revision: { revision: 2, document: { website: { config: { customFrontendId: 'first' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: false, rendererOrigin: null }) };
  }));
  render(<CustomDesignStudio salonSlug="test" revision={2} artifactId="first" disabled={false} aiEnabled={false} onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);
  await screen.findByRole('button', { name: 'Upload sharper image' });
  if (kind === 'new_design') {
    fireEvent.click(screen.getByRole('button', { name: 'Replace design image' }));
  }
  const button = kind === 'new_design' ? 'Replace design & reset its links' : 'Replace image & keep links';
  fireEvent.change(screen.getByLabelText(kind === 'new_design' ? 'New Canva design' : 'Sharper Canva export'), { target: { files: [new File(['image'], 'sharper.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('checkbox', { name: kind === 'new_design' ? 'I have permission to use this new design.' : /same design, text and layout/ }));
  fireEvent.click(screen.getByRole('button', { name: button }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: button })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: button }));
  await screen.findByText(kind === 'new_design' ? 'Your new design image is saved. Add its clickable areas, then review the artwork before publishing. Your other pages and published website are unchanged.' : 'Your new image is saved with the same links. Check the artwork and links before publishing. Your published website is unchanged.');

  expect(uploads).toBe(1);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0]).toMatchObject({ action: 'replace_canva_page', input: { expectedRevision: 2, pageIndex: 0, ...(kind === 'new_design' ? { newDesignConfirmed: true } : { sameDesignConfirmed: true }) } });
});

it('clears a paid design prompt while loading and recovers the exact request after a lost response and refresh', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const requests: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      requests.push(JSON.parse(String(options.body)));
      if (requests.length === 1) {
        throw new TypeError('Connection lost');
      }
      return Response.json({ reply: 'Your design is saved.' });
    }
    return Response.json({ head: { revision: { revision: 1, document: { website: { config: {} } } } }, payload: null, assets: [], history: [], attempts: [], configured: true, rendererOrigin: null });
  }));
  const editor = () => <CustomDesignStudio salonSlug="metered" revision={1} disabled={false} aiEnabled creditsEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} />;
  const first = render(editor());
  const prompt = await screen.findByLabelText('What do you like about your references, or what should change?');
  fireEvent.change(prompt, { target: { value: 'Create an original editorial design.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create my website' }));
  await screen.findByRole('alert');

  expect(prompt).toHaveValue('');
  expect(prompt).toBeDisabled();
  expect(requests[0]).toMatchObject({ action: 'generate', acceptedCreditLimitMicroCad: 2_000_000, input: { message: 'Create an original editorial design.', expectedRevision: 1 } });

  first.unmount();
  render(editor());
  fireEvent.click(await screen.findByRole('button', { name: 'Check my request' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Check my request' })).not.toBeInTheDocument());

  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(sessionStorage.getItem('luster-design-request:metered')).toBeNull();
});

it.each([true, false])('labels the current saved design by publication state, independently of disabled controls: %s', async (published) => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const source = { title: 'Owner design', html: '<h1>Studio</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ head: { revision: { revision: 3, document: { website: { config: { customFrontendId: 'saved' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: true, rendererOrigin: null })));
  render(<CustomDesignStudio salonSlug="test" revision={3} artifactId="saved" published={published} disabled aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);

  expect(await screen.findByText(published ? /^Published$/ : /Saved as draft$/)).toBeVisible();
  expect(screen.queryByText(published ? 'Saved as draft' : 'Published', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share this preview' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Open full preview' })).toHaveAttribute('href', '/admin/business-setup/design-preview/test?revision=3');
});

it('does not label an older displayed design as the current published version', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const source = { title: 'Older design', html: '<h1>Studio</h1>', css: '', javascript: '', analysis: '', limitations: [] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ head: { revision: { revision: 2, document: { website: { config: { customFrontendId: 'old' } } } } }, payload: { source, data: { preview: true, services: [], business: { name: 'Test' } }, images: {} }, assets: [], history: [], attempts: [], configured: true, rendererOrigin: null })));
  render(<CustomDesignStudio salonSlug="test" revision={3} artifactId="current" published disabled aiEnabled onSaved={async () => {}} selected={[]} setSelected={vi.fn()} missingDetails={[]} onContinueConversation={vi.fn()} compact />);

  expect(await screen.findByText('Saved design', { exact: true })).toBeVisible();
  expect(screen.queryByText('Published', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open full preview' })).not.toBeInTheDocument();
});
