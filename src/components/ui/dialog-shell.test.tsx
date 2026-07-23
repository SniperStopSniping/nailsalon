import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DialogShell } from './dialog-shell';

describe('DialogShell', () => {
  it('escapes transformed dashboard ancestors and keeps a shrinkable viewport container', async () => {
    render(
      <div data-testid="transformed-parent" style={{ transform: 'translateX(0)' }}>
        <DialogShell isOpen onClose={vi.fn()}>
          <div>Dialog content</div>
        </DialogShell>
      </div>,
    );

    const overlay = await screen.findByTestId('dialog-shell-overlay');
    const container = screen.getByTestId('dialog-shell-container');
    const content = screen.getByText('Dialog content').parentElement;

    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveClass('fixed', 'inset-0', 'min-h-0');
    expect(container).toHaveClass('min-h-0', 'w-full');
    expect(content).toHaveClass('touch-pan-y', 'overflow-y-auto', 'overscroll-contain');
    expect(screen.getByTestId('transformed-parent')).not.toContainElement(overlay);
  });
});
