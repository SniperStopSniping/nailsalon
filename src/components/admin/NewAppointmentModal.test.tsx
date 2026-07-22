import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GoogleEventPrefill, NewAppointmentModal } from './NewAppointmentModal';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  }),
}));

vi.mock('@/providers/SalonProvider', () => ({
  useSalon: () => ({ salonSlug: 'test-salon' }),
}));

const initialEvent: GoogleEventPrefill = {
  id: 'google_event_1',
  title: 'Controlled fake event',
  startTime: '2099-07-20T14:00:00.000Z',
  endTime: '2099-07-20T15:00:00.000Z',
  durationMinutes: 60,
  description: 'Initial source description',
  location: 'Initial source location',
  sourceVersion: '2099-07-01T00:00:00.000Z',
  suggestedClient: null,
  suggestedService: { id: 'service_1', price: 5500 },
  isReadOnly: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installDefaultFetch(postResponse: () => Promise<Response> = async () => jsonResponse({ appointmentId: 'appt_1' }, 201)) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/admin/technicians') {
      return jsonResponse({ data: { technicians: [{ id: 'tech_1', name: 'Test Technician', avatarUrl: null }] } });
    }
    if (url.pathname === '/api/salon/services') {
      return jsonResponse({
        data: {
          services: [
            { id: 'service_1', name: 'Gel Manicure', price: 5500, durationMinutes: 60, category: 'Manicure' },
            { id: 'service_2', name: 'Gel Pedicure', price: 6500, durationMinutes: 75, category: 'Pedicure' },
          ],
        },
      });
    }
    if (url.pathname === '/api/appointments' && init?.method === 'POST') {
      return postResponse();
    }
    throw new Error(`Unexpected fetch: ${url.pathname}`);
  });
}

function modalProps(overrides: Partial<React.ComponentProps<typeof NewAppointmentModal>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    googleEventPrefill: initialEvent,
    ...overrides,
  };
}

async function waitForForm() {
  await screen.findByLabelText('Client Name (optional)');
}

function postCalls() {
  return fetchMock.mock.calls.filter(([input, init]) =>
    new URL(String(input), 'http://localhost').pathname === '/api/appointments'
      && (init as RequestInit | undefined)?.method === 'POST');
}

describe('NewAppointmentModal Google conversion session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    installDefaultFetch();
  });

  it('prefills the client phone, title details, catalog service price, and description', async () => {
    render(<NewAppointmentModal {...modalProps({
      googleEventPrefill: {
        ...initialEvent,
        title: 'Gel Manicure — From $50 between Test Salon and Cynthia Okundigie',
        description: 'Client requested a short almond shape.',
        suggestedClient: {
          fullName: 'Cynthia Okundigie',
          phone: '4373132358',
          email: null,
        },
        suggestedService: null,
      },
    })} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Cynthia Okundigie');
      expect(screen.getByLabelText('Phone Number *')).toHaveValue('(437) 313-2358');
      expect(screen.getByRole('button', { name: /Gel Manicure/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Appointment price (CAD $)')).toHaveValue(55);
      expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Client requested a short almond shape.');
    });
  });

  it('preserves every editable value across a component rerender with fresh event objects', async () => {
    const props = modalProps();
    const view = render(<NewAppointmentModal {...props} />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Typed client' } });
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'typed@example.test' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-07-21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Appointment time' }));
    fireEvent.click(screen.getByRole('button', { name: '10:30' }));
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Typed private note' } });
    fireEvent.click(screen.getByRole('button', { name: /Gel Pedicure/ }));

    view.rerender(<NewAppointmentModal {...props} googleEventPrefill={{ ...initialEvent }} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Typed client');
      expect(screen.getByLabelText('Phone Number *')).toHaveValue('(416) 555-0198');
      expect(screen.getByLabelText('Email (optional)')).toHaveValue('typed@example.test');
      expect(screen.getByLabelText('Date')).toHaveValue('2099-07-21');
      expect(screen.getByRole('button', { name: 'Appointment time' })).toHaveTextContent('10:30');
      expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(75);
      expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Typed private note');
      expect(screen.getByRole('button', { name: /Gel Pedicure/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByTestId('google-event-changed-warning')).not.toBeInTheDocument();
    });
  });

  it('preserves values after a client-side validation failure', async () => {
    const props = modalProps();
    render(<NewAppointmentModal {...props} />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Validation client' } });
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Keep after validation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Appointment' }));

    expect(await screen.findByText('Please enter a duration between 1 and 1440 minutes')).toBeInTheDocument();
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Validation client');
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Keep after validation');
    expect(postCalls()).toHaveLength(0);
  });

  it('preserves the form on a server failure and exposes a retry action', async () => {
    let postAttempt = 0;
    installDefaultFetch(async () => {
      postAttempt += 1;
      return postAttempt === 1
        ? jsonResponse({ error: { code: 'CALENDAR_UNAVAILABLE', message: 'Calendar temporarily unavailable' } }, 503)
        : jsonResponse({ appointmentId: 'appt_retry' }, 201);
    });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<NewAppointmentModal {...modalProps({ onSuccess, onClose })} />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Retry client' } });
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Keep through retry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Appointment' }));

    expect(await screen.findByText('Calendar temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Retry client');
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Keep through retry');

    fireEvent.click(screen.getByRole('button', { name: 'Retry conversion' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(postCalls()).toHaveLength(2);
  });

  it('submits once with a stable idempotency key when the action is double-clicked', async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    installDefaultFetch(() => new Promise<Response>((resolve) => {
      resolvePost = resolve;
    }));
    const onSuccess = vi.fn();
    render(<NewAppointmentModal {...modalProps({ onSuccess })} />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    const submit = screen.getByRole('button', { name: 'Create Appointment' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(postCalls()).toHaveLength(1);

    const requestHeaders = new Headers((postCalls()[0]?.[1] as RequestInit).headers);

    expect(requestHeaders.get('Idempotency-Key')).toMatch(/.+/);

    await act(async () => {
      resolvePost?.(jsonResponse({ appointmentId: 'appt_once' }, 201));
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('closes after a successful conversion and sends conversion-only fields', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<NewAppointmentModal {...modalProps({ onSuccess, onClose })} />);
    await waitForForm();

    expect(postCalls()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Conversion note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Appointment' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    expect(onClose).toHaveBeenCalledTimes(1);

    const request = postCalls()[0];
    const body = JSON.parse(String((request?.[1] as RequestInit).body));

    expect(body).toEqual(expect.objectContaining({
      googleEventReviewId: 'google_event_1',
      durationMinutesOverride: 80,
      notes: 'Conversion note',
    }));
  });

  it('does not dismiss a mobile conversion from backdrop interaction', async () => {
    const onClose = vi.fn();
    render(<NewAppointmentModal {...modalProps({ onClose })} />);
    await waitForForm();

    fireEvent.click(screen.getByTestId('appointment-modal-backdrop'));
    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Mobile client' } });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Mobile client');
  });

  it('warns about a source update without overwriting edits and can apply only the latest timing', async () => {
    const props = modalProps();
    const view = render(<NewAppointmentModal {...props} />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Source-change client' } });
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Keep this note' } });

    const changedEvent: GoogleEventPrefill = {
      ...initialEvent,
      title: 'Controlled fake event updated',
      startTime: '2099-07-22T15:30:00.000Z',
      endTime: '2099-07-22T17:00:00.000Z',
      durationMinutes: 90,
      sourceVersion: '2099-07-02T00:00:00.000Z',
    };
    view.rerender(<NewAppointmentModal {...props} googleEventPrefill={changedEvent} />);

    expect(await screen.findByTestId('google-event-changed-warning')).toBeInTheDocument();
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Source-change client');
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(75);
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Keep this note');

    fireEvent.click(screen.getByRole('button', { name: 'Use latest Google timing' }));

    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(90);
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Source-change client');
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Keep this note');
  });

  it('requires acknowledgement before closing an unavailable source event', async () => {
    const onClose = vi.fn();
    const props = modalProps({ onClose });
    const view = render(<NewAppointmentModal {...props} />);
    await waitForForm();
    fireEvent.change(screen.getByLabelText('Client Name (optional)'), { target: { value: 'Unavailable source client' } });

    view.rerender(<NewAppointmentModal {...props} googleEventSourceStatus="deleted" />);

    expect(await screen.findByTestId('google-event-unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Client Name (optional)')).toHaveValue('Unavailable source client');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defaults the conversion to the primary technician while keeping it editable', async () => {
    render(<NewAppointmentModal {...modalProps()} />);
    await waitForForm();

    // The primary technician is preselected once the list loads…
    await waitFor(() => {
      expect(screen.getByText('Test Technician')).toBeInTheDocument();
    });

    // …and rides along on the conversion request.
    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Appointment' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));

    const body = JSON.parse(String((postCalls()[0]![1] as RequestInit).body));

    expect(body.technicianId).toBe('tech_1');
    expect(body.googleEventReviewId).toBe('google_event_1');
  });

  it('rotates the idempotency key after a failed submit so retry is a fresh request', async () => {
    installDefaultFetch(async () => jsonResponse({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    }, 500));
    render(<NewAppointmentModal {...modalProps()} />);
    await waitForForm();

    fireEvent.change(screen.getByLabelText('Phone Number *'), { target: { value: '4165550198' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Appointment' }));

    await screen.findByText('Something went wrong');

    fireEvent.click(screen.getByRole('button', { name: 'Retry conversion' }));

    await waitFor(() => expect(postCalls()).toHaveLength(2));

    const keyOf = (call: unknown[]) =>
      ((call[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    const firstKey = keyOf(postCalls()[0]!);
    const secondKey = keyOf(postCalls()[1]!);

    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });
});
