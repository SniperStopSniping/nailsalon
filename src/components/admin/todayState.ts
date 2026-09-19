export type TodayAppointmentState = {
  id: string;
  endTime: string;
  startTime: string;
  status: string;
};

export type TodayOperationalState<T extends TodayAppointmentState> = {
  currentAppointment: T | null;
  nextConfirmedAppointment: T | null;
  unresolvedAppointments: T[];
  pendingRequests: T[];
};

/**
 * This is presentation state only. Time can tell an owner that an appointment
 * needs an update; it must never change the appointment's authoritative
 * attendance, payment, or completion state.
 */
export function getTodayOperationalState<T extends TodayAppointmentState>(
  appointments: T[],
  now: number,
): TodayOperationalState<T> {
  const ordered = [...appointments].sort(
    (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
  );

  const unresolvedAppointments = ordered.filter(appointment =>
    ['confirmed', 'pending'].includes(appointment.status)
    && new Date(appointment.endTime).getTime() < now,
  );

  return {
    currentAppointment: ordered.find(
      appointment => appointment.status === 'in_progress',
    ) ?? null,
    nextConfirmedAppointment: ordered.find(appointment =>
      appointment.status === 'confirmed'
      && new Date(appointment.startTime).getTime() >= now,
    ) ?? null,
    unresolvedAppointments,
    pendingRequests: ordered.filter(appointment =>
      appointment.status === 'pending'
      && new Date(appointment.endTime).getTime() >= now,
    ),
  };
}
