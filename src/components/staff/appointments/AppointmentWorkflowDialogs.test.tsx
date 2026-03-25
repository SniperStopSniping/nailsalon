import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

import { AppointmentWorkflowDialogs } from './AppointmentWorkflowDialogs';
import type { StaffAppointmentData } from './types';

function buildAppointment(overrides: Partial<StaffAppointmentData> = {}): StaffAppointmentData {
  return {
    id: 'appt_1',
    clientName: 'Maya',
    clientPhone: '+15551234567',
    startTime: '2026-03-14T10:00:00.000Z',
    endTime: '2026-03-14T11:00:00.000Z',
    status: 'in_progress',
    technicianId: 'tech_1',
    services: [{ name: 'Gel Manicure' }],
    totalPrice: 6500,
    photos: [
      {
        id: 'photo_after',
        imageUrl: '/after.jpg',
        thumbnailUrl: null,
        photoType: 'after',
      },
    ],
    ...overrides,
  };
}

describe('AppointmentWorkflowDialogs', () => {
  it('shows the completion action only when the appointment has an after photo', () => {
    const onOpenCompleteDialog = vi.fn();

    const { rerender } = render(
      <AppointmentWorkflowDialogs
        appointment={buildAppointment()}
        showCompleteDialog={false}
        showCancelDialog={false}
        uploadingPhoto={false}
        uploadError={null}
        completing={false}
        cancelling={false}
        paymentMethod="card"
        onCloseWorkflow={vi.fn()}
        onStart={vi.fn()}
        onTriggerFileInput={vi.fn()}
        onOpenCompleteDialog={onOpenCompleteDialog}
        onCloseCompleteDialog={vi.fn()}
        onComplete={vi.fn()}
        onOpenCancelDialog={vi.fn()}
        onCloseCancelDialog={vi.fn()}
        onCancel={vi.fn()}
        onPaymentMethodChange={vi.fn()}
        formatTime={() => '10:00 AM'}
        formatPrice={() => '$65'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '✓ Complete & Mark Paid' }));
    expect(onOpenCompleteDialog).toHaveBeenCalledTimes(1);

    rerender(
      <AppointmentWorkflowDialogs
        appointment={buildAppointment({ photos: [] })}
        showCompleteDialog={false}
        showCancelDialog={false}
        uploadingPhoto={false}
        uploadError={null}
        completing={false}
        cancelling={false}
        paymentMethod="card"
        onCloseWorkflow={vi.fn()}
        onStart={vi.fn()}
        onTriggerFileInput={vi.fn()}
        onOpenCompleteDialog={onOpenCompleteDialog}
        onCloseCompleteDialog={vi.fn()}
        onComplete={vi.fn()}
        onOpenCancelDialog={vi.fn()}
        onCloseCancelDialog={vi.fn()}
        onCancel={vi.fn()}
        onPaymentMethodChange={vi.fn()}
        formatTime={() => '10:00 AM'}
        formatPrice={() => '$65'}
      />,
    );

    expect(screen.queryByRole('button', { name: '✓ Complete & Mark Paid' })).not.toBeInTheDocument();
  });

  it('forwards cancellation reason selection from the shared cancel dialog', () => {
    const onCancel = vi.fn();

    render(
      <AppointmentWorkflowDialogs
        appointment={buildAppointment()}
        showCompleteDialog={false}
        showCancelDialog
        uploadingPhoto={false}
        uploadError={null}
        completing={false}
        cancelling={false}
        paymentMethod="card"
        onCloseWorkflow={vi.fn()}
        onStart={vi.fn()}
        onTriggerFileInput={vi.fn()}
        onOpenCompleteDialog={vi.fn()}
        onCloseCompleteDialog={vi.fn()}
        onComplete={vi.fn()}
        onOpenCancelDialog={vi.fn()}
        onCloseCancelDialog={vi.fn()}
        onCancel={onCancel}
        onPaymentMethodChange={vi.fn()}
        formatTime={() => '10:00 AM'}
        formatPrice={() => '$65'}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Client Request/ }));

    expect(onCancel).toHaveBeenCalledWith('client_request');
  });
});
