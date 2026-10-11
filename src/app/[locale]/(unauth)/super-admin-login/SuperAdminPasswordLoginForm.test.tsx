import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SuperAdminPasswordLoginForm } from './SuperAdminPasswordLoginForm';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), locale: 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useParams: () => ({ locale: navigation.locale }),
}));
const fetchMock = vi.fn();
const phone = '+1 416 555 0123';
const password = '  example-autofill-password  ';

function mount(enabled = true, legacy = false) {
  return render(<SuperAdminPasswordLoginForm passwordLoginEnabled={enabled} legacyModeSelected={legacy} />);
}

// Password managers can change native values without React input/change events.
function autofill(phoneValue = phone, passwordValue = password) {
  (screen.getByLabelText('Phone number') as HTMLInputElement).value = phoneValue;
  (screen.getByLabelText('Password') as HTMLInputElement).value = passwordValue;
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.locale = 'en';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

it('keeps native fallback submission out of the URL', () => {
  mount();

  expect(screen.getByLabelText('Phone number').closest('form')).toHaveAttribute('method', 'post');
});

it('submits browser-autofilled values without needing focus or input events', async () => {
  fetchMock.mockResolvedValue(new Response('{}'));
  mount();
  autofill();

  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled();

  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/en/super-admin'));

  expect(fetchMock).toHaveBeenCalledWith('/api/admin/auth/password-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  expect(navigation.refresh).toHaveBeenCalledOnce();
});

it('uses the latest autofill instead of stale previously typed credentials', async () => {
  fetchMock.mockResolvedValue(new Response('{}'));
  mount();
  await userEvent.type(screen.getByLabelText('Phone number'), '+1 416 555 0199');
  await userEvent.type(screen.getByLabelText('Password'), 'earlier-example-password');
  autofill();

  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ phone, password });
});

it('still signs in with normally typed values and preserves password whitespace', async () => {
  fetchMock.mockResolvedValue(new Response('{}'));
  mount();
  await userEvent.type(screen.getByLabelText('Phone number'), phone);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ phone, password });
});

it.each([['', password], [phone, ''], ['', '']])('uses required-field validation without posting incomplete values', async (phoneValue, passwordValue) => {
  mount();
  autofill(phoneValue, passwordValue);
  const form = screen.getByLabelText('Phone number').closest('form')!;

  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  fireEvent.submit(form);

  expect(form.checkValidity()).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('keeps credential errors generic and retries with the latest field values', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{"error":"Private account detail"}', { status: 401 })).mockResolvedValueOnce(new Response('{}'));
  mount();
  autofill();
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(screen.queryByText(/Private account detail/)).not.toBeInTheDocument();
  expect(navigation.replace).not.toHaveBeenCalled();

  autofill(phone, 'corrected-example-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/en/super-admin'));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body).password).toBe('corrected-example-password');
});

it('allows retry after a network failure', async () => {
  fetchMock.mockRejectedValue(new Error('Network down'));
  mount();
  autofill();
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it('prevents duplicate requests while a sign-in is pending', async () => {
  let finish: ((response: Response) => void) | undefined;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
    finish = resolve;
  }));
  mount();
  autofill();
  const form = screen.getByLabelText('Phone number').closest('form')!;

  fireEvent.submit(form);
  fireEvent.submit(form);

  expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

  await act(async () => finish?.(new Response(null, { status: 401 })));

  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled();
});

it('preserves the localized administrator destination', async () => {
  navigation.locale = 'fr';
  fetchMock.mockResolvedValue(new Response('{}'));
  mount();
  autofill();
  await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/fr/super-admin'));
});

it.each([false, true])('does not offer sign-in when password auth is disabled, legacy=%s', (legacy) => {
  mount(false, legacy);

  expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(legacy ? 'Legacy Twilio authentication is retired.' : 'Password authentication is not configured for this deployment.');
  expect(fetchMock).not.toHaveBeenCalled();
});
