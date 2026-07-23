import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppModal } from './AppModal';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const MotionDiv = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>>(
    (props, ref) => {
      const domProps = { ...props };
      const children = domProps.children as React.ReactNode;

      for (const key of [
        'animate',
        'children',
        'drag',
        'dragConstraints',
        'dragControls',
        'dragElastic',
        'dragListener',
        'exit',
        'initial',
        'onDragEnd',
        'transition',
      ]) {
        delete domProps[key];
      }

      return React.createElement('div', { ...domProps, ref }, children);
    },
  );
  MotionDiv.displayName = 'MotionDiv';

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      div: MotionDiv,
    },
    useAnimation: () => ({ start: vi.fn() }),
    useDragControls: () => ({ start: vi.fn() }),
  };
});

describe('AppModal', () => {
  it('gives every dashboard app a bounded native touch-scroll region', async () => {
    render(
      <AppModal isOpen onClose={vi.fn()} allowDragToDismiss={false}>
        <div>Dashboard content</div>
      </AppModal>,
    );

    expect(await screen.findByTestId('app-modal-panel')).toHaveClass('min-h-0', 'overflow-hidden');
    expect(screen.getByTestId('app-modal-scroll-region')).toHaveClass(
      'min-h-0',
      'flex-1',
      'touch-pan-y',
      'overflow-y-auto',
      'overscroll-contain',
    );
  });
});
