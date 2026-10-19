import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { compileCanvaDesign } from './canva';
import { CanvaAreaEditor } from './CanvaAreaEditor';
import type { CustomSitePayload } from './contracts';

beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {} disconnect() {}
}));

afterEach(() => vi.unstubAllGlobals());

const payload = (): CustomSitePayload => ({
  source: compileCanvaDesign({ version: 1, pages: [{ assetId: 'a0000000-0000-4000-8000-000000000001', width: 300, height: 600, alt: 'Owner artwork' }], areas: [{ id: 'book', page: 0, label: 'Book', geometry: { x: 10, y: 60, width: 80, height: 10 }, action: { type: 'book' } }], visibleText: '', notes: [], dataFingerprint: 'a'.repeat(64), ownerReviewed: false }),
  data: { business: { name: 'Test Studio', city: '', address: null, bio: '', hours: {} }, services: [], preview: true, currency: 'CAD' },
  images: {},
  canvaReviewRequired: true,
});

it('keeps the open editor visible after an artwork acknowledgment is saved', () => {
  const input = payload();
  const onReview = vi.fn();
  const props = { endpoint: '/api/admin/custom-sites?salonSlug=test', disabled: false, onSave: vi.fn(), onReview, open: true, onOpenChange: vi.fn() };
  const view = render(<CanvaAreaEditor payload={input} {...props} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /I checked all printed/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Artwork is correct' }));

  expect(onReview).toHaveBeenCalledOnce();

  view.rerender(<CanvaAreaEditor key="saved-revision" payload={{ ...input, source: { ...input.source, canva: { ...input.source.canva!, ownerReviewed: true } }, canvaReviewRequired: false }} {...props} />);

  expect(screen.getByText('Artwork checked. Review and publish when you’re ready.')).toBeVisible();
});

it('saves manual labels and keyboard movement without altering artwork', () => {
  const input = payload();
  const onSave = vi.fn();
  render(<CanvaAreaEditor payload={input} endpoint="/api/admin/custom-sites?salonSlug=test" disabled={false} onSave={onSave} onReview={vi.fn()} open onOpenChange={vi.fn()} />);
  const image = screen.getByRole('img');
  Object.defineProperties(image, { clientWidth: { value: 300 }, clientHeight: { value: 600 } });
  fireEvent.load(image);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move clickable area: Book' }), { key: 'ArrowRight' });
  fireEvent.change(screen.getByLabelText('Accessible label'), { target: { value: 'Choose an appointment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save clickable areas' }));

  expect(onSave).toHaveBeenCalledOnce();
  expect(onSave.mock.calls[0]![0].canva.pages).toEqual(input.source.canva!.pages);
  expect(onSave.mock.calls[0]![0].canva.areas[0].geometry.x).toBeGreaterThan(10);
  expect(onSave.mock.calls[0]![0].canva.areas[0].label).toBe('Choose an appointment');
  expect(onSave.mock.calls[0]![0].javascript).toBe('');
  expect(screen.getByRole('button', { name: 'Artwork is correct' })).toBeDisabled();
});
