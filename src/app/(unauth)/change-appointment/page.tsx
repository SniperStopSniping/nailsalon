import { notFound } from 'next/navigation';

/**
 * The retired customer-account flow must stay unreachable. Appointment
 * management is available only through canonical capability-token links.
 */
export default function ChangeAppointmentPage() {
  notFound();
}
