import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackButton, ModalHeader } from './AppModal';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const MotionDiv = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>>(
    (props, ref) => {
      const domProps = { ...props };
      const children = domProps.children as React.ReactNode;

      for (const key of ['animate', 'children', 'drag', 'dragConstraints', 'dragControls', 'dragElastic', 'dragListener', 'exit', 'initial', 'onDragEnd', 'transition']) {
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

/**
 * A real service called "Gel Manicure + Gel Pedicure" wrapped this header's
 * title onto a second line, which overflowed the fixed 52px row and printed
 * through the Back control next to it.
 */
const LONG_TITLE = 'Gel Manicure + Gel Pedicure';

describe('ModalHeader long titles', () => {
  it('keeps a long title on one truncated line instead of wrapping into the actions', () => {
    render(
      <ModalHeader
        title={LONG_TITLE}
        leftAction={<BackButton onClick={() => {}} label="Services" />}
        rightAction={<button type="button">Edit</button>}
      />,
    );

    const title = screen.getByText(LONG_TITLE);

    expect(title).toHaveClass('truncate');
    // Truncation only works if the flex item is allowed to shrink below its
    // content width; without this the title grows and overlaps the actions.
    expect(title.parentElement).toHaveClass('min-w-0');
  });

  it('never lets the side actions be squeezed by the title', () => {
    render(
      <ModalHeader
        title={LONG_TITLE}
        leftAction={<BackButton onClick={() => {}} label="Services" />}
        rightAction={<button type="button">Edit</button>}
      />,
    );

    const back = screen.getByRole('button', { name: /Services/ });
    const edit = screen.getByRole('button', { name: 'Edit' });

    expect(back.closest('div')).toHaveClass('shrink-0');
    expect(edit.closest('div')).toHaveClass('shrink-0');
  });

  it('still renders the title and both actions', () => {
    render(
      <ModalHeader
        title={LONG_TITLE}
        subtitle="Combos"
        leftAction={<BackButton onClick={() => {}} label="Services" />}
        rightAction={<button type="button">Edit</button>}
      />,
    );

    expect(screen.getByText(LONG_TITLE)).toBeInTheDocument();
    expect(screen.getByText('Combos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});
