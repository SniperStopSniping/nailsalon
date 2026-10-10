import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazy, type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DeferredAdminDialog, DeferredAppModal } from './DeferredAdminContent';

vi.mock('./AppModal', () => ({
  AppModal: ({ children, isOpen, ariaLabel }: { children: ReactNode; isOpen: boolean; ariaLabel?: string }) => isOpen ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null,
}));
vi.mock('@/components/ui/dialog-shell', () => ({
  DialogShell: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => isOpen ? children : null,
}));

function delayedScreen() {
  let resolve!: (value: { default: () => ReactNode }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ default: () => ReactNode }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const load = vi.fn(() => promise);
  return { Screen: lazy(load), load, resolve, reject };
}

describe('deferred owner tools', () => {
  it('does not request closed dialogs, and Back remains available while a dialog loads', async () => {
    const { Screen, load, resolve } = delayedScreen();
    const onClose = vi.fn();
    const { rerender } = render(<DeferredAdminDialog isOpen={false} label="New appointment" onClose={onClose}><Screen /></DeferredAdminDialog>);

    expect(load).not.toHaveBeenCalled();

    rerender(<DeferredAdminDialog isOpen label="New appointment" onClose={onClose}><Screen /></DeferredAdminDialog>);

    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Opening');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onClose).toHaveBeenCalledOnce();

    rerender(<DeferredAdminDialog isOpen={false} label="New appointment" onClose={onClose}><Screen /></DeferredAdminDialog>);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => resolve({ default: () => null }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves child state after the first open instead of resetting drafts on every close', async () => {
    const { Screen, resolve } = delayedScreen();
    const onClose = vi.fn();
    function Draft() {
      const [value, setValue] = useState('');
      return <input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />;
    }
    const { rerender } = render(<DeferredAdminDialog isOpen label="Assistant" onClose={onClose}><Screen /></DeferredAdminDialog>);
    await act(async () => resolve({ default: Draft }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'My question' } });
    rerender(<DeferredAdminDialog isOpen={false} label="Assistant" onClose={onClose}><Screen /></DeferredAdminDialog>);
    rerender(<DeferredAdminDialog isOpen label="Assistant" onClose={onClose}><Screen /></DeferredAdminDialog>);

    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('My question');
  });

  it('keeps the app sheet present through loading and content arrival', async () => {
    const { Screen, load, resolve } = delayedScreen();
    const onClose = vi.fn();
    const { rerender } = render(<DeferredAppModal isOpen={false} label="Clients" onClose={onClose}><Screen /></DeferredAppModal>);

    expect(load).not.toHaveBeenCalled();

    rerender(<DeferredAppModal isOpen label="Clients" onClose={onClose}><Screen /></DeferredAppModal>);
    const shell = screen.getByRole('dialog', { name: 'Clients' });

    expect(screen.getByRole('status')).toHaveTextContent('Opening');

    await act(async () => resolve({ default: () => <p>Client directory</p> }));

    expect(await screen.findByText('Client directory')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBe(shell);
  });

  it('contains a failed import with close and reload recovery', async () => {
    const { Screen, reject } = delayedScreen();
    const onClose = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<DeferredAppModal isOpen label="Services" onClose={onClose}><Screen /></DeferredAppModal>);
      await act(async () => reject(new Error('Synthetic chunk load failure')));

      expect(await screen.findByRole('alert')).toHaveTextContent('This screen couldn’t load');
      expect(screen.getByRole('button', { name: 'Reload app' })).toBeEnabled();

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(onClose).toHaveBeenCalledOnce();

      await waitFor(() => expect(error).toHaveBeenCalled());
    } finally {
      error.mockRestore();
    }
  });
});
