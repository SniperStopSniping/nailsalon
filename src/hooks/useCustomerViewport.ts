'use client';

import { useAppViewport } from './useAppViewport';

export type CustomerViewport = { top: number; height: number; keyboardOpen: boolean };

export function useCustomerViewport(active = true): CustomerViewport {
  const { top, height, keyboardOpen } = useAppViewport(active);
  return { top, height, keyboardOpen };
}
