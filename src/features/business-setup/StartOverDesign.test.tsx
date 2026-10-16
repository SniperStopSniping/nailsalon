import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StartOverDesign } from './StartOverDesign';

const brief = { fidelity: 'match' as const, referenceIds: ['reference'], ownedReferenceIds: ['reference'], websiteAssetIds: ['photo', 'logo'] };
let requests: any[];
let failGeneration: boolean;
const saved = vi.fn(async () => {});
const busy = vi.fn();

beforeEach(() => {
  requests = [];
  failGeneration = false;
  saved.mockClear();
  busy.mockClear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    requests.push(request);
    if (request.action === 'generate' && failGeneration) {
      throw new Error('Connection lost. Your current design is safe.');
    }
    return { ok: true, json: async () => ({ head: { revision: { revision: 8 } } }) };
  }));
});

afterEach(() => vi.unstubAllGlobals());

function setup(disabled = false, missingDetails: string[] = []) {
  render(<StartOverDesign salonSlug="synthetic" revision={7} brief={brief} disabled={disabled} missingDetails={missingDetails} onBusyChange={busy} onSaved={saved} />);
}
function openAndDescribe() {
  fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe your new look' }), { target: { value: 'Minimal white with large photography' } });
}

it('opens a confirmation and cancels without a write or an AI call', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Start over/ }));

  expect(screen.getByRole('button', { name: 'Create new design' })).toBeDisabled();
  expect(screen.getByRole('dialog')).toHaveTextContent('Your business details, services, prices and hours stay saved');

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])('creates a fresh source using the saved revision and chosen references (%s)', async (keepReferences) => {
  setup();
  openAndDescribe();
  if (keepReferences) {
    fireEvent.click(screen.getByRole('checkbox'));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create new design' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(true));

  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ action: 'preferences', input: { expectedRevision: 7, values: keepReferences ? brief : { fidelity: 'inspiration', referenceIds: [], ownedReferenceIds: [], websiteAssetIds: ['photo', 'logo'] } } });
  expect(requests[1]).toMatchObject({ action: 'generate', input: { expectedRevision: 8, startOver: true, message: 'Minimal white with large photography', referenceIds: keepReferences ? ['reference', 'photo', 'logo'] : ['photo', 'logo'] } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(busy.mock.calls.map(call => call[0])).toEqual([true, false]);
});

it('checks the same saved operation after a lost response without another paid generation', async () => {
  setup();
  openAndDescribe();
  failGeneration = true;
  fireEvent.click(screen.getByRole('button', { name: 'Create new design' }));
  await screen.findByRole('alert');

  expect(saved).toHaveBeenCalledWith(false);

  fireEvent.click(screen.getByRole('button', { name: 'Check saved result' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(true));

  expect(requests.map(request => request.action)).toEqual(['preferences', 'generate', 'resume']);
  expect(requests[2].operationId).toBe(requests[1].input.operationId);
});

it('shows progress and prevents double submits and closing during generation', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(async () => await new Promise<Response>((resolve) => {
    finish = resolve;
  }) as Response);
  setup();
  openAndDescribe();
  fireEvent.click(screen.getByRole('button', { name: 'Create new design' }));

  expect(screen.getByRole('status')).toHaveTextContent('Creating your new design');
  expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  const escape = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), escape);

  expect(escape.defaultPrevented).toBe(true);

  finish({ ok: false, json: async () => ({ error: 'Synthetic interruption' }) } as Response);
  await screen.findByRole('alert');
});

it('does not start without essential business information', () => {
  setup(false, ['your opening hours']);
  openAndDescribe();

  expect(screen.getByRole('button', { name: 'Create new design' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('your opening hours');
  expect(fetch).not.toHaveBeenCalled();
});

it('disables start over while another edit runs, after publication or when AI is disabled', () => {
  setup(true);

  expect(screen.getByRole('button', { name: /Start over/ })).toBeDisabled();
});
