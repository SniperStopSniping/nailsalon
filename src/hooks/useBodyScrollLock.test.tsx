import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useBodyScrollLock } from './useBodyScrollLock';

function Lock() {
  useBodyScrollLock(true);
  return null;
}

function NestedLocks() {
  useBodyScrollLock(true);
  return <Lock />;
}

describe('useBodyScrollLock', () => {
  afterEach(() => {
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('keeps the body locked until the final sibling overlay closes', () => {
    const { rerender } = render(
      <>
        <Lock />
        <Lock />
      </>,
    );

    expect(document.body).toHaveStyle({ position: 'fixed' });

    rerender(<Lock />);

    expect(document.body).toHaveStyle({ position: 'fixed' });

    rerender(<div />);

    expect(document.body).not.toHaveStyle({ position: 'fixed' });
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });

  it('restores the body when nested overlays unmount together', () => {
    document.body.style.overflow = 'clip';
    const { unmount } = render(<NestedLocks />);

    expect(document.body).toHaveStyle({ position: 'fixed' });

    unmount();

    expect(document.body).not.toHaveStyle({ position: 'fixed' });
    expect(document.body).toHaveStyle({ overflow: 'clip' });
  });
});
