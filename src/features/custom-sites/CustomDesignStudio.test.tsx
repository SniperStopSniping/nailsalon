import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import { CustomDesignStudio } from './CustomDesignStudio';

vi.mock('./CustomWebsiteFrame', () => ({ CustomWebsiteFrame: () => <div>Isolated artwork preview</div> }));

afterEach(() => vi.unstubAllGlobals());

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
  fireEvent.click(screen.getByRole('button', { name: 'Artwork is correct' }));
  await waitFor(() => expect(pending).toBeGreaterThan(0));
  await act(async () => {
    release();
  });

  await waitFor(() => expect(screen.getByText('Artwork checked. Review and publish when you’re ready.')).toBeVisible());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share this preview' })).toBeEnabled());
});
