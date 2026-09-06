import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppModal, BackButton, ModalHeader } from './AppModal';

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
    motion: { div: MotionDiv },
    useAnimation: () => ({ start: vi.fn() }),
    useDragControls: () => ({ start: vi.fn() }),
  };
});

const source = readFileSync(
  join(process.cwd(), 'src/components/admin/AppModal.tsx'),
  'utf8',
);

describe('AppModal owner chrome', () => {
  it('carries the owner token scope, because the panel is portalled outside the shell', () => {
    render(
      <AppModal isOpen onClose={() => {}} title="Settings">
        <p>body</p>
      </AppModal>,
    );

    const panel = screen.getByTestId('app-modal-panel');

    expect(panel).toHaveClass('owner-theme-scope');
    expect(panel).toHaveClass('bg-[var(--owner-surface)]');
    expect(panel).toHaveClass('rounded-t-owner-sheet');
  });

  it('paints the sheet title from the owner ink and display face', () => {
    render(
      <AppModal isOpen onClose={() => {}} title="Settings">
        <p>body</p>
      </AppModal>,
    );

    const heading = screen.getByRole('heading', { name: 'Settings' });

    expect(heading).toHaveClass('owner-title');
    expect(heading).toHaveClass('text-[var(--owner-ink)]');
  });

  it('renders the back control in the owner accent, not iOS system blue', () => {
    render(<BackButton onClick={() => {}} label="Settings" />);

    const back = screen.getByRole('button', { name: 'Settings' });

    expect(back).toHaveClass('text-[var(--owner-accent)]');
    expect(back).toHaveClass('focus-visible:ring-[var(--owner-focus)]');
    expect(back.className).not.toMatch(/#007AFF/i);
  });

  it('paints the sticky modal header from owner tokens', () => {
    render(<ModalHeader title="Payments & taxes" subtitle="Salon B" />);

    expect(screen.getByText('Payments & taxes')).toHaveClass('text-[var(--owner-ink)]');
    expect(screen.getByText('Salon B')).toHaveClass('text-[var(--owner-muted)]');
  });

  it('keeps no iOS system colours in the file at all', () => {
    expect(source).not.toMatch(/#007AFF/i);
    expect(source).not.toMatch(/#1C1C1E/i);
  });
});
