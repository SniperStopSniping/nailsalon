import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useCustomerViewport } from './useCustomerViewport';

const listeners = new Map<string, Set<() => void>>();
const viewport = {
  height: 800,
  offsetTop: 0,
  scale: 1,
  addEventListener(name: string, callback: () => void) {
    const callbacks = listeners.get(name) ?? new Set<() => void>();
    callbacks.add(callback);
    listeners.set(name, callbacks);
  },
  removeEventListener(name: string, callback: () => void) {
    listeners.get(name)?.delete(callback);
  },
};

const emit = (name: string) => {
  for (const callback of listeners.get(name) ?? []) {
    callback();
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  listeners.clear();
  viewport.height = 800;
  viewport.offsetTop = 0;
  viewport.scale = 1;
});

it('tracks keyboard resize/pan, ignores pinch zoom, and cleans up listeners', () => {
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 800);
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  const { result, unmount } = renderHook(() => useCustomerViewport());

  expect(result.current).toEqual({ top: 0, height: 800, keyboardOpen: false });

  viewport.height = 500;
  viewport.offsetTop = 12;
  act(() => emit('resize'));

  expect(result.current).toEqual({ top: 12, height: 500, keyboardOpen: true });

  viewport.scale = 1.2;
  act(() => emit('scroll'));

  expect(result.current.keyboardOpen).toBe(false);

  viewport.scale = 1;
  viewport.height = 800;
  viewport.offsetTop = 0;
  act(() => emit('resize'));

  expect(result.current).toEqual({ top: 0, height: 800, keyboardOpen: false });

  unmount();

  expect(listeners.get('resize')?.size ?? 0).toBe(0);
  expect(listeners.get('scroll')?.size ?? 0).toBe(0);

  input.remove();
});
