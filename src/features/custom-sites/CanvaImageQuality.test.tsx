import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CanvaArtworkQuality } from './CanvaArtworkQuality';
import { CanvaImageQuality, CanvaUploadQuality } from './CanvaImageQuality';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('explains a small export before generation without blocking the owner or promising invented detail', () => {
  render(<CanvaImageQuality page={{ width: 279, height: 1280 }} />);

  expect(screen.getByRole('status')).toHaveTextContent('A sharper image would help');
  expect(screen.getByRole('status')).toHaveTextContent('cannot recover missing detail');

  fireEvent.click(screen.getByText('Get a sharper Canva export'));

  expect(screen.getByText(/Aim for at least 1200 pixels wide/)).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('distinguishes sharp vector exports from small embedded photos and warns that wide pages shrink on phones', () => {
  render(
    <>
      <CanvaImageQuality page={{ width: 1600, height: 1000 }} />
      <CanvaUploadQuality files={[new File(['pdf'], 'Canva.pdf', { type: 'application/pdf' })]} />
    </>,
  );

  expect(screen.getByText(/Wide pages shrink on a phone/)).toBeVisible();
  expect(screen.getByText(/low-resolution pictures inside the PDF will still need a better original/)).toBeVisible();
});

it('checks files locally and releases image URLs when files change or the dialog closes', () => {
  const images: any[] = [];
  const create = vi.fn().mockReturnValue('blob:local-test');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  });
  vi.stubGlobal('Image', class {
    naturalWidth = 279;
    naturalHeight = 1280;
    onload: null | (() => void) = null;
    onerror = null;
    src = '';
    constructor() {
      images.push(this);
    }
  });
  const file = new File(['local bytes'], 'my-design.png', { type: 'image/png' });
  const view = render(<CanvaUploadQuality files={[file]} />);
  act(() => images[0].onload());

  expect(screen.getByRole('status')).toHaveTextContent('my-design.png');

  view.rerender(<CanvaUploadQuality files={[]} />);

  expect(revoke).toHaveBeenCalledWith('blob:local-test');
  expect(images[0].onload).toBeNull();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('requires same-design consent for a sharper replacement, supports cancel and locks controls during a write', async () => {
  const onReplace = vi.fn().mockResolvedValue(undefined);
  const pages = [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 279, height: 1280, alt: 'My page' }];
  const view = render(<CanvaArtworkQuality pages={pages} disabled={false} onReplace={onReplace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload sharper image' }));
  const file = new File(['image'], 'sharper.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Sharper Canva export'), { target: { files: [file] } });

  expect(screen.getByRole('button', { name: 'Replace image & keep links' })).toBeDisabled();

  fireEvent.click(screen.getByRole('checkbox', { name: /same design, text and layout/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Replace image & keep links' }));

  expect(onReplace).toHaveBeenCalledWith(pages[0]!.assetId, file);

  view.rerender(<CanvaArtworkQuality pages={pages} disabled onReplace={onReplace} />);

  expect(screen.getByRole('button', { name: 'Replace image & keep links' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Upload sharper image' })).toBeDisabled();

  view.rerender(<CanvaArtworkQuality pages={pages} disabled={false} onReplace={onReplace} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));

  expect(screen.queryByRole('button', { name: 'Replace image & keep links' })).not.toBeInTheDocument();
});
