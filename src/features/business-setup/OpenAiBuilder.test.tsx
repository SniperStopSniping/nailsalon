import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { OpenAiBuilder } from './OpenAiBuilder';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('waits for an owner action, recovers the same entry after a lost response and uses the selected salon', async () => {
  const navigate = vi.fn();
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    if (bodies.length === 1) {
      throw new TypeError('Connection lost');
    }
    return Response.json({ data: bodies.length === 2 ? { kind: 'choose', salons: [{ slug: 'studio-a', name: 'Studio A' }, { slug: 'studio-b', name: 'Studio B' }] } : { kind: 'ready', slug: 'studio-b' } });
  }));
  const first = render(<OpenAiBuilder locale="en" onNavigate={navigate} />);

  expect(fetch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Continue to my AI builder' }));
  await screen.findByRole('alert');
  first.unmount();
  render(<OpenAiBuilder locale="en" onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue to my AI builder' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Studio B' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/en/admin/business-setup?salon=studio-b'));

  expect(bodies).toEqual([{}, {}, { salonSlug: 'studio-b' }]);
});
