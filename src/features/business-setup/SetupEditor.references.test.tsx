import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CLOSED_HOURS } from './contracts';
import { SetupEditor } from './SetupEditor';

vi.mock('@/features/custom-sites/CustomWebsiteFrame', () => ({ CustomWebsiteFrame: () => <div>Isolated preview</div> }));
const reference = { id: '120fb904-9319-48f0-89e9-0e5cd013c1ec', name: 'my-reference.png', role: 'reference', mimeType: 'image/png' };
let assets: typeof reference[];
let requests: any[];
let document: any;
let revision: number;
let messages: any[];
let reviews: any[];
let published: boolean;
const head = () => ({ workspace: { status: published ? 'published' : 'editing' }, revision: { revision, document }, messages, uploadReviews: reviews });

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  sessionStorage.clear();
  assets = [];
  requests = [];
  messages = [];
  reviews = [];
  revision = 2;
  published = false;
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
      const asset = { ...reference, role: String(options.body.get('role')) };
      assets = [asset];
      requests.push({ action: 'upload', role: asset.role, rightsConfirmed: options.body.get('rightsConfirmed') });
      return { ok: true, json: async () => ({ asset }) };
    }
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (request) {
      requests.push(request);
      if (request.action === 'preferences') {
        document.designBrief = request.input.values;
        revision++;
      }
      if (['generate', 'message'].includes(request.action)) {
        messages.push({ id: (request.message ?? request.input).operationId, message: (request.message ?? request.input).message, reply: 'Saved your request.', status: 'completed' });
      }
      if (request.action === 'read_upload') {
        reviews = [{ id: request.input.operationId, operations: [{ type: 'business', values: { name: 'Name in my image' } }, { type: 'booking', values: { currency: 'USD' } }, { type: 'service', values: { ...document.services[0], priceCents: 6500, durationMinutes: null } }], notes: 'Appointment lengths are missing.', expectedRevision: revision }];
      }
      if (request.action === 'review') {
        return { ok: true, json: async () => ({ data: { revision, hash: 'exact-hash', changes: [], blockers: [] } }) };
      }
      if (request.action === 'approve') {
        return { ok: true, json: async () => ({ data: { id: 'approval-1' } }) };
      }
      if (request.action === 'publish') {
        published = true;
      }
      if (request.action === 'start_editing') {
        published = false;
        revision++;
      }
    }
    return { ok: true, json: async () => custom
      ? request ? { head: head() } : { head: head(), assets, preferences: document.designBrief ?? null, history: [], attempts: [], configured: true, payload: null, rendererOrigin: null }
      : { data: request?.action === 'message' ? { head: head(), reply: 'Saved.' } : head() } };
  }));
});

afterEach(() => vi.unstubAllGlobals());

async function attach(purpose = 'Inspiration') {
  fireEvent.click(await screen.findByRole('button', { name: 'Attach images or a PDF' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(purpose) }));
  fireEvent.change(dialog.querySelector('input[type=file]')!, { target: { files: [new File(['image'], 'my-reference.png', { type: 'image/png' })] } });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to chat' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Attach images or a PDF' })).toBeEnabled());
}

it.each([false, true])('uploads directly in chat and uses the saved selection in the same composer (custom site: %s)', async (existingCustom) => {
  if (existingCustom) {
    document.website.config.customFrontendId = 'ceec2235-6a4d-4cf2-b052-daf29b74b859';
  }
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  await attach();

  expect(document.designBrief.referenceIds).toEqual([reference.id]);
  expect(document.designBrief.ownedReferenceIds).toEqual([]);
  expect(screen.getByRole('region', { name: 'Conversation' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Create my website' })).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: 'Message Luster' }), { target: { value: 'Make my website look like the image I uploaded.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(requests.some(request => (request.input ?? request.message)?.referenceIds?.includes(reference.id))).toBe(true));
  await screen.findByText('Saved your request.');

  expect(requests.some(request => request.action === 'publish')).toBe(false);
});

it('opens with one conversation and keeps preview and manual forms out of the default view', async () => {
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');

  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'Business setup' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Website preview' })).not.toBeInTheDocument();
  expect(requests.every(request => request.action === 'open')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Details' }));

  expect(screen.getByRole('region', { name: 'Business setup' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '← Back to chat' }));

  expect(screen.getByRole('textbox', { name: 'Message Luster' })).toBeVisible();
});

it.each([false, true])('reads an own design through the same chat without extraction buttons (custom site: %s)', async (custom) => {
  if (custom) {
    document.website.config.customFrontendId = 'ceec2235-6a4d-4cf2-b052-daf29b74b859';
  }
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  await attach('My design or menu');

  expect(document.designBrief).toMatchObject({ fidelity: 'match', ownedReferenceIds: [reference.id] });
  expect(requests.find(request => request.action === 'upload')).toMatchObject({ rightsConfirmed: 'true' });
  expect(screen.queryByRole('button', { name: 'Read business details from my design' })).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: 'Message Luster' }), { target: { value: 'Just get all the info from my image' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Saved your request.');

  expect(requests.find(request => request.action === 'message').message).toMatchObject({ message: 'Just get all the info from my image', referenceIds: [reference.id] });
  expect(requests.some(request => ['generate', 'read_upload', 'apply_upload', 'approve', 'publish'].includes(request.action))).toBe(false);
});

it('renders old emphasis safely instead of showing Markdown stars', async () => {
  messages = [{ id: 'prior', message: 'Hello', reply: 'Your **saved details** are here. Hours: not_shown. <script>unsafe()</script>', status: 'completed' }];
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Your saved details are here. Hours: unclear. <script>unsafe()</script>', { exact: true });

  expect(screen.getByRole('log')).not.toHaveTextContent('**');
  expect(screen.getByRole('log').querySelector('script')).toBeNull();
  expect(screen.getByRole('log')).toHaveTextContent('<script>unsafe()</script>');
});

it('restores image purpose, ownership, and conversation after reopening without making a model request', async () => {
  assets = [reference];
  document.designBrief = { fidelity: 'match', referenceIds: [reference.id], ownedReferenceIds: [reference.id], websiteAssetIds: [] };
  messages = [{ id: 'prior', message: 'Recreate my own design.', reply: 'Your saved request.', status: 'completed' }];
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Your saved request.');
  await screen.findByRole('button', { name: `Detach ${reference.name}` });

  expect(screen.getByText('Your design', { exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Read business details from my design' })).not.toBeInTheDocument();
  expect(requests.every(request => request.action === 'open')).toBe(true);
});

it('detaches an image only from future design requests, preserving its library record and live site', async () => {
  assets = [reference];
  document.designBrief = { fidelity: 'match', referenceIds: [reference.id], ownedReferenceIds: [reference.id], websiteAssetIds: [] };
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  fireEvent.click(await screen.findByRole('button', { name: `Detach ${reference.name}` }));
  await waitFor(() => expect(document.designBrief.referenceIds).toEqual([]));

  expect(document.designBrief.ownedReferenceIds).toEqual([]);
  expect(assets).toHaveLength(1);
  expect(requests.some(request => ['generate', 'publish', 'edit_media'].includes(request.action))).toBe(false);
});

it('keeps publication explicit and bound to the review, then offers continuing from the saved website', async () => {
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  await screen.findByRole('heading', { name: 'Review your changes' });

  expect(requests.some(request => request.action === 'approve')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
  await screen.findByRole('button', { name: 'Make more changes' });

  expect(requests.find(request => request.action === 'approve')).toMatchObject({ revision: 2, hash: 'exact-hash' });
  expect(requests.find(request => request.action === 'publish')).toMatchObject({ revision: 2, approvalId: 'approval-1' });

  fireEvent.click(screen.getByRole('button', { name: 'Make more changes' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Luster' })).toBeEnabled());
});

it('does not upload a file or grant rights before permission is checked', async () => {
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  fireEvent.click(screen.getByRole('button', { name: 'Attach images or a PDF' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(dialog.querySelector('input[type=file]')!, { target: { files: [new File(['image'], 'my-reference.png', { type: 'image/png' })] } });

  expect(within(dialog).getByRole('button', { name: 'Add to chat' })).toBeDisabled();
  expect(requests.some(request => request.action === 'upload')).toBe(false);
});

it('saves website photographs separately from design references', async () => {
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  await attach('My photos');

  expect(requests.find(request => request.action === 'upload').role).toBe('photo');
  expect(document.designBrief).toMatchObject({ referenceIds: [], ownedReferenceIds: [], websiteAssetIds: [reference.id] });
  expect(screen.queryByRole('button', { name: 'Read business details from my design' })).not.toBeInTheDocument();
});

it('keeps the message available after a failed request and does not retry a paid call automatically', async () => {
  const baseFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (request?.action === 'message') {
      requests.push(request);
      return { ok: false, status: 400, json: async () => ({ error: { message: 'Please retry after reconnecting.' } }) };
    }
    return baseFetch(url, options);
  }));
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Luster' }), { target: { value: 'My salon is called Aster.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('alert');

  expect(screen.getByText('Please retry after reconnecting.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message Luster' })).toHaveValue('');
  expect(screen.getByText('My salon is called Aster.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry message' })).toBeInTheDocument();
  expect(requests.filter(request => request.action === 'message')).toHaveLength(1);
});

it('recovers the published state after a lost response without asking for approval again', async () => {
  const baseFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    const result = await baseFetch(url, options);
    if (request?.action === 'publish') {
      throw new Error('Connection interrupted.');
    }
    return result;
  }));
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Approve and publish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reload saved changes' }));
  await screen.findByRole('button', { name: 'Make more changes' });

  expect(screen.queryByRole('button', { name: 'Approve and publish' })).not.toBeInTheDocument();
  expect(requests.filter(request => request.action === 'publish')).toHaveLength(1);
});

it('clears a sent follow-up immediately, shows progress and preserves a newly typed message', async () => {
  const baseFetch = globalThis.fetch;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (request?.action === 'message') {
      await gate;
    }
    return baseFetch(url, options);
  }));
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  const composer = screen.getByRole('textbox', { name: 'Message Luster' });
  fireEvent.change(composer, { target: { value: 'Make the images bigger' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

  expect(composer).toHaveValue('');
  expect(screen.getByText('Make the images bigger')).toBeInTheDocument();
  expect(screen.getByText('Working on your changes…')).toBeInTheDocument();

  fireEvent.change(composer, { target: { value: 'My next idea' } });
  finish();
  await screen.findByText('Saved your request.');

  expect(composer).toHaveValue('My next idea');
  expect(screen.queryByText('Working on your changes…')).not.toBeInTheDocument();
});

it('recovers a completed message after a lost response without resending or restoring the textbox', async () => {
  const baseFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    const response = await baseFetch(url, options);
    if (request?.action === 'message') {
      throw new Error('Lost response');
    }
    return response;
  }));
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Luster' }), { target: { value: 'Make Instagram clickable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Saved your request.');

  expect(screen.getByRole('textbox', { name: 'Message Luster' })).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Retry message' })).not.toBeInTheDocument();
  expect(requests.filter(request => request.action === 'message')).toHaveLength(1);
  expect(screen.getAllByText('Make Instagram clickable')).toHaveLength(1);
});

it('polls a still-running operation after disconnect and loads its result without another paid request', async () => {
  const baseFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const request = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    if (request?.action === 'message') {
      requests.push(request);
      messages.push({ id: request.message.operationId, message: request.message.message, reply: null, status: 'pending' });
      throw new Error('Connection lost while server continues');
    }
    return baseFetch(url, options);
  }));
  render(<SetupEditor salonSlug="test" locale="en" existingSalon={false} aiEnabled />);
  await screen.findByText('Saved as draft');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Luster' }), { target: { value: 'Keep all my policies' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(messages).toHaveLength(1));
  await screen.findByText('Working on your changes…');
  messages = messages.map(message => ({ ...message, status: 'completed', reply: 'Your policies are included.' }));
  await screen.findByText('Your policies are included.', {}, { timeout: 6500 });

  expect(screen.getByRole('textbox', { name: 'Message Luster' })).toHaveValue('');
  expect(requests.filter(request => request.action === 'message')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Retry message' })).not.toBeInTheDocument();
  expect(sessionStorage.getItem('luster-message:test')).toBeNull();
});
