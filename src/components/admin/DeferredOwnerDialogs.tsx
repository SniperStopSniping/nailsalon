'use client';

import { type ComponentProps, lazy } from 'react';

import { DeferredAdminDialog } from './DeferredAdminContent';
import type { NewAppointmentModal as AppointmentDialog } from './NewAppointmentModal';
import type { UsageBillingModal as BillingDialog } from './UsageBillingModal';
import type { WalkInModal as WalkInDialog } from './WalkInModal';

const NewAppointmentModal = lazy(() => import('./NewAppointmentModal').then(module => ({ default: module.NewAppointmentModal })));
const UsageBillingModal = lazy(() => import('./UsageBillingModal').then(module => ({ default: module.UsageBillingModal })));
const WalkInModal = lazy(() => import('./WalkInModal').then(module => ({ default: module.WalkInModal })));

export function DeferredNewAppointmentModal(props: ComponentProps<typeof AppointmentDialog>) {
  return <DeferredAdminDialog isOpen={props.isOpen} onClose={props.onClose} label="New appointment"><NewAppointmentModal {...props} /></DeferredAdminDialog>;
}

export function DeferredUsageBillingModal(props: ComponentProps<typeof BillingDialog>) {
  return <DeferredAdminDialog isOpen onClose={props.onClose} label="Usage & billing"><UsageBillingModal {...props} /></DeferredAdminDialog>;
}

export function DeferredWalkInModal(props: ComponentProps<typeof WalkInDialog>) {
  return <DeferredAdminDialog isOpen={props.isOpen} onClose={props.onClose} label="Quick walk-in"><WalkInModal {...props} /></DeferredAdminDialog>;
}
