import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HotspotEditor } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/HotspotEditor';
import type { CustomDesignImageItem, CustomDesignInteractiveArea } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/types';

const area = (id = 'instagram'): CustomDesignInteractiveArea => ({
  id,
  accessibleLabel: 'Instagram',
  action: { type: 'instagram', destination: { username: 'luster_ai_test_only' } },
  geometry: { x: 20, y: 20, width: 30, height: 1 },
  labelConfirmed: true,
  reviewStatus: 'approved',
  semanticOrder: 0,
  validationStatus: 'valid',
});

const image = (areas: CustomDesignInteractiveArea[], aspectRatio = 390 / 2597): CustomDesignImageItem => ({
  id: 'artwork',
  assetId: 'original',
  altText: 'Test artwork',
  decorative: false,
  fileName: 'artwork.png',
  fileSize: 1000,
  height: aspectRatio > 1 ? 100 : 2597,
  width: aspectRatio > 1 ? 100 * aspectRatio : 390,
  mimeType: 'image/png',
  aspectRatio,
  interactiveAreas: areas,
});

function openEditor(artwork: CustomDesignImageItem) {
  const onCommit = vi.fn();
  render(<HotspotEditor image={artwork} asset={{ status: 'ready', url: 'blob:https://luster.test/original' }} open onCancel={vi.fn()} onCommit={onCommit} />);
  return onCommit;
}

describe('Canva phone tap targets', () => {
  it('enlarges one long-page target in one owner action and keeps the source and link identity', async () => {
    const original = area();
    const artwork = image([original]);
    const onCommit = openEditor(artwork);
    await userEvent.click(screen.getByRole('button', { name: 'Make easier to tap' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    const [id, saved] = onCommit.mock.calls[0]!;

    expect(id).toBe(artwork.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: original.id, action: original.action, labelConfirmed: true, reviewStatus: 'approved' });
    expect(saved[0].geometry.width / 100 * 280).toBeGreaterThanOrEqual(44);
    expect(saved[0].geometry.height / 100 * (280 / artwork.aspectRatio)).toBeGreaterThanOrEqual(44);
    expect(screen.getByRole('img', { name: 'Design being edited' })).toHaveAttribute('src', 'blob:https://luster.test/original');
    expect(original.geometry).toEqual({ x: 20, y: 20, width: 30, height: 1 });
  });

  it('keeps a target at the image edge within the artwork', async () => {
    const original = { ...area(), geometry: { x: 99, y: 99, width: 1, height: 1 } };
    const onCommit = openEditor(image([original]));
    await userEvent.click(screen.getByRole('button', { name: 'Make easier to tap' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    const rect = onCommit.mock.calls[0]![1][0].geometry;

    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(100);
    expect(rect.y + rect.height).toBeLessThanOrEqual(100);
  });

  it('refuses to enlarge over an adjacent link and preserves both existing positions', async () => {
    const first = area();
    const next = { ...area('email'), accessibleLabel: 'Email', semanticOrder: 1, geometry: { x: 20, y: 21.1, width: 30, height: 1 } };
    const onCommit = openEditor(image([first, next]));
    await userEvent.click(screen.getByRole('button', { name: 'Make easier to tap' }));

    expect(screen.getByText(/There isn’t enough room for a larger tap area here/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit.mock.calls[0]![1].map((a: CustomDesignInteractiveArea) => a.geometry)).toEqual([first.geometry, next.geometry]);
  });

  it('keeps replacement-position review required after enlarging a target', async () => {
    const pending = { ...area(), reviewStatus: 'needs_review' as const, reviewReason: 'aspect_ratio_changed' as const };
    const onCommit = openEditor(image([pending]));
    await userEvent.click(screen.getByRole('button', { name: 'Make easier to tap' }));

    expect(screen.getByRole('button', { name: 'Approve this position' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('explains when a very short banner cannot fit a phone tap target', async () => {
    const original = area();
    const onCommit = openEditor(image([original], 10));
    await userEvent.click(screen.getByRole('button', { name: 'Make easier to tap' }));

    expect(screen.getByText(/This image is too short for an easy-to-tap area/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit.mock.calls[0]![1][0].geometry).toEqual(original.geometry);
  });
});
