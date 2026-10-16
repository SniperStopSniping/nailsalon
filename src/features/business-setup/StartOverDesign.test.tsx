import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { StartOverDesign } from './StartOverDesign';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

it('cancels without resetting or generating anything and needs no design prompt', () => {
  const reset = vi.fn();
  render(<StartOverDesign revision={7} disabled={false} onReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: /Start over/ }));

  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start fresh & upload image' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(reset).not.toHaveBeenCalled();
});

it.each([true, false])('resets first, then opens the chosen entry point (upload: %s)', async (upload) => {
  const reset = vi.fn(async () => {});
  render(<StartOverDesign revision={7} disabled={false} onReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
  fireEvent.click(screen.getByRole('button', { name: upload ? 'Start fresh & upload image' : 'Start fresh with an idea' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  expect(reset).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledWith(upload, expect.any(String), 7);
});

it('retries a lost response with the same operation and original revision even after a parent refresh', async () => {
  const reset = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(undefined);
  const { rerender } = render(<StartOverDesign revision={7} disabled={false} onReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Start fresh & upload image' }));
  await screen.findByRole('alert');
  rerender(<StartOverDesign revision={8} disabled={false} onReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry start over' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  expect(reset.mock.calls[1]).toEqual(reset.mock.calls[0]);
});

it('shows progress and prevents closing or duplicate resets while running', async () => {
  let finish!: () => void;
  const reset = vi.fn(() => new Promise<void>((resolve) => {
    finish = resolve;
  }));
  render(<StartOverDesign revision={7} disabled={false} onReset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Start fresh & upload image' }));

  expect(screen.getByRole('status')).toHaveTextContent('Starting fresh');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  const escape = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), escape);

  expect(escape.defaultPrevented).toBe(true);

  finish();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('disables resetting while another owner action runs', () => {
  render(<StartOverDesign revision={7} disabled onReset={vi.fn()} />);

  expect(screen.getByRole('button', { name: /Start over/ })).toBeDisabled();
});
