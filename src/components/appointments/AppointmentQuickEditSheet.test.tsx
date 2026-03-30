import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

import type { AppointmentManageDetail } from '@/libs/appointmentManage';
import { AppointmentQuickEditSheet } from './AppointmentQuickEditSheet';

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
    canReassignTechnician: false,
  },
  warnings: [],
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
});
