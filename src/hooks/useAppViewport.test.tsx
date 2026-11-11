import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useAppViewport } from './useAppViewport';

const viewport = Object.assign(new EventTarget(), { height: 800, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(viewport, { height: 800, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
});

function setup() {
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 800);
  return renderHook(() => useAppViewport());
}

it('shares viewport listeners across nested dialogs and releases them after the last one closes', () => {
  const add = vi.spyOn(viewport, 'addEventListener');
  const remove = vi.spyOn(viewport, 'removeEventListener');
  const first = setup();
  const nested = renderHook(() => useAppViewport());

  expect(add).toHaveBeenCalledTimes(2);

  Object.assign(viewport, { height: 460, offsetTop: 20 });
  act(() => viewport.dispatchEvent(new Event('resize')));

  expect(first.result.current).toMatchObject({ top: 20, height: 460 });
  expect(nested.result.current).toEqual(first.result.current);

  first.unmount();

  expect(remove).not.toHaveBeenCalled();

  nested.unmount();

  expect(remove).toHaveBeenCalledTimes(2);
});

it('recovers after tab return and delayed keyboard dismissal without a viewport resize event', () => {
  vi.useFakeTimers();
  const { result } = setup();
  Object.assign(viewport, { height: 450, offsetTop: 30 });
  act(() => window.dispatchEvent(new Event('pageshow')));

  expect(result.current).toMatchObject({ top: 30, height: 450 });

  act(() => document.dispatchEvent(new Event('focusout')));
  Object.assign(viewport, { height: 800, offsetTop: 0 });
  act(() => vi.advanceTimersByTime(350));

  expect(result.current).toMatchObject({ top: 0, height: 800 });
});

it('preserves native pinch zoom and measures the new bounds after rotation', () => {
  const { result } = setup();
  Object.assign(viewport, { scale: 1.5, height: 400 });
  act(() => viewport.dispatchEvent(new Event('resize')));

  expect(result.current.height).toBe(0);

  Object.assign(viewport, { scale: 1, height: 390, width: 800 });
  act(() => window.dispatchEvent(new Event('orientationchange')));

  expect(result.current).toMatchObject({ height: 390, width: 800 });
});
