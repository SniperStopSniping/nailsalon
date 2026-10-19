import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import type { NativePhotoChoice } from './canva-native-edits';
import { CanvaNativePhotoEditor } from './CanvaNativePhotoEditor';
import type { CustomSitePayload } from './contracts';

const state = vi.hoisted(() => ({ load: vi.fn(), dispose: vi.fn(), fail: false }));
vi.mock('./native-image-loader', () => ({ nativeImageLoader: (media: unknown, ready: (id: string, data: string | null) => void) => {
  state.load(media);
  return { request: (id: string) => ready(id, state.fail ? null : 'data:image/webp;base64,UklGRg=='), dispose: state.dispose };
} }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.fail = false;
});

function fixture() {
  const portrait: NativePhotoChoice = { mediaId: 'a0000000-0000-4000-8000-000000000002', role: 'profile', width: 400, height: 600, alt: 'Owner portrait', name: 'portrait.webp' };
  const wide: NativePhotoChoice = { mediaId: 'a0000000-0000-4000-8000-000000000003', role: 'gallery', width: 600, height: 400, alt: 'Salon interior', name: 'salon.webp' };
  const tall: NativePhotoChoice = { mediaId: 'a0000000-0000-4000-8000-000000000004', role: 'gallery', width: 400, height: 900, alt: 'Tall nail photograph', name: 'nails.webp' };
  const image = ({ name: _name, ...photo }: NativePhotoChoice) => photo;
  const source = compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 300, height: 600, alt: 'Owner artwork' }], areas: [], visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: false, manualOrigin: { siteId: 'a0000000-0000-4000-8000-000000000005', revisionId: 'a0000000-0000-4000-8000-000000000006', revision: 1 }, nativeContent: [
    { type: 'about', id: 'about', beforePage: 0, title: 'About', textSectionIds: [], image: image(portrait), showBusinessName: true, showInstagram: false, showBookingButton: true },
    { type: 'gallery', id: 'gallery', beforePage: 1, title: 'Gallery', layout: 'grid', images: [image(wide), image(tall)] },
  ] });
  const payload: CustomSitePayload = { source, data: { business: { name: 'Test Studio', city: '', address: null, bio: '', hours: {} }, services: [], preview: true, currency: 'CAD' }, images: {}, nativeMedia: { artifactId: 'a0000000-0000-4000-8000-000000000007', mediaIds: [portrait.mediaId, wide.mediaId, tall.mediaId] } };
  return { payload, choices: [portrait, wide, tall], portrait, wide, tall };
}

function openEditor() {
  const summary = screen.getByText('About & Gallery photos');
  const details = summary.closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

it('loads only the opened photo, preserves proportions and sends exact gallery order/description edits', async () => {
  const { payload, choices, wide, tall } = fixture();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(<CanvaNativePhotoEditor payload={payload} choices={choices} disabled={false} onSave={onSave} />);

  expect(state.load).not.toHaveBeenCalled();

  openEditor();
  await screen.findByRole('img', { name: 'Owner portrait' });
  fireEvent.change(screen.getByLabelText('Choose a section'), { target: { value: 'gallery' } });

  const photo = await screen.findByRole('img', { name: 'Salon interior' });

  expect(photo).toHaveAttribute('width', '600');
  expect(photo).toHaveAttribute('height', '400');
  expect(photo).toHaveStyle({ objectFit: 'contain' });
  expect(screen.getByRole('button', { name: 'Move earlier' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Move later' }));

  expect(onSave).toHaveBeenLastCalledWith('gallery', { type: 'move', mediaId: wide.mediaId, direction: 'later' });

  fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { value: tall.mediaId } });
  await screen.findByRole('img', { name: 'Tall nail photograph' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Photo description' }), { target: { value: 'A long nail-art close-up' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save description' }));

  expect(onSave).toHaveBeenLastCalledWith('gallery', { type: 'describe', mediaId: tall.mediaId, alt: 'A long nail-art close-up' });

  fireEvent.change(screen.getByLabelText('Gallery layout'), { target: { value: 'editorial' } });

  expect(onSave).toHaveBeenLastCalledWith('gallery', { type: 'layout', layout: 'editorial' });

  view.unmount();

  expect(state.dispose).toHaveBeenCalled();
});

it('removes a photo from the draft and offers a saved same-role replacement', async () => {
  const { payload, choices, tall, wide } = fixture();
  const gallery = payload.source.canva!.nativeContent!.find(block => block.type === 'gallery')!;
  if (gallery.type !== 'gallery') {
    throw new Error('Missing gallery fixture');
  }
  gallery.images = [gallery.images[0]!];
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<CanvaNativePhotoEditor payload={payload} choices={choices} disabled={false} onSave={onSave} />);
  openEditor();
  fireEvent.change(await screen.findByLabelText('Choose a section'), { target: { value: 'gallery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove from draft' }));

  expect(onSave).toHaveBeenLastCalledWith('gallery', { type: 'remove', mediaId: wide.mediaId });
  expect(screen.getByLabelText('Choose a saved photo')).toHaveValue(tall.mediaId);

  fireEvent.click(screen.getByRole('button', { name: 'Replace selected photo' }));

  expect(onSave).toHaveBeenLastCalledWith('gallery', { type: 'use', mediaId: tall.mediaId, replaceId: wide.mediaId, alt: tall.alt });
  expect(screen.queryByRole('option', { name: 'portrait.webp' })).not.toBeInTheDocument();
});

it('blocks saves while a request is pending and provides explicit photo-load retry', async () => {
  state.fail = true;
  const { payload, choices } = fixture();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<CanvaNativePhotoEditor payload={payload} choices={choices} disabled onSave={onSave} />);
  openEditor();
  const retry = await screen.findByRole('button', { name: 'Retry photo' });

  expect(retry).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save description' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove from draft' })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});

it('retries a failed photo and cancels its loader when the editor closes', async () => {
  state.fail = true;
  const { payload, choices } = fixture();
  render(<CanvaNativePhotoEditor payload={payload} choices={choices} disabled={false} onSave={vi.fn()} />);
  openEditor();
  const retry = await screen.findByRole('button', { name: 'Retry photo' });
  state.fail = false;
  fireEvent.click(retry);
  await screen.findByRole('img', { name: 'Owner portrait' });
  const details = screen.getByText('About & Gallery photos').closest('details')!;
  details.open = false;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());

  expect(state.dispose).toHaveBeenCalledTimes(2);
});

it('requires upload rights and sends a new replacement photo to the chosen section without changing artwork', async () => {
  const { payload, choices, wide } = fixture();
  const onUpload = vi.fn().mockResolvedValue(undefined);
  const onSave = vi.fn();
  render(<CanvaNativePhotoEditor payload={payload} choices={choices} disabled={false} onSave={onSave} uploadsEnabled onUpload={onUpload} />);
  openEditor();
  fireEvent.change(await screen.findByLabelText('Choose a section'), { target: { value: 'gallery' } });
  const input = screen.getByLabelText('Choose new About or Gallery photo');
  const file = new File(['fixture'], 'New photo.png', { type: 'image/png' });

  expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeDisabled();

  fireEvent.change(input, { target: { files: [file] } });

  expect(onUpload).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox', { name: 'I own or have permission to use this photo.' }));
  fireEvent.change(screen.getByLabelText('New photo description (optional)'), { target: { value: 'My new nail-art photo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload replacement photo' }));
  fireEvent.change(input, { target: { files: [file] } });

  expect(onUpload).toHaveBeenCalledWith('gallery', file, 'My new nail-art photo', wide.mediaId, undefined);
  expect(onSave).not.toHaveBeenCalled();
  expect(payload.source.canva!.pages[0]!.alt).toBe('Owner artwork');
});

it.each(['manual', 'ai'])('offers a first photo gallery for %s Canva without making the owner return to onboarding', async (mode) => {
  const { payload } = fixture();
  payload.source.canva!.nativeContent = [];
  if (mode === 'ai') {
    payload.source = compileCanvaDesign({ ...payload.source.canva!, manualOrigin: undefined });
  }
  const onUpload = vi.fn().mockResolvedValue(undefined);
  render(<CanvaNativePhotoEditor payload={payload} choices={[]} disabled={false} onSave={vi.fn()} uploadsEnabled onUpload={onUpload} />);
  openEditor();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'I own or have permission to use this photo.' }));
  fireEvent.click(screen.getByRole('button', { name: 'Upload a photo' }));
  const file = new File(['fixture'], 'Salon-photo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Choose new About or Gallery photo'), { target: { files: [file] } });

  expect(onUpload).toHaveBeenCalledWith('native-photo-gallery', file, 'Salon photo', undefined, true);
  expect(screen.queryByLabelText('Gallery layout')).not.toBeInTheDocument();
});
