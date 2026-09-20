import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';

import { clearNormalConfirmHandoff, useNormalBookingFlowMarker, writeNormalConfirmHandoff } from './normalConfirmHandoff.client';

const flow = { flowToken: 'v1.00000000-0000-4000-8000-000000000001.1.synthetic', expiresAt: '2020-01-01T00:00:00Z' };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

it('preserves accepted identity on native Back to a URL from before the handoff', () => {
  const hook = renderHook(() => useNormalBookingFlowMarker('salon-a', null));

  expect(hook.result.current).toBeNull();

  act(() => writeNormalConfirmHandoff('salon-a', flow));

  expect(hook.result.current).toBe('assistant');

  act(() => window.dispatchEvent(new PopStateEvent('popstate')));

  expect(hook.result.current).toBe('assistant');

  act(() => clearNormalConfirmHandoff('salon-a'));

  expect(hook.result.current).toBeNull();
});

it('never adopts a different salon flow or downgrades a damaged flow into legacy create', () => {
  writeNormalConfirmHandoff('salon-a', flow);

  expect(renderHook(() => useNormalBookingFlowMarker('salon-b', null)).result.current).toBeNull();

  sessionStorage.setItem('luster.normal-confirm-handoff.v1.salon-b', 'damaged');

  expect(renderHook(() => useNormalBookingFlowMarker('salon-b', null)).result.current).toBe('assistant');
  expect(renderHook(() => useNormalBookingFlowMarker('salon-c', 'assistant')).result.current).toBe('assistant');
});

it('keeps legacy recovery evidence in the confirmation flow even before an AI marker exists', () => {
  localStorage.setItem('luster.customer-booking.operation.salon-a', 'damaged-but-must-not-be-discarded');

  expect(renderHook(() => useNormalBookingFlowMarker('salon-a', null)).result.current).toBe('assistant');
  expect(renderHook(() => useNormalBookingFlowMarker('salon-b', null)).result.current).toBeNull();
});
