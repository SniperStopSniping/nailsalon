import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocationForm } from './LocationForm';

const location = { id: 'primary', name: 'Studio', address: '100 Fixture Lane', city: 'Testville', state: null, zipCode: null, phone: null, email: null, isPrimary: true, isActive: true };
const fetchMock = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ locations: [location] }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('platform location management', () => {
  it('treats -1 as unlimited and exposes the add form', async () => {
    render(<LocationForm salonId="studio" maxLocations={-1} onClose={onClose} />);
    await screen.findByText('Studio');

    expect(screen.getByText(/Unlimited/)).toBeInTheDocument();
    expect(screen.queryByText(/Maximum locations reached/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));

    expect(screen.getByRole('textbox', { name: 'Location name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Street address' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'City' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Province / state' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Postal / ZIP code' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Phone' })).toBeInTheDocument();
  });

  it('retains the existing finite-limit behavior', async () => {
    render(<LocationForm salonId="studio" maxLocations={1} onClose={onClose} />);

    expect(await screen.findByText(/Maximum locations reached/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Location' })).not.toBeInTheDocument();
  });

  it('allows another location below a finite limit and cancels without a write', async () => {
    render(<LocationForm salonId="studio" maxLocations={3} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Location' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Location name' }), { target: { value: 'Second studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox', { name: 'Location name' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps entered information after a failed save and supports retry', async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        attempts += 1;
        return { ok: attempts > 1, json: async () => ({ error: 'Please retry saving.' }) };
      }
      return { ok: true, json: async () => ({ locations: attempts > 1 ? [location, { ...location, id: 'second', name: 'Second studio', isPrimary: false }] : [location] }) };
    });
    render(<LocationForm salonId="studio" maxLocations={-1} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Location' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Location name' }), { target: { value: 'Second studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry saving.');
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('Second studio');

    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));
    await screen.findByText('Second studio');

    expect(attempts).toBe(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')[1]?.[1]).toMatchObject({ body: JSON.stringify({ name: 'Second studio', address: '', city: '', state: '', zipCode: '', phone: '' }) });
  });

  it('names the dialog and supports keyboard dismissal', async () => {
    render(<LocationForm salonId="studio" maxLocations={-1} onClose={onClose} />);
    await screen.findByText('Studio');

    expect(screen.getByRole('dialog', { name: 'Locations' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
