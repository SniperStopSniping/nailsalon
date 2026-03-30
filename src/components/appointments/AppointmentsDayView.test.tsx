import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<object>('@dnd-kit/core');
  return {
    ...actual,
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
  };
});

import { AppointmentsDayView } from './AppointmentsDayView';

describe('AppointmentsDayView', () => {
  it('renders resource columns and opens appointments on click', () => {
    const onAppointmentSelect = vi.fn();

    render(
      <AppointmentsDayView
        selectedDate={new Date('2026-03-29T12:00:00.000Z')}
        onSelectedDateChange={vi.fn()}
        appointments={[{
          id: 'appt_1',
          clientName: 'Avery',
          startTime: '2026-03-29T14:00:00.000Z',
          endTime: '2026-03-29T15:00:00.000Z',
          status: 'confirmed',
          technicianId: 'tech_1',
          technicianName: 'Taylor',
          serviceLabel: 'Gel Manicure',
          totalPrice: 4500,
          totalDurationMinutes: 60,
          locationName: 'Front St',
          isLocked: false,
        }]}
        resources={[{ id: 'tech_1', label: 'Taylor' }]}
        slotIntervalMinutes={15}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onAppointmentSelect={onAppointmentSelect}
        onMoveAppointment={vi.fn()}
        emptyTitle="No appointments"
        emptyDescription="No appointments for the day."
        includeUnassignedResource={false}
      />,
    );

    expect(screen.getByText('Taylor')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /gel manicure/i }));
    expect(onAppointmentSelect).toHaveBeenCalledWith('appt_1');
  });
});
