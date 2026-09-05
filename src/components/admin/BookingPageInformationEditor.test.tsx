import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookingPageInformationEditor, type SalonInformation } from './BookingPageInformationEditor';

const QUICK_BOOK_VISIBILITY = {
  showBio: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showEmail: true,
  showHours: false,
  showInstagram: false,
  showLocation: false,
  showPhone: false,
  showReviews: false,
  showTechName: true,
  showTechPhoto: false,
};

function information(overrides: Partial<SalonInformation> = {}): SalonInformation {
  return {
    salon: {
      id: 'salon_1',
      slug: 'salon-a',
      name: 'Current Studio',
      publicationStatus: 'published',
      slugLocked: true,
      customDomain: null,
      publicUrl: 'https://example.test/en/salon-a',
      logoUrl: null,
      phone: '+14165550100',
      email: 'hello@salon-a.test',
    },
    technician: { id: 'tech_1', name: 'Current tech', avatarUrl: null },
    technicianCount: 1,
    instagram: 'https://www.instagram.com/currentstudio/',
    location: { id: 'loc_1', name: 'Primary location', address: '123 Private Street', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
    addressPrivacy: { draft: 'full_address', live: 'full_address' },
    contactPreferences: { bookingOnlyContact: false, callEnabled: true, textEnabled: false, textNumber: null },
    businessHours: { monday: { open: '10:00', close: '19:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    timezone: 'America/Toronto',
    ...overrides,
  };
}

type FetchCall = { url: string; method: string; body: unknown };

describe('BookingPageInformationEditor', () => {
  let calls: FetchCall[];
  let current: SalonInformation;
  let failPatch: boolean;
  let ownerForbidden: boolean;

  beforeEach(() => {
    calls = [];
    current = information();
    failPatch = false;
    ownerForbidden = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body instanceof FormData
        ? { file: (init.body.get('file') as File | null)?.name ?? null, salonSlug: init.body.get('salonSlug') }
        : typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });

      if (url.startsWith('/api/admin/salon/information')) {
        if (ownerForbidden) {
          return new Response(JSON.stringify({ error: { code: 'OWNER_REQUIRED', message: 'Only the salon owner can change business information' } }), { status: 403 });
        }
        if (method === 'PATCH') {
          if (failPatch) {
            return new Response(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Enter a valid phone number' } }), { status: 400 });
          }
          current = {
            ...current,
            salon: { ...current.salon, ...(body.name ? { name: body.name } : {}), ...(body.phone !== undefined ? { phone: body.phone } : {}), ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}) },
            ...(body.businessHours ? { businessHours: body.businessHours } : {}),
            ...(body.instagram !== undefined ? { instagram: `https://www.instagram.com/${body.instagram}/` } : {}),
          };
        }
        return new Response(JSON.stringify({ data: current }), { status: 200 });
      }
      if (url.startsWith('/api/admin/technicians/tech_1/avatar')) {
        return new Response(JSON.stringify({ data: { avatarUrl: 'https://cdn.example/avatar.png' } }), { status: 200 });
      }
      if (url.startsWith('/api/admin/technicians/')) {
        return new Response(JSON.stringify({ data: { id: 'tech_1', name: body.name } }), { status: 200 });
      }
      if (url.startsWith('/api/admin/location')) {
        return new Response(JSON.stringify({ data: { location: { id: 'loc_1', ...body, isPrimary: true } } }), { status: 200 });
      }
      if (url.startsWith('/api/admin/salon/settings')) {
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }
      if (url.startsWith('/api/admin/portfolio')) {
        return new Response(JSON.stringify({ photos: [{ id: 'photo_1', imageUrl: 'https://cdn.example/photo-1.jpg', altText: 'Chrome set' }] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));
  });

  function renderEditor(props: Partial<Parameters<typeof BookingPageInformationEditor>[0]> = {}) {
    const onAddressPrivacyChange = vi.fn();
    const onConfigPatch = vi.fn();
    const registerFlush = vi.fn();
    render(
      <BookingPageInformationEditor
        addressPrivacy="full_address"
        disabled={false}
        draft={{ layout: 'quick_book', quickBookProfile: { ...QUICK_BOOK_VISIBILITY } }}
        liveAddressPrivacy="full_address"
        locale="en"
        onAddressPrivacyChange={onAddressPrivacyChange}
        onConfigPatch={onConfigPatch}
        registerFlush={registerFlush}
        salonSlug="salon-a"
        {...props}
      />,
    );
    return { onAddressPrivacyChange, onConfigPatch, registerFlush };
  }

  it('loads the actual saved values into every accordion and never edits the private account profile', async () => {
    renderEditor();

    expect(await screen.findByTestId('information-business-name')).toHaveValue('Current Studio');
    expect(screen.getByTestId('information-tech-name')).toHaveValue('Current tech');
    expect(screen.getByTestId('information-public-url')).toHaveTextContent('https://example.test/en/salon-a');
    expect(screen.getByTestId('information-address-street')).toHaveValue('123 Private Street');
    expect(screen.getByTestId('information-phone')).toHaveValue('+14165550100');
    expect(screen.getByTestId('information-instagram')).toHaveValue('https://www.instagram.com/currentstudio/');
    expect(screen.getByTestId('information-hours-monday-open')).toHaveValue('10:00');
    expect(screen.getByTestId('information-hours-tuesday-open-toggle')).not.toBeChecked();
    expect(screen.getByTestId('information-timezone')).toHaveValue('America/Toronto');
    expect(screen.getAllByRole('switch')).toHaveLength(11);
    expect(calls.map(call => call.url)).toEqual(['/api/admin/salon/information?salonSlug=salon-a']);
    expect(calls.some(call => call.url.includes('/api/admin/profile'))).toBe(false);
  });

  it('saves the business name through the salon writer and the nail tech name through the technician writer', async () => {
    renderEditor();
    const name = await screen.findByTestId('information-business-name');

    fireEvent.change(name, { target: { value: 'Renamed Studio' } });
    fireEvent.change(screen.getByTestId('information-tech-name'), { target: { value: 'Dani' } });
    fireEvent.click(screen.getByTestId('information-save-identity'));

    await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Saved'));

    const writes = calls.filter(call => call.method !== 'GET');

    expect(writes).toEqual([
      { url: '/api/admin/salon/information?salonSlug=salon-a', method: 'PATCH', body: { name: 'Renamed Studio' } },
      { url: '/api/admin/technicians/tech_1', method: 'PUT', body: { salonSlug: 'salon-a', name: 'Dani' } },
    ]);
    expect(name).toHaveValue('Renamed Studio');
  });

  it('keeps failed edits on screen and reports the server message', async () => {
    failPatch = true;
    renderEditor();
    await userEvent.click(await screen.findByText('Contact', { exact: true }));
    const phone = screen.getByTestId('information-phone');

    fireEvent.change(phone, { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('information-save-contact'));

    await screen.findByText('Enter a valid phone number');

    expect(phone).toHaveValue('12');
    expect(screen.getByTestId('information-save-contact')).toBeEnabled();
  });

  it('saves the street address through the existing location route and privacy through the draft callback', async () => {
    const { onAddressPrivacyChange } = renderEditor();
    await userEvent.click(await screen.findByText('Location', { exact: true }));

    fireEvent.change(screen.getByTestId('information-address-city'), { target: { value: 'Scarborough' } });
    fireEvent.click(screen.getByTestId('information-save-location'));

    await waitFor(() => expect(calls.some(call => call.url === '/api/admin/location?salonSlug=salon-a' && call.method === 'PATCH')).toBe(true));

    const locationWrite = calls.find(call => call.url === '/api/admin/location?salonSlug=salon-a' && call.method === 'PATCH');

    expect(locationWrite?.body).toEqual({ name: 'Primary location', address: '123 Private Street', city: 'Scarborough', state: 'ON', zipCode: 'M5V 1A1' });

    expect(screen.getByRole('radiogroup', { name: 'Address privacy' }).querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(screen.getByTestId('address-privacy-full_address')).toBeChecked();

    await userEvent.click(screen.getByTestId('address-privacy-after_booking'));

    expect(onAddressPrivacyChange).toHaveBeenCalledWith('after_booking');
    expect(screen.getByTestId('address-privacy-after_booking')).toBeChecked();
    expect(calls.some(call => call.method === 'PATCH' && call.url.includes('booking-page'))).toBe(false);
  });

  it('explains when the live site still uses a different privacy choice', async () => {
    renderEditor({ addressPrivacy: 'after_booking', liveAddressPrivacy: 'city_only' });
    await userEvent.click(await screen.findByText('Location', { exact: true }));

    expect(screen.getByTestId('address-privacy-after_booking')).toBeChecked();
    expect(screen.getByTestId('address-privacy-unpublished')).toHaveTextContent('Your live site still uses “Show only my city” until you publish.');
  });

  it('saves weekly hours and timezone without touching staff schedules', async () => {
    renderEditor();
    await userEvent.click(await screen.findByText('Hours', { exact: true }));

    fireEvent.click(screen.getByTestId('information-hours-tuesday-open-toggle'));
    fireEvent.change(screen.getByTestId('information-hours-tuesday-open'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByTestId('information-hours-tuesday-close'), { target: { value: '17:30' } });
    fireEvent.change(screen.getByTestId('information-timezone'), { target: { value: 'America/Vancouver' } });
    fireEvent.click(screen.getByTestId('information-save-hours'));

    await waitFor(() => expect(calls.filter(call => call.method !== 'GET')).toHaveLength(2));

    const writes = calls.filter(call => call.method !== 'GET');

    expect(writes[0]).toEqual({ url: '/api/admin/salon/settings?salonSlug=salon-a', method: 'PATCH', body: { bookingConfig: { timezone: 'America/Vancouver' } } });
    expect(writes[1]?.url).toBe('/api/admin/salon/information?salonSlug=salon-a');
    expect(writes[1]?.body).toEqual({ businessHours: { ...information().businessHours, tuesday: { open: '09:00', close: '17:30' } } });
    expect(JSON.stringify(writes)).not.toContain('weeklySchedule');
    expect(calls.some(call => call.url.includes('/api/admin/technicians'))).toBe(false);
  });

  it('rejects closing before opening locally and keeps the edit', async () => {
    renderEditor();
    await userEvent.click(await screen.findByText('Hours', { exact: true }));

    fireEvent.change(screen.getByTestId('information-hours-monday-close'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByTestId('information-save-hours'));

    await screen.findByText('Monday needs a closing time after its opening time.');

    expect(calls.filter(call => call.method !== 'GET')).toHaveLength(0);
    expect(screen.getByTestId('information-hours-monday-close')).toHaveValue('08:00');
  });

  it('saves contact details, Instagram and contact permissions in one owner write', async () => {
    renderEditor();
    await userEvent.click(await screen.findByText('Contact', { exact: true }));

    fireEvent.change(screen.getByTestId('information-instagram'), { target: { value: '@isla.nails' } });
    fireEvent.click(screen.getByTestId('information-booking-only-contact'));
    fireEvent.click(screen.getByTestId('information-save-contact'));

    await waitFor(() => expect(calls.filter(call => call.method !== 'GET')).toHaveLength(1));

    expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({
      phone: '+14165550100',
      email: 'hello@salon-a.test',
      instagram: '@isla.nails',
      contactPreferences: { bookingOnlyContact: true, callEnabled: true, textEnabled: false, textNumber: '' },
    });

    await waitFor(() => expect(screen.getByTestId('information-instagram')).toHaveValue('https://www.instagram.com/@isla.nails/'));
  });

  it('assigns a logo from the existing portfolio and uploads the tech photo through the Staff route, never swapping the two', async () => {
    renderEditor();
    await screen.findByTestId('information-business-name');

    await userEvent.click(screen.getByRole('button', { name: 'Choose from Portfolio' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Chrome set' }));

    await waitFor(() => expect(screen.getByAltText('Current business logo')).toHaveAttribute('src', 'https://cdn.example/photo-1.jpg'));

    expect(calls.find(call => call.method === 'PATCH')?.body).toEqual({ logoUrl: 'https://cdn.example/photo-1.jpg' });

    const upload = screen.getByTestId('information-tech-photo');
    await userEvent.upload(upload, new File(['x'], 'me.png', { type: 'image/png' }));

    await waitFor(() => expect(screen.getByAltText('Current nail tech')).toHaveAttribute('src', 'https://cdn.example/avatar.png'));

    const avatarCall = calls.find(call => call.url === '/api/admin/technicians/tech_1/avatar');

    expect(avatarCall).toMatchObject({ method: 'POST', body: { file: 'me.png', salonSlug: 'salon-a' } });
    expect(screen.getByAltText('Current business logo')).toHaveAttribute('src', 'https://cdn.example/photo-1.jpg');
  });

  it('falls back to read-only saved values and visibility switches for a non-owner admin', async () => {
    ownerForbidden = true;
    renderEditor({ savedDetails: { 'Contact': ['+14165550100'], 'Business identity': ['Current Studio'] } });

    expect(await screen.findAllByText('Only the salon owner can change these details.')).not.toHaveLength(0);
    expect(screen.queryByTestId('information-business-name')).not.toBeInTheDocument();
    expect(screen.getByText('Current Studio')).toBeVisible();
    expect(screen.getAllByRole('switch')).toHaveLength(11);
  });

  it('registers a flush that saves dirty sections before navigation and reports failure', async () => {
    failPatch = true;
    const { registerFlush } = renderEditor();
    const name = await screen.findByTestId('information-business-name');
    fireEvent.change(name, { target: { value: 'Unsaved name' } });

    const flush = registerFlush.mock.calls.at(-1)?.[0] as () => Promise<boolean>;

    expect(typeof flush).toBe('function');

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await flush();
    });

    expect(flushed).toBe(false);
    expect(name).toHaveValue('Unsaved name');

    failPatch = false;
    await act(async () => {
      flushed = await flush();
    });

    expect(flushed).toBe(true);
    expect(calls.filter(call => call.method === 'PATCH').map(call => call.body)).toEqual([{ name: 'Unsaved name' }, { name: 'Unsaved name' }]);
  });
});
