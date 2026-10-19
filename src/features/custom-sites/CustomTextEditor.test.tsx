import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CustomTextEditor } from './CustomTextEditor';

afterEach(cleanup);

const source = {
  title: 'Studio',
  html: '<main><h1 data-edit="welcome">Welcome</h1><p data-edit="business" data-luster-field="business.name"></p><section data-edit="service"><span data-luster-field="service.priceLabel"></span><button data-luster-book>Book</button></section></main>',
  css: 'h1{font-size:3rem}',
  javascript: '',
  analysis: '',
  limitations: [],
};

it('edits ordinary wording as escaped text while protecting business and booking bindings', async () => {
  const changed = vi.fn();
  render(<CustomTextEditor source={source} onChange={changed} onSave={async () => {}} disabled={false} />);
  fireEvent.click(await screen.findByText('Edit website wording'));

  expect(screen.queryByRole('textbox', { name: 'Website text: business' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Website text: service' })).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: 'Website text: welcome' }), { target: { value: 'Hello <script>alert(1)</script>' } });
  const next = changed.mock.calls[0]![0];
  const document = new DOMParser().parseFromString(next.html, 'text/html');

  // DOMParser produces a detached document without Jest DOM's defaultView.
  const copiedText = document.querySelector('[data-edit="welcome"]')!.textContent;

  expect(copiedText).toBe('Hello <script>alert(1)</script>');
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('[data-luster-field="service.priceLabel"]')).not.toBeNull();
  expect(document.querySelector('[data-luster-book]')).not.toBeNull();
  expect(next.css).toBe(source.css);
  expect(next.javascript).toBe(source.javascript);
});

it('saves from the wording control and disables it during an operation', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const editor = (disabled: boolean) => <CustomTextEditor source={source} onChange={vi.fn()} onSave={save} disabled={disabled} />;
  const view = render(editor(false));
  fireEvent.click(await screen.findByText('Edit website wording'));
  fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));

  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

  view.rerender(editor(true));

  expect(screen.getByRole('textbox', { name: 'Website text: welcome' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save wording' })).toBeDisabled();
});
