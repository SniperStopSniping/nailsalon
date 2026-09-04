import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type { CustomDesignInteractiveArea } from '../model/types';
import { HotspotOverlay } from './HotspotOverlay';

const area = (
  overrides: Partial<CustomDesignInteractiveArea> = {},
): CustomDesignInteractiveArea => ({
  id: 'area-small',
  accessibleLabel: 'Instagram profile',
  action: {
    type: 'instagram',
    destination: { username: 'luster.nails' },
  },
  geometry: { x: 10, y: 15, width: 5, height: 5 },
  labelConfirmed: true,
  reviewStatus: 'approved',
  semanticOrder: 0,
  validationStatus: 'valid',
  ...overrides,
});

describe('owner hotspot overlay', () => {
  it('shows labelled move and resize controls at normalized geometry', () => {
    render(
      <HotspotOverlay
        areas={[area()]}
        renderedHeight={500}
        renderedWidth={500}
        selectedAreaId="area-small"
      />,
    );

    const overlay = screen.getByRole('group', { name: 'Clickable area editor' });
    const rectangle = screen.getByRole('group', {
      name: 'Clickable area: Instagram profile',
    });

    expect(rectangle).toHaveStyle({
      height: '5%',
      left: '10%',
      top: '15%',
      width: '5%',
    });
    expect(withinOverlay(overlay, 'Move clickable area: Instagram profile'))
      .toBeVisible();
    expect(
      screen.getAllByRole('button', { name: /Resize Instagram profile from/ }),
    ).toHaveLength(8);

    screen.getAllByRole('button', { name: /Resize Instagram profile from/ })
      .forEach((handle) => {
        expect(handle).toHaveAttribute('data-handle-inset', 'true');
        expect(handle).toHaveAttribute('data-hit-target-max-size', '44');
        expect(handle).toHaveAttribute('data-visual-size', '14');
      });
  });

  it('warns below 44px without changing the stored rectangle', () => {
    render(
      <HotspotOverlay
        areas={[area()]}
        renderedHeight={500}
        renderedWidth={500}
      />,
    );
    const rectangle = screen.getByRole('group', {
      name: 'Clickable area: Instagram profile',
    });

    expect(rectangle).toHaveAttribute('data-target-warning', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Smaller than 44 × 44px');
    expect(rectangle).toHaveStyle({ height: '5%', width: '5%' });
  });

  it('does not warn for a safe rendered target and exposes review state', () => {
    render(
      <HotspotOverlay
        areas={[area({
          geometry: { x: 10, y: 10, width: 20, height: 20 },
          reviewReason: 'owner_review_required',
          reviewStatus: 'needs_review',
        })]}
        renderedHeight={500}
        renderedWidth={500}
      />,
    );
    const rectangle = screen.getByRole('group', {
      name: 'Clickable area: Instagram profile',
    });

    expect(rectangle).toHaveAttribute('data-target-warning', 'false');
    expect(rectangle).toHaveAttribute('data-review-status', 'needs_review');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('provides keyboard move and resize alternatives plus deliberate handles', () => {
    const onKeyboardMove = vi.fn();
    const onKeyboardResize = vi.fn();
    const onMoveStart = vi.fn();
    const onResizeStart = vi.fn();
    render(
      <HotspotOverlay
        areas={[area()]}
        renderedHeight={1_000}
        renderedWidth={1_000}
        selectedAreaId="area-small"
        onKeyboardMove={onKeyboardMove}
        onKeyboardResize={onKeyboardResize}
        onMoveStart={onMoveStart}
        onResizeStart={onResizeStart}
      />,
    );

    const move = screen.getByRole('button', {
      name: 'Move clickable area: Instagram profile',
    });
    fireEvent.keyDown(move, { key: 'ArrowRight', shiftKey: true });

    expect(onKeyboardMove).toHaveBeenCalledWith('area-small', { x: 5, y: 0 });

    fireEvent.pointerDown(move, { pointerId: 1 });

    expect(onMoveStart).toHaveBeenCalledWith('area-small', expect.anything());

    const southeast = screen.getByRole('button', {
      name: 'Resize Instagram profile from south east',
    });
    fireEvent.keyDown(southeast, { key: 'ArrowDown' });

    expect(onKeyboardResize).toHaveBeenCalledWith(
      'area-small',
      'south_east',
      { x: 0, y: 1 },
    );

    fireEvent.pointerDown(southeast, { pointerId: 2 });

    expect(onResizeStart).toHaveBeenCalledWith(
      'area-small',
      'south_east',
      expect.anything(),
    );
  });

  it('derives top-right edge placement for narrow areas without mutating geometry', () => {
    const edgeArea = area({
      geometry: { x: 95, y: 0, width: 5, height: 5 },
    });
    const originalGeometry = { ...edgeArea.geometry };
    render(
      <HotspotOverlay
        areas={[edgeArea]}
        renderedHeight={600}
        renderedWidth={320}
      />,
    );

    const rectangle = screen.getByRole('group', {
      name: 'Clickable area: Instagram profile',
    });

    expect(rectangle).toHaveAttribute('data-edge-right', 'true');
    expect(rectangle).toHaveAttribute('data-edge-top', 'true');
    expect(rectangle).toHaveAttribute('data-edge-bottom', 'false');
    expect(rectangle).toHaveAttribute('data-narrow-inline', 'true');
    expect(rectangle).toHaveAttribute('data-short-block', 'true');
    expect(rectangle).toHaveStyle({
      '--custom-design-owner-area-height': '30px',
      '--custom-design-owner-area-width': '16px',
      '--custom-design-owner-popover-max-width': '260px',
      'height': '5%',
      'left': '95%',
      'top': '0%',
      'width': '5%',
    });
    expect(edgeArea.geometry).toEqual(originalGeometry);
  });

  it('flips warning placement data at the bottom-right edge without enlarging the area', () => {
    const edgeArea = area({
      geometry: { x: 90, y: 92, width: 10, height: 8 },
    });
    const originalGeometry = { ...edgeArea.geometry };
    render(
      <HotspotOverlay
        areas={[edgeArea]}
        renderedHeight={600}
        renderedWidth={320}
      />,
    );

    const rectangle = screen.getByRole('group', {
      name: 'Clickable area: Instagram profile',
    });

    expect(rectangle).toHaveAttribute('data-edge-right', 'true');
    expect(rectangle).toHaveAttribute('data-edge-top', 'false');
    expect(rectangle).toHaveAttribute('data-edge-bottom', 'true');
    expect(rectangle).toHaveAttribute('data-target-warning', 'true');
    expect(rectangle).toHaveStyle({
      height: '8%',
      left: '90%',
      top: '92%',
      width: '10%',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Smaller than 44 × 44px');
    expect(edgeArea.geometry).toEqual(originalGeometry);
  });

  it('gives a very small selected area usable pointer resize controls', async () => {
    const user = userEvent.setup();
    const onResize = vi.fn();
    const tinyArea = area({
      geometry: { x: 99.99, y: 99.99, width: 0.01, height: 0.01 },
    });
    const originalGeometry = { ...tinyArea.geometry };
    render(
      <HotspotOverlay
        areas={[tinyArea]}
        renderedHeight={600}
        renderedWidth={320}
        selectedAreaId={tinyArea.id}
        onKeyboardResize={onResize}
      />,
    );

    const resizePad = screen.getByRole('group', {
      name: 'Resize clickable area: Instagram profile',
    });
    const wider = screen.getByRole('button', {
      name: 'Make Instagram profile wider',
    });
    const taller = screen.getByRole('button', {
      name: 'Make Instagram profile taller',
    });

    expect(resizePad).toHaveAttribute(
      'data-testid',
      'custom-design-resize-pad-area-small',
    );
    expect(wider).toHaveAttribute('data-min-target-size', '44');
    expect(wider).toHaveAttribute('data-resize-step-pixels', '12');

    await user.click(wider);

    expect(onResize).toHaveBeenCalledWith(
      'area-small',
      'west',
      { x: -12, y: 0 },
    );

    await user.click(taller);

    expect(onResize).toHaveBeenCalledWith(
      'area-small',
      'north',
      { x: 0, y: -12 },
    );

    taller.focus();

    expect(taller).toHaveFocus();
    expect(tinyArea.geometry).toEqual(originalGeometry);
  });
});

function withinOverlay(overlay: HTMLElement, label: string): HTMLElement {
  const control = overlay.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!control) {
    throw new Error(`Missing control: ${label}`);
  }
  return control;
}
