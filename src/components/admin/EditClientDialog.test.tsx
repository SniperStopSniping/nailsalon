import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EditClientDialog,
  type EditClientValue,
} from './EditClientDialog';

const client: EditClientValue = {
  id: 'client_1',
  fullName: 'Mary Anne van  der Berg',
  phone: '4165550199',
  email: 'mary@example.com',
  birthday: '1992-06-15',
  notes: 'Prefers quiet appointments.',
  updatedAt: '2026-07-25T15:30:00.000Z',
};

function renderDialog(overrides: Partial<{
  client: EditClientValue;
  onClose: () => void;
  onSuccess: (client: EditClientValue) => void;
}> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSuccess = overrides.onSuccess ?? vi.fn();

  render(
    <EditClientDialog
      isOpen
      salonSlug="isla-nail-studio"
      client={overrides.client ?? client}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );

  return { onClose, onSuccess };
}

function successResponse(updatedAt = '2026-07-25T15:31:00.000Z') {
  return new Response(JSON.stringify({
    data: {
      client: {
        ...client,
        updatedAt,
      },
    },
  }), { status: 200 });
}

describe('EditClientDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('prefills every field and sends only a normalized changed field with the exact version', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(successResponse());
    const { onClose, onSuccess } = renderDialog();

    expect(await screen.findByRole('dialog', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Mary');
    expect(screen.getByLabelText('Last name')).toHaveValue('Anne van  der Berg');
    expect(screen.getByLabelText('Phone')).toHaveValue('4165550199');
    expect(screen.getByLabelText('Email')).toHaveValue('mary@example.com');
    expect(screen.getByLabelText('Birthday')).toHaveValue('1992-06-15');
    expect(screen.getByLabelText('Notes')).toHaveValue('Prefers quiet appointments.');
    expect(screen.getByTestId('edit-client-save')).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Birthday'), {
      target: { value: '1993-07-16' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0]!;

    expect(JSON.parse(String(request?.body))).toEqual({
      salonSlug: 'isla-nail-studio',
      expectedUpdatedAt: '2026-07-25T15:30:00.000Z',
      birthday: '1993-07-16',
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends both trimmed name fields when either name field changes', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(successResponse());
    renderDialog();

    await screen.findByRole('dialog', { name: 'Edit client' });
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: '  van der Berg-Santos  ' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body).toEqual({
      salonSlug: 'isla-nail-studio',
      expectedUpdatedAt: '2026-07-25T15:30:00.000Z',
      firstName: 'Mary',
      lastName: 'van der Berg-Santos',
    });
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('birthday');
    expect(body).not.toHaveProperty('notes');
  });

  it('prefills a single-word name with an empty last name', async () => {
    renderDialog({
      client: {
        ...client,
        fullName: 'Cher',
      },
    });

    await screen.findByRole('dialog', { name: 'Edit client' });

    expect(screen.getByLabelText('First name')).toHaveValue('Cher');
    expect(screen.getByLabelText('Last name')).toHaveValue('');
    expect(screen.getByTestId('edit-client-save')).toBeDisabled();
  });

  it('normalizes changed contact values and empty optional fields', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(successResponse());
    renderDialog();

    await screen.findByRole('dialog', { name: 'Edit client' });
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '+1 (647) 555-0123' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  UPDATED@Example.COM ' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      salonSlug: 'isla-nail-studio',
      expectedUpdatedAt: '2026-07-25T15:30:00.000Z',
      phone: '6475550123',
      email: 'updated@example.com',
      notes: null,
    });
  });

  it('shows inline validation and does not submit invalid values', async () => {
    const fetchMock = vi.mocked(fetch);
    renderDialog();

    await screen.findByRole('dialog', { name: 'Edit client' });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '555' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText('Birthday'), { target: { value: '1899-12-31' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'x'.repeat(5001) } });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    expect(await screen.findByText('Enter a first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid Canadian or US phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Birthday must be between January 1, 1900 and today.')).toBeInTheDocument();
    expect(screen.getByText('Notes must be 5,000 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'UNSUPPORTED_CLIENT_IDENTITY',
      'Phone and email cannot be changed safely',
    ],
    [
      'CONTACT_IDENTITY_CONFLICT',
      'belongs to another client at this salon',
    ],
    [
      'CLIENT_EDIT_CONFLICT',
      'changed while you were editing',
    ],
  ])('preserves the draft and explains %s errors', async (code, message) => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code, message: 'Server-safe message' },
    }), { status: 409 }));
    const { onClose, onSuccess } = renderDialog();

    await screen.findByRole('dialog', { name: 'Edit client' });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Email')).toHaveValue('new@example.com');
    expect(screen.getByRole('dialog', { name: 'Edit client' })).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deduplicates submissions, locks dismissal while pending, and closes after confirmed success', async () => {
    let resolveRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReturnValue(pendingResponse);
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const { onClose } = renderDialog({ onSuccess });

    await screen.findByRole('dialog', { name: 'Edit client' });
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Draft retained while pending.' },
    });
    const save = screen.getByTestId('edit-client-save');
    fireEvent.click(save);
    fireEvent.submit(save.closest('form')!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('edit-client-save')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Close edit client dialog'));

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveRequest(successResponse());
      await pendingResponse;
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('applies the committed client before closing without misreporting a parent failure', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(successResponse());
    const onSuccess = vi.fn(() => {
      throw new Error('Parent render unavailable');
    });
    const onClose = vi.fn();
    renderDialog({ onClose, onSuccess });

    await screen.findByRole('dialog', { name: 'Edit client' });
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Committed before refresh.' },
    });
    fireEvent.click(screen.getByTestId('edit-client-save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({
      id: 'client_1',
      updatedAt: '2026-07-25T15:31:00.000Z',
    }));
    expect(onSuccess.mock.invocationCallOrder[0])
      .toBeLessThan(onClose.mock.invocationCallOrder[0]!);
    expect(screen.queryByText(/could not save/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the mobile sheet scrollable without horizontal overflow or covered actions', async () => {
    renderDialog();

    const dialog = await screen.findByTestId('edit-client-dialog');
    const body = screen.getByTestId('edit-client-dialog-body');
    const save = screen.getByTestId('edit-client-save');

    expect(dialog).toHaveClass('min-w-0', 'overflow-hidden');
    expect(body).toHaveClass('min-w-0', 'overflow-y-auto', 'overflow-x-hidden');
    expect(save.parentElement).toHaveClass('shrink-0');
  });
});
