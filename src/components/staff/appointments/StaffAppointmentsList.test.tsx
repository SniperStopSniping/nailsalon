import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={props.alt} />,
}));

import { StaffAppointmentsList } from './StaffAppointmentsList';
import type { StaffAppointmentData } from './types';

const appointment: StaffAppointmentData = {
  id: 'appt_1',
  clientName: 'Maya',
  clientPhone: '+15551234567',
  startTime: '2026-03-14T10:00:00.000Z',
  endTime: '2026-03-14T11:00:00.000Z',
  status: 'confirmed',
  technicianId: 'tech_1',
  services: [{ name: 'Gel Manicure' }],
  totalPrice: 6500,
  photos: [],
};

describe('StaffAppointmentsList', () => {
  it('renders appointments and forwards selection actions', () => {
    const onSelect = vi.fn();

    render(
      <StaffAppointmentsList
        appointments={[appointment]}
        mounted
        onSelect={onSelect}
        formatTime={() => '10:00 AM'}
        formatPrice={() => '$65'}
      />,
    );

    expect(screen.getByText('Maya')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '📸 Manage Photos & Workflow' }));

    expect(onSelect).toHaveBeenCalledWith(appointment);
  });
});
