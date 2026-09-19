'use client';

import { useEffect, useState } from 'react';

export type CustomerViewport = { top: number; height: number; keyboardOpen: boolean };

const readViewport = (): CustomerViewport => {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const top = viewport?.offsetTop ?? 0;
  const active = document.activeElement;
  const editable = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable);
  const keyboardOpen = Boolean(viewport && editable && Math.abs((viewport.scale ?? 1) - 1) < 0.01 && height < window.innerHeight - 120);
  return { top, height, keyboardOpen };
};

export function useCustomerViewport(): CustomerViewport {
  const [viewport, setViewport] = useState<CustomerViewport | null>(null);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    update();
    const visual = window.visualViewport;
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return viewport ?? { top: 0, height: 0, keyboardOpen: false };
}
