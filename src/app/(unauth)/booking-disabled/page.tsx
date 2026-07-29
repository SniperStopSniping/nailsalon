import { CalendarX } from 'lucide-react';

import { SalonStatusPage } from '@/components/SalonStatusPage';

export const metadata = {
  title: 'Online Booking Unavailable',
  description: 'Online booking is not currently available for this salon.',
};

export default function BookingDisabledPage() {
  return (
    <SalonStatusPage
      icon={CalendarX}
      title="Online Booking Unavailable"
      description="This salon is not currently accepting online bookings. Please contact the salon directly to schedule your appointment."
      footer="Online booking may be temporarily unavailable or not offered by this salon."
    />
  );
}
