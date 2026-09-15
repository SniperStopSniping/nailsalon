import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  OwnerMenuAssistant,
  type OwnerMenuAssistantTransport,
} from './OwnerMenuAssistant';

const menu = [
  { id: 'gel', name: 'Gel manicure', sortOrder: 1 },
  { id: 'pedi', name: 'Pedicure', sortOrder: 2 },
  { id: 'art', name: 'Nail art', sortOrder: 3 },
];

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeTransport(overrides: Partial<OwnerMenuAssistantTransport> = {}): OwnerMenuAssistantTransport {
  return {
    getContext: vi.fn(async () => response({ data: { enabled: true, menu } })),
    getStatus: vi.fn(async () => response({ data: { proposal: {
      id: 'proposal-1',
      status: 'ready',
      oldOrder: menu,
      newOrder: [menu[2], menu[0], menu[1]],
    } } })),
    post: vi.fn(async (body: Record<string, unknown>) => {
      if (body.action === 'prepare') {
        return response({ data: { proposal: {
          id: 'proposal-1',
          status: 'ready',
          oldOrder: menu,
          newOrder: [menu[2], menu[0], menu[1]],
        } } });
      }
      if (body.action === 'apply') {
        return response({ data: { receipt: {
          id: 'receipt-1',
          status: 'applied',
          newOrder: [menu[2], menu[0], menu[1]],
        } } });
      }
      return response({ data: { receipt: { id: 'receipt-1', status: 'undone', newOrder: menu } } });
    }),
    ...overrides,
  };
}

describe('OwnerMenuAssistant', () => {
  it.each([400, 409])('refreshes canonical menu after conflict %s and requires a new preview', async (status) => {
    const transport = makeTransport();
    const post = vi.mocked(transport.post);
    const originalPost = post.getMockImplementation()!;
    post.mockImplementation(async (body) => {
      if (body.action === (status === 400 ? 'prepare' : 'apply')) {
        return response({ error: { code: status === 400 ? 'INVALID_ORDER' : 'STALE' } }, status);
      }
      return originalPost(body);
    });
    vi.mocked(transport.getContext).mockResolvedValueOnce(response({ data: { menu } }))
      .mockResolvedValue(response({ data: { menu: [...menu, { id: 'new', name: 'Repair', sortOrder: 4 }] } }));
    render(<OwnerMenuAssistant salonSlug="private-salon" transport={transport} />);
    fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
    fireEvent.change(screen.getByLabelText('What should move?'), { target: { value: 'Move Nail art before Gel manicure' } });
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));
    if (status === 409) {
      fireEvent.click(await screen.findByTestId('owner-menu-assistant-apply'));
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh menu' }));
    await screen.findByText('Menu refreshed. Prepare a new preview before applying.');

    expect(screen.queryByTestId('owner-menu-assistant-proposal')).not.toBeInTheDocument();
    expect(transport.getStatus).not.toHaveBeenCalled();

    post.mockImplementation(originalPost);
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));
    await screen.findByTestId('owner-menu-assistant-proposal');

    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'prepare', orderedIds: ['art', 'gel', 'pedi', 'new'] }));
  });

  it('is absent when the server gate hides the assistant', async () => {
    const transport = makeTransport({ getContext: vi.fn(async () => response({}, 404)) });
    render(<OwnerMenuAssistant salonSlug="private-salon" transport={transport} />);

    await waitFor(() => expect(transport.getContext).toHaveBeenCalled());

    expect(screen.queryByTestId('owner-menu-assistant-launcher')).not.toBeInTheDocument();
  });

  it('previews, applies and guarded-undoes a full order through stable action IDs', async () => {
    const transport = makeTransport();
    render(<OwnerMenuAssistant salonSlug="private-salon" transport={transport} />);

    const launcher = await screen.findByTestId('owner-menu-assistant-launcher');
    fireEvent.click(launcher);
    fireEvent.change(screen.getByLabelText('What should move?'), {
      target: { value: 'Move Nail art before Gel manicure' },
    });
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));

    expect(await screen.findByTestId('owner-menu-assistant-proposal')).toHaveTextContent('Nail art');

    await waitFor(() => expect(transport.post).toHaveBeenCalledWith(expect.objectContaining({
      action: 'prepare',
      salonSlug: 'private-salon',
      orderedIds: ['art', 'gel', 'pedi'],
    })));
    fireEvent.click(screen.getByTestId('owner-menu-assistant-apply'));

    expect(await screen.findByTestId('owner-menu-assistant-receipt')).toHaveTextContent('Menu order updated');

    const applyCall = vi.mocked(transport.post).mock.calls.find(([body]) => body.action === 'apply');

    expect(applyCall?.[0]).toMatchObject({ proposalId: 'proposal-1' });
    expect(applyCall?.[0]).not.toHaveProperty('idempotencyKey');

    fireEvent.click(screen.getByTestId('owner-menu-assistant-undo'));
    await waitFor(() => expect(screen.getByTestId('owner-menu-assistant-receipt')).toHaveTextContent('Menu order restored'));
  });

  it('asks the owner to select named services instead of guessing', async () => {
    const transport = makeTransport();
    render(<OwnerMenuAssistant salonSlug="private-salon" transport={transport} />);

    fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
    fireEvent.change(screen.getByLabelText('What should move?'), {
      target: { value: 'Move unknown before Pedicure' },
    });
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));

    expect(await screen.findByTestId('owner-menu-assistant-selection')).toBeInTheDocument();
    expect(transport.post).not.toHaveBeenCalled();
  });

  it('disambiguates duplicate service names in the owner selection fallback', async () => {
    const duplicatedMenu = [...menu, { id: 'gel-2', name: 'Gel manicure', sortOrder: 4 }];
    const transport = makeTransport({ getContext: vi.fn(async () => response({ data: { menu: duplicatedMenu } })) });
    render(<OwnerMenuAssistant salonSlug="private-salon" transport={transport} />);

    fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
    fireEvent.change(screen.getByLabelText('What should move?'), { target: { value: 'Move Gel manicure before Pedicure' } });
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));

    expect(await screen.findAllByRole('option', { name: 'Gel manicure · #gel' })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: 'Gel manicure · #gel-2' })).toHaveLength(2);
  });

  it.each(['status', 'retry'])('recovers after a lost apply response via %s and permits the next request', async (method) => {
    let applyAttempts = 0;
    const transport = makeTransport({
      post: vi.fn(async (body: Record<string, unknown>) => {
        if (body.action === 'prepare') {
          return response({ data: { proposal: { id: 'proposal-1', status: 'ready', oldOrder: menu, newOrder: [menu[2], menu[0], menu[1]] } } });
        }
        applyAttempts += 1;
        if (applyAttempts === 1) {
          throw new TypeError('connection lost after apply');
        }
        return response({ data: { receipt: { id: 'proposal-1', status: 'already_applied', currentOrder: [menu[2], menu[0], menu[1]] } } });
      }),
      getStatus: vi.fn(async () => response({ data: { receipt: { id: 'proposal-1', status: 'applied', currentOrder: [menu[2], menu[0], menu[1]] } } })),
    });
    render(<OwnerMenuAssistant salonSlug="private-salon" transport={transport} />);

    fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
    fireEvent.change(screen.getByLabelText('What should move?'), { target: { value: 'Move Nail art before Gel manicure' } });
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));
    fireEvent.click(await screen.findByTestId('owner-menu-assistant-apply'));

    expect(await screen.findByRole('button', { name: 'Check request status' })).toBeEnabled();

    fireEvent.click(method === 'status'
      ? screen.getByRole('button', { name: 'Check request status' })
      : screen.getByTestId('owner-menu-assistant-apply'));

    expect(await screen.findByTestId('owner-menu-assistant-receipt')).toHaveTextContent('Menu order updated');

    if (method === 'status') {
      expect(transport.getStatus).toHaveBeenCalledWith('private-salon', 'proposal-1', expect.any(AbortSignal));
    } else {
      expect(transport.getStatus).not.toHaveBeenCalled();
    }

    expect(vi.mocked(transport.post).mock.calls.filter(([body]) => body.action === 'apply')).toHaveLength(method === 'status' ? 1 : 2);
    expect(screen.getByLabelText('Prepare menu preview')).toBeEnabled();
  });

  it('ignores a stale preview response after the owner changes salons', async () => {
    let resolvePrepare: ((value: Response) => void) | undefined;
    const transport = makeTransport({
      post: vi.fn((body: Record<string, unknown>) => {
        if (body.action === 'prepare') {
          return new Promise<Response>((resolve) => {
            resolvePrepare = resolve;
          });
        }
        return Promise.resolve(response({ data: {} }));
      }),
    });
    const { rerender } = render(<OwnerMenuAssistant salonSlug="first-salon" transport={transport} />);

    fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
    fireEvent.change(screen.getByLabelText('What should move?'), { target: { value: 'Move Nail art before Gel manicure' } });
    fireEvent.click(screen.getByLabelText('Prepare menu preview'));
    rerender(<OwnerMenuAssistant salonSlug="second-salon" transport={transport} />);
    resolvePrepare?.(response({ data: { proposal: { id: 'stale', status: 'ready', oldOrder: menu, newOrder: [menu[2], menu[0], menu[1]] } } }));

    await waitFor(() => expect(transport.getContext).toHaveBeenLastCalledWith('second-salon', expect.any(AbortSignal)));

    expect(screen.queryByTestId('owner-menu-assistant-proposal')).not.toBeInTheDocument();
  });

  it('cancels the visible conversation when the active salon changes', async () => {
    const transport = makeTransport();
    const { rerender } = render(<OwnerMenuAssistant salonSlug="first-salon" transport={transport} />);
    fireEvent.click(await screen.findByTestId('owner-menu-assistant-launcher'));
    rerender(<OwnerMenuAssistant salonSlug="second-salon" transport={transport} />);

    await waitFor(() => expect(transport.getContext).toHaveBeenLastCalledWith('second-salon', expect.any(AbortSignal)));

    expect(screen.queryByTestId('owner-menu-assistant-dialog')).not.toBeInTheDocument();
  });
});
