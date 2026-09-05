import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddClientDialog } from './AddClientDialog';

function renderDialog() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <AddClientDialog
      isOpen
      salonSlug="salon-a"
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );
  return { onClose, onSuccess };
}

function fillValidDraft() {
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: 'AUDIT Client' },
  });
  fireEvent.change(screen.getByLabelText('Last name'), {
    target: { value: 'Gia' },
  });
  fireEvent.change(screen.getByLabelText('Phone'), {
    target: { value: '(416) 555-0207' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('AddClientDialog', () => {
  it('blocks a submit with a missing name, a bad phone and a bad email', async () => {
    const fetchMock = vi.mocked(fetch);
    renderDialog();

    await screen.findByRole('dialog', { name: 'Add client' });
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByTestId('add-client-save'));

    expect(await screen.findByText('Enter a first name.')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a valid Canadian or US phone number.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Enter a valid email address.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a valid draft and reports the created client', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: {
        client: {
          id: 'sc_new',
          fullName: 'AUDIT Client Gia',
          phone: '4165550207',
          email: null,
          archived: false,
        },
        created: true,
        message: 'Client added to your book.',
      },
    }), { status: 201 }));
    const { onClose, onSuccess } = renderDialog();

    await screen.findByRole('dialog', { name: 'Add client' });
    fillValidDraft();
    fireEvent.click(screen.getByTestId('add-client-save'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;

    expect(JSON.parse(String(init?.body))).toMatchObject({
      salonSlug: 'salon-a',
      firstName: 'AUDIT Client',
      lastName: 'Gia',
      phone: '4165550207',
      email: null,
    });
    expect(onSuccess.mock.calls[0]![0]).toMatchObject({
      created: true,
      client: { id: 'sc_new' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('treats an existing phone as a success that opens the client already in the book', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: {
        client: {
          id: 'sc_existing',
          fullName: 'AUDIT Client Gia',
          phone: '4165550207',
          email: null,
          archived: false,
        },
        created: false,
        message: 'That number is already in your book — opening the client you already have.',
      },
    }), { status: 200 }));
    const { onSuccess } = renderDialog();

    await screen.findByRole('dialog', { name: 'Add client' });
    fillValidDraft();
    fireEvent.click(screen.getByTestId('add-client-save'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onSuccess.mock.calls[0]![0]).toMatchObject({
      created: false,
      client: { id: 'sc_existing' },
    });
    expect(onSuccess.mock.calls[0]![0].message)
      .toContain('already in your book');
  });

  it('keeps the draft and surfaces server field errors', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Review the highlighted fields and try again.',
        details: {
          fieldErrors: {
            phone: ['Enter a valid Canadian or international phone number'],
          },
        },
      },
    }), { status: 400 }));
    const { onClose, onSuccess } = renderDialog();

    await screen.findByRole('dialog', { name: 'Add client' });
    fillValidDraft();
    fireEvent.click(screen.getByTestId('add-client-save'));

    expect(
      await screen.findByText(
        'Enter a valid Canadian or international phone number',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('AUDIT Client');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
