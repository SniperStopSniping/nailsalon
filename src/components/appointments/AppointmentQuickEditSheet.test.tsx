import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AppointmentManageDetail } from '@/libs/appointmentManage';

import { AppointmentQuickEditSheet } from './AppointmentQuickEditSheet';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

const baseDetail: AppointmentManageDetail = {
  appointment: {
    id: 'appt_1',
    salonId: 'salon_1',
    salonSlug: 'salon-a',
    clientName: 'Avery',
    clientPhone: '4165551234',
    technicianId: 'tech_1',
    locationId: 'loc_1',
    locationName: 'Front St',
    status: 'confirmed',
    startTime: '2026-03-29T15:00:00.000Z',
    endTime: '2026-03-29T16:00:00.000Z',
    totalPrice: 4500,
    totalDurationMinutes: 60,
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    isLocked: false,
    lockedAt: null,
    paymentStatus: 'pending',
    baseServiceId: 'svc_1',
    baseServiceName: 'Gel Manicure',
    discountType: null,
    discountAmountCents: 0,
    notes: null,
    techNotes: null,
  },
  services: [{
    id: 'svc_1',
    name: 'Gel Manicure',
    category: 'manicure',
    priceAtBooking: 4500,
    durationAtBooking: 60,
    isBaseService: true,
  }],
  addOns: [],
  serviceOptions: [
    { id: 'svc_1', name: 'Gel Manicure', category: 'manicure', priceCents: 4500, durationMinutes: 60 },
    { id: 'svc_2', name: 'BIAB Overlay', category: 'builder_gel', priceCents: 6500, durationMinutes: 75 },
  ],
  technicianOptions: [
    { id: 'tech_1', name: 'Taylor' },
    { id: 'tech_2', name: 'Jordan' },
  ],
  permissions: {
    canMove: true,
    canChangeService: true,
    canCancel: true,
    canMarkCompleted: true,
    canStart: true,
    canConfirm: false,
    canMarkNoShow: true,
    canReassignTechnician: false,
  },
  warnings: [],
  communications: [],
};

describe('AppointmentQuickEditSheet', () => {
  it('disables technician reassignment for staff permissions', () => {
    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={baseDetail}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByLabelText('Technician')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next available' })).toBeInTheDocument();
  });

  it('submits changed values through the save handler', async () => {
    const onSaveEdits = vi.fn(async () => {});

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={{
          ...baseDetail,
          permissions: {
            ...baseDetail.permissions,
            canReassignTechnician: true,
          },
        }}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={onSaveEdits}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
      />,
    );

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc_2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSaveEdits).toHaveBeenCalledWith(expect.objectContaining({
        baseServiceId: 'svc_2',
      }));
    });
  });

  it('cancels through a confirmation dialog with consequences, reason, and internal note', async () => {
    const onCancelAppointment = vi.fn(async () => {});

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={baseDetail}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={onCancelAppointment}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByTestId('appointment-sheet-cancel'));

    // Nothing is cancelled until the dialog confirms.
    expect(onCancelAppointment).not.toHaveBeenCalled();
    expect(screen.getByText(/frees the time slot/i)).toBeInTheDocument();
    expect(screen.getByText(/stops reminder messages/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-reason-rescheduled'));
    fireEvent.change(screen.getByTestId('appointment-cancel-note'), { target: { value: 'Client moving to Friday' } });
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(onCancelAppointment).toHaveBeenCalledWith({
        reason: 'rescheduled',
        internalNote: 'Client moving to Friday',
      });
    });
  });

  it('marks no-show through a confirmation dialog instead of window.confirm', async () => {
    const onMarkNoShow = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={baseDetail}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
        onMarkNoShow={onMarkNoShow}
      />,
    );

    fireEvent.click(screen.getByTestId('appointment-sheet-no-show'));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(onMarkNoShow).toHaveBeenCalledTimes(1));

    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('blocks backdrop dismissal while edits are unsaved', () => {
    const onClose = vi.fn();

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={onClose}
        detail={baseDetail}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
      />,
    );

    // Make the form dirty, then click the backdrop.
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc_2' } });
    fireEvent.click(screen.getAllByRole('presentation')[0]!);

    expect(onClose).not.toHaveBeenCalled();

    // The explicit close button still works.
    fireEvent.click(screen.getByTestId('appointment-sheet-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('routes Mark completed into the checkout flow without finalizing here', () => {
    const onMarkCompleted = vi.fn();

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={baseDetail}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={onMarkCompleted}
        onStartAppointment={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByTestId('appointment-sheet-mark-completed'));

    expect(onMarkCompleted).toHaveBeenCalledTimes(1);
    // The vague "complete anyway" dead-end is gone from Quick Edit — photo
    // decisions live inside the checkout flow, next to a working uploader.
    expect(screen.queryByText('No after photo uploaded')).not.toBeInTheDocument();
  });

  it('always shows the photo uploader when wiring exists, even with zero photos', () => {
    const onUploadPhoto = vi.fn();

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={baseDetail}
        loading={false}
        saving={false}
        actionError={null}
        photos={[]}
        onUploadPhoto={onUploadPhoto}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
      />,
    );

    // The first photo used to be unreachable (buttons only rendered once a
    // photo existed) — the uploader must render for an empty gallery too.
    expect(screen.getByTestId('appointment-sheet-photos')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('appointment-sheet-upload-after'));

    expect(onUploadPhoto).toHaveBeenCalledWith('after');
  });

  it('offers View receipt only for completed appointments', () => {
    const onViewReceipt = vi.fn();
    const completedDetail = {
      ...baseDetail,
      appointment: { ...baseDetail.appointment, status: 'completed' },
      permissions: { ...baseDetail.permissions, canMarkCompleted: false },
    };

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={completedDetail}
        loading={false}
        saving={false}
        actionError={null}
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
        onViewReceipt={onViewReceipt}
      />,
    );

    fireEvent.click(screen.getByTestId('appointment-sheet-view-receipt'));

    expect(onViewReceipt).toHaveBeenCalledTimes(1);
  });

  it('shows the failure reason and a Try again action when detail cannot load', () => {
    const onRetryLoad = vi.fn();

    render(
      <AppointmentQuickEditSheet
        isOpen
        onClose={vi.fn()}
        detail={null}
        loading={false}
        saving={false}
        actionError="Failed to load appointment details. Check your connection and try again."
        onSaveEdits={vi.fn(async () => {})}
        onMoveToNextAvailable={vi.fn(async () => {})}
        onCancelAppointment={vi.fn(async () => {})}
        onMarkCompleted={vi.fn(async () => {})}
        onStartAppointment={vi.fn(async () => {})}
        onRetryLoad={onRetryLoad}
      />,
    );

    expect(screen.getByText(/check your connection/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('appointment-sheet-retry-load'));

    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});
