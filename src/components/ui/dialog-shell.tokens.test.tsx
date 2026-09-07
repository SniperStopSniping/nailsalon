import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DialogShell } from './dialog-shell';

/**
 * `DialogShell` portals into `document.body`, which is outside the subtree that
 * defines the `--owner-*` token layer. Every owner dialog styled from those
 * tokens — Edit Service among them — therefore painted a transparent panel and
 * let the page behind read through it. `AppModal` already carries the scope for
 * exactly this reason and has its own test; this is the same contract for the
 * shell the other 80-odd dialogs use.
 */
describe('DialogShell owner token scope', () => {
  it('carries the owner token scope, because the dialog is portalled outside the shell', () => {
    render(
      <DialogShell
        isOpen
        onClose={() => {}}
        contentClassName="bg-[var(--owner-surface)]"
      >
        <p>body</p>
      </DialogShell>,
    );

    expect(screen.getByTestId('dialog-shell-overlay')).toHaveClass('owner-theme-scope');
  });

  it('renders the panel inside the scoped root, so the tokens actually reach it', () => {
    render(
      <DialogShell
        isOpen
        onClose={() => {}}
        contentClassName="bg-[var(--owner-surface)] text-[var(--owner-ink)]"
      >
        <p>body</p>
      </DialogShell>,
    );

    const overlay = screen.getByTestId('dialog-shell-overlay');
    const content = screen.getByTestId('dialog-shell-content');

    // Containment is the whole point: the class is useless if the panel that
    // spends the tokens is not underneath it.
    expect(overlay).toContainElement(content);
    expect(content).toHaveClass('bg-[var(--owner-surface)]');
  });

  it('declares the scope on the shell itself rather than leaving it to callers', () => {
    // There are ~85 DialogShell call sites. A per-caller opt-in is what left
    // this broken, so the class belongs in the shell and must stay there.
    const source = readFileSync(
      join(process.cwd(), 'src/components/ui/dialog-shell.tsx'),
      'utf8',
    );

    expect(source).toContain('owner-theme-scope');
  });
});
