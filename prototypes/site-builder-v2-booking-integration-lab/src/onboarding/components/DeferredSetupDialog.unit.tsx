import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ComponentType, lazy, useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from '../../ui/Dialog';
import { DeferredSetupDialog } from './DeferredSetupDialog';

type EditorProps = { open: boolean; onClose: () => void };

function createEditor() {
  let finish!: (module: { default: ComponentType<EditorProps> }) => void;
  let fail!: (error: Error) => void;
  const load = vi.fn(() => new Promise<{ default: ComponentType<EditorProps> }>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  }));
  const mounts = vi.fn();
  const closes = vi.fn();
  const Editor = lazy(load);
  function LoadedEditor({ open, onClose }: EditorProps) {
    const [draft, setDraft] = useState('');
    useEffect(() => {
      mounts();
    }, []);
    useEffect(() => {
      if (!open) {
        closes();
      }
    }, [open]);
    return (
      <Dialog onClose={onClose} open={open} title="Gallery">
        <label>
          Photo caption
          <input value={draft} onChange={event => setDraft(event.target.value)} />
        </label>
      </Dialog>
    );
  }
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open Gallery</button>
        <DeferredSetupDialog onClose={() => setOpen(false)} open={open} title="Gallery">
          <Editor onClose={() => setOpen(false)} open={open} />
        </DeferredSetupDialog>
      </>
    );
  }
  return {
    closes,
    fail: () => fail(new Error('Chunk unavailable')),
    finish: () => finish({ default: LoadedEditor }),
    Harness,
    load,
    mounts,
  };
}

describe('DeferredSetupDialog', () => {
  it('does not request the optional editor until it is opened', async () => {
    const editor = createEditor();
    render(<editor.Harness />);

    expect(editor.load).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Gallery' }));

    expect(editor.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Gallery' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Opening editor…');

    await act(async () => editor.finish());

    expect(screen.getByRole('textbox', { name: 'Photo caption' })).toBeVisible();
  });

  it('keeps the editor mounted after closing so cleanup and draft state are preserved', async () => {
    const editor = createEditor();
    render(<editor.Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Gallery' }));
    await act(async () => editor.finish());
    fireEvent.change(screen.getByRole('textbox', { name: 'Photo caption' }), { target: { value: 'Saved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close Gallery' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editor.closes).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open Gallery' }));

    expect(screen.getByRole('textbox', { name: 'Photo caption' })).toHaveValue('Saved draft');
    expect(editor.load).toHaveBeenCalledTimes(1);
    expect(editor.mounts).toHaveBeenCalledTimes(1);
  });

  it('allows dismissal during a slow download without reopening when it completes', async () => {
    const editor = createEditor();
    render(<editor.Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Gallery' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => editor.finish());

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editor.closes).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open Gallery' }));

    expect(screen.getByRole('textbox', { name: 'Photo caption' })).toBeVisible();
  });

  it.each([false, true])('restores the trigger after closing (download completed: %s)', async (loaded) => {
    const editor = createEditor();
    render(<editor.Harness />);
    const trigger = screen.getByRole('button', { name: 'Open Gallery' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close Gallery' })).toHaveFocus());
    if (loaded) {
      await act(async () => editor.finish());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Close Gallery' })).toHaveFocus());
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close Gallery' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    if (!loaded) {
      await act(async () => editor.finish());
    }
  });

  it('offers reload and dismissal if the download fails without blocking the rest of setup', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const editor = createEditor();
      render(<editor.Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Gallery' }));
      await act(async () => editor.fail());

      expect(screen.getByRole('alert')).toHaveTextContent('Close it to continue setup, or reload to try again.');
      expect(screen.getByRole('button', { name: 'Reload setup' })).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open Gallery' })).toBeEnabled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
