'use client';

import type { ComponentProps } from 'react';

import { NewAppointmentModal } from './NewAppointmentModal';

type WalkInModalProps = Pick<ComponentProps<typeof NewAppointmentModal>, 'isOpen' | 'onClose' | 'onSuccess' | 'salonSlug'>;

/** Walk-ins and scheduled appointments use the same owner booking form. */
export function WalkInModal(props: WalkInModalProps) {
  return <NewAppointmentModal {...props} entryPoint="walk-in" />;
}
