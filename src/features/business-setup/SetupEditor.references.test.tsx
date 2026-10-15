import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CLOSED_HOURS } from './contracts';
import { SetupEditor } from './SetupEditor';

vi.mock('@/features/custom-sites/CustomWebsiteFrame', () => ({ CustomWebsiteFrame: () => <div>Isolated preview</div> }));
const reference = { id: '120fb904-9319-48f0-89e9-0e5cd013c1ec', name: 'my-reference.png', role: 'reference', mimeType: 'image/png' };
let assets: typeof reference[];
let requests: any[];
let document: any;
const head = () => ({ workspace: { status: 'editing' }, revision: { revision: 1, document }, messages: [] });

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  assets = [];
  requests = [];
  document = {
    business: { name: 'Studio', city: 'Toronto', exactAddress: '', workMode: 'solo', homeBased: true, locationDisplayMode: 'city_only' },
    hours: { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } },
    booking: { currency: 'CAD', timezone: 'America/Toronto', minimumNoticeMinutes: 120, bufferMinutes: 0 },
    services: [{ id: 'draft_gel', name: 'Gel', priceCents: 5000, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, confirmed: false }],
    website: { config: {}, content: {} },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const custom = url.startsWith('/api/admin/custom-sites');
    if (options?.body instanceof FormData) {
      assets = [reference];
      return { ok: true, json: async () => ({ asset: reference }) };
    }
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (request) {
      requests.push(request);
      if (request.action === 'preferences') {
        document.designBrief = request.input.values;
      }
    }
    return { ok: true, json: async () => custom
      ? request ? { head: head() } : { head: head(), assets, preferences: document.designBrief ?? null, history: [], attempts: [], configured: true, payload: null, rendererOrigin: null }
      : { data: request?.action === 'message' ? { head: head(), reply: 'Saved.' } : head() } };
  }));
});

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('keeps an uploaded image attached when moving to chat (existing custom website: %s)', async (existingCustom) => {
  if (existingCustom) {
    document.website.config.customFrontendId = 'ceec2235-6a4d-4cf2-b052-daf29b74b859';
  }
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft · Your live business is unchanged');
  fireEvent.click(screen.getByRole('button', { name: 'Website' }));
  const upload = screen.getByRole('region', { name: 'Upload an image' });
  fireEvent.submit(within(upload).getByRole('button', { name: 'Upload' }).closest('form')!);
  await screen.findByText(/Your image is saved and selected/);

  expect(screen.getByRole('button', { name: 'Create my website' })).toBeEnabled();
  expect((screen.getByLabelText('What do you like about your references, or what should change?') as HTMLTextAreaElement).value).toContain('selected inspiration');

  fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
  fireEvent.change(screen.getByLabelText('Tell Luster what you have in mind'), { target: { value: 'Make my website look like the image I uploaded.' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Send to Luster' }).closest('form')!);
  await waitFor(() => expect(requests.some(request => (request.input ?? request.message)?.referenceIds?.includes(reference.id))).toBe(true));
});

it('restores unused uploads after refresh and explains missing business details before generation', async () => {
  assets = [reference];
  document.business.city = '';
  document.hours = CLOSED_HOURS;
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: 'Website' }));
  await screen.findByText('1 uploaded file(s) will be used for this request.');

  expect(screen.getByRole('button', { name: 'Create my website' })).toBeDisabled();
  expect(screen.getByText(/Before creating your website, Luster needs city or area, opening hours/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continue with Luster' })).toBeEnabled();
  expect(requests.every(request => request.action === 'open')).toBe(true);
});

it('offers upload or description without making a model request', async () => {
  document.business.city = '';
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft · Your live business is unchanged');
  fireEvent.click(screen.getByRole('button', { name: /Describe your idea/ }));
  await waitFor(() => expect(screen.getByLabelText('What do you like about your references, or what should change?')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: /Upload a design/ }));
  await screen.findByRole('button', { name: /My own business/ });

  expect(requests.every(request => request.action === 'open')).toBe(true);
});

it('reads an explicitly owned image into a separate review and does not apply it automatically', async () => {
  assets = [reference];
  const baseFetch = globalThis.fetch;
  let reviews: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (request?.action === 'read_upload') {
      requests.push(request);
      reviews = [{ id: request.input.operationId, operations: [{ type: 'business', values: { name: 'Name in my image' } }, { type: 'booking', values: { currency: 'USD' } }, { type: 'service', values: { ...document.services[0], priceCents: 6500, durationMinutes: null } }], notes: 'Appointment lengths are missing.', expectedRevision: 1 }];
      return { ok: true, json: async () => ({ data: reviews[0] }) };
    }
    if (url.startsWith('/api/admin/business-setup?') && !options?.method) {
      return { ok: true, json: async () => ({ data: { ...head(), uploadReviews: reviews } }) };
    }
    return baseFetch(url, options);
  }));
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: /Upload a design/ }));
  await screen.findByText('1 uploaded file(s) will be used for this request.');

  expect(screen.queryByRole('button', { name: 'Read my business details' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /My own business/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Read my business details' }));
  const review = await screen.findByRole('region', { name: 'Details found in your upload' });

  expect(within(review).getByText('Name in my image')).toBeVisible();
  expect(within(review).getByText('USD 65.00 · Appointment length needed')).toBeVisible();
  expect(document.booking.currency).toBe('CAD');

  await waitFor(() => expect(within(review).getByRole('button', { name: 'Use these details' })).toBeEnabled());

  expect(requests.filter(request => request.action === 'read_upload')[0].input).toMatchObject({ referenceIds: [reference.id], source: 'my_business' });
  expect(requests.some(request => ['edit', 'apply_upload', 'approve', 'publish'].includes(request.action))).toBe(false);
  expect(document.business.name).toBe('Studio');
});

it('saves match intent and per-image ownership separately, then restores them after refresh', async () => {
  assets = [reference];
  const first = render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: /Describe your idea/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Match my design closely/ }));
  await waitFor(() => expect(document.designBrief?.fidelity).toBe('match'));
  await waitFor(() => expect(screen.getByLabelText('This is my own design; I may reuse its branding and artwork.')).toBeEnabled());

  expect(document.designBrief.ownedReferenceIds).toEqual([]);

  fireEvent.click(screen.getByLabelText('This is my own design; I may reuse its branding and artwork.'));
  await waitFor(() => expect(document.designBrief.ownedReferenceIds).toEqual([reference.id]));
  first.unmount();
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: /Describe your idea/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Match my design closely/ })).toHaveAttribute('aria-pressed', 'true'));

  expect(screen.getByLabelText('This is my own design; I may reuse its branding and artwork.')).toBeChecked();
  expect(requests.some(request => ['generate', 'publish', 'approve'].includes(request.action))).toBe(false);
});
