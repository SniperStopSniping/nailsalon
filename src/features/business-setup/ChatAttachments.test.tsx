import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ChatAttachments } from './ChatAttachments';

const prepared = vi.hoisted(() => vi.fn());
vi.mock('@/features/custom-sites/canva-upload', () => ({ CANVA_INPUT_BYTES: 20000000, prepareCanvaPages: prepared }));
vi.mock('@/features/custom-sites/CanvaImageQuality', () => ({ CanvaUploadQuality: () => null }));
const brief = { fidelity: 'match' as const, mode: 'keep_design' as const, referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [] };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  prepared.mockReset();
});

function view(onSaved = vi.fn().mockResolvedValue(undefined)) {
  render(<ChatAttachments salonSlug="synthetic" revision={2} brief={brief} assets={[]} selected={[]} open onClose={vi.fn()} disabled={false} onBusyChange={vi.fn()} onSaved={onSaved} initialPurpose="own" />);
  const file = new File(['%PDF-test'], 'my-canva.pdf', { type: 'application/pdf' });
  const input = document.querySelector('input[type="file"]')!;

  expect(input).toHaveAttribute('accept', expect.stringContaining('application/pdf'));

  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('checkbox', { name: /These are my files/u }));
  return file;
}

it('prepares every PDF page before uploading and resumes a partial upload without repeating saved pages', async () => {
  const pages = [1, 2].map(number => new File(['image'], `page-${number}.webp`, { type: 'image/webp' }));
  prepared.mockImplementation(async (_file, _count, progress) => {
    progress('Preparing PDF page 2 of 2…');
    return pages;
  });
  const uploads: string[] = [];
  const preferences: any[] = [];
  let failSecond = true;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options.body instanceof FormData) {
      const file = options.body.get('file') as File;
      uploads.push(file.name);
      if (file.name === 'page-2.webp' && failSecond) {
        failSecond = false;
        return { ok: false, json: async () => ({ error: 'Connection interrupted. Retry to finish.' }) };
      }
      return { ok: true, json: async () => ({ asset: { id: file.name, name: file.name, role: 'reference', mimeType: file.type } }) };
    }
    preferences.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({}) };
  }));
  const original = view();
  fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
  await screen.findByRole('alert');

  expect(preferences).toEqual([]);
  expect(uploads).toEqual(['page-1.webp', 'page-2.webp']);

  fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }));
  await waitFor(() => expect(preferences).toHaveLength(1));

  expect(prepared).toHaveBeenCalledOnce();
  expect(prepared).toHaveBeenCalledWith(original, 6, expect.any(Function));
  expect(uploads).toEqual(['page-1.webp', 'page-2.webp', 'page-2.webp']);
  expect(preferences[0].input.values).toMatchObject({ mode: 'keep_design', referenceIds: ['page-1.webp', 'page-2.webp'], ownedReferenceIds: ['page-1.webp', 'page-2.webp'] });
});

it('shows preparation progress and does not upload partial pages when a PDF exceeds the remaining slots', async () => {
  let finish: (pages: File[]) => void;
  prepared.mockImplementation(async (_file, _count, progress) => {
    progress('Preparing PDF page 1 of 6…');
    return new Promise<File[]>((resolve) => {
      finish = resolve;
    });
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  view();
  fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Preparing PDF page 1 of 6');
  expect(screen.getByRole('button', { name: 'Adding your files…' })).toBeDisabled();

  finish!(Array.from({ length: 7 }, (_, number) => new File(['page'], `${number}.webp`, { type: 'image/webp' })));

  expect(await screen.findByRole('alert')).toHaveTextContent('six pages');
  expect(fetch).not.toHaveBeenCalled();
});
