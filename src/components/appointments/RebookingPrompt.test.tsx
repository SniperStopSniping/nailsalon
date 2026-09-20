import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NEXT_VISIT_OFFER_SETTINGS } from '@/libs/nextVisitOfferSettings';

import { RebookingPrompt } from './RebookingPrompt';

const fetcher = vi.fn();
const body = (key: string, offer: unknown = null) => ({ data: { promptEnabled: true, promptKey: key, bookingUrl: '/salon/book/service', offer } });
const response = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('completed-visit rebooking encouragement', () => {
  it('stays hidden if the owner disabled the prompt after the page loaded', async () => {
    fetcher.mockResolvedValue(response({ data: { ...body('off').data, promptEnabled: false } }));
    render(<RebookingPrompt token="private" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows plain wording without creating an offer or sending a message', async () => {
    fetcher.mockResolvedValue(response(body('generic')));
    render(<RebookingPrompt token="private" />);

    expect(await screen.findByText('Ready to book your next visit?')).toBeVisible();
    expect(screen.getByText('Book something similar or choose a different service.')).toBeVisible();
    expect(screen.queryByText(/save.*%/i)).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('method');
  });

  it('only displays the issued offer supplied by the server', async () => {
    fetcher.mockResolvedValue(response(body('offer', { deadlineDate: '2026-10-20', currency: 'CAD', settings: { ...DEFAULT_NEXT_VISIT_OFFER_SETTINGS, value: 7 } })));
    render(<RebookingPrompt token="private" />);

    expect(await screen.findByText('Book your next eligible visit by 2026-10-20 and save 7%.')).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dismisses per visit across remounts while retaining a quiet rebook action', async () => {
    fetcher.mockResolvedValue(response(body('dismissed')));
    const view = render(<RebookingPrompt token="private-secret" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.queryByText('Ready to book your next visit?')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('luster:rebooking-prompt:dismissed')).toBe('1');
    expect(JSON.stringify(window.localStorage)).not.toContain('private-secret');

    view.unmount();
    render(<RebookingPrompt token="fresh-capability-for-same-visit" />);

    expect(await screen.findByRole('button', { name: 'Book next appointment' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not suppress on a failed handoff and safely allows retry', async () => {
    fetcher.mockResolvedValueOnce(response(body('retry'))).mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<RebookingPrompt token="private" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Book next appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again');
    expect(window.localStorage.getItem('luster:rebooking-prompt:retry')).toBeNull();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  it('does not issue two link requests on double click', async () => {
    fetcher.mockResolvedValueOnce(response(body('double'))).mockImplementation(() => new Promise(() => {}));
    render(<RebookingPrompt token="private" />);
    const button = await screen.findByRole('button', { name: 'Book next appointment' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();
  });

  it('ignores a late response for a replaced capability', async () => {
    let resolveOld!: (value: unknown) => void;
    fetcher.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve;
    }))
      .mockResolvedValueOnce(response(body('replacement')));
    const view = render(<RebookingPrompt token="old" />);
    view.rerender(<RebookingPrompt token="new" />);
    await screen.findByRole('button', { name: 'Not now' });
    resolveOld(response(body('stale', { deadlineDate: '2026-10-20', currency: 'CAD', settings: DEFAULT_NEXT_VISIT_OFFER_SETTINGS })));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/save 5%/i)).not.toBeInTheDocument();
    expect(fetcher.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });

  it('ignores a late rebook link after the visit changes', async () => {
    let resolveLink!: (value: unknown) => void;
    fetcher.mockResolvedValueOnce(response(body('old-visit')))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveLink = resolve;
      }))
      .mockResolvedValueOnce(response(body('new-visit')));
    const view = render(<RebookingPrompt token="old" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Book next appointment' }));
    view.rerender(<RebookingPrompt token="new" />);
    await screen.findByRole('button', { name: 'Not now' });
    resolveLink(response({ data: { bookingUrl: '/must-not-navigate' } }));
    await waitFor(() => expect(fetcher.mock.calls[1]?.[1].signal.aborted).toBe(true));

    expect(window.localStorage.getItem('luster:rebooking-prompt:old-visit')).toBeNull();
    expect(screen.getByText('Ready to book your next visit?')).toBeVisible();
  });

  it('keeps the page usable when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    fetcher.mockResolvedValue(response(body('storage-disabled')));
    render(<RebookingPrompt token="private" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.queryByText('Ready to book your next visit?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book next appointment' })).toBeVisible();
  });
});
