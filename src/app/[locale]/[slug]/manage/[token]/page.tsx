import { eq } from 'drizzle-orm';
import { CalendarDays, Clock, Scissors } from 'lucide-react';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getClientChangePolicy, resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentServicesSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

import { ManageAppointmentActions } from './ManageAppointmentActions';

export const dynamic = 'force-dynamic';

export default async function ManageAppointmentPage({ params }: { params: { locale: string; slug: string; token: string } }) {
  const capability = await verifyAppointmentAccessToken(params.token, { salonId: undefined });
  if (!capability || capability.appointment.salonId !== capability.salonId || capability.salonSlug !== params.slug) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">This link is invalid or expired</h1>
          <p className="mt-3 text-stone-600">Contact the salon if you still need help with this appointment.</p>
        </div>
      </main>
    );
  }
  const appointment = capability.appointment;
  const isActive = ['pending', 'confirmed'].includes(appointment.status);
  const query = new URLSearchParams({ originalAppointmentId: appointment.id, manageToken: params.token });
  const rescheduleUrl = `/${params.locale}/${params.slug}/book/service?${query.toString()}`;
  const timezone = resolveBookingConfigFromSettings(capability.salonSettings as SalonSettings | null).timezone;
  const bookingConfig = resolveBookingConfigFromSettings(capability.salonSettings as SalonSettings | null);
  const changePolicy = getClientChangePolicy(appointment.startTime, bookingConfig);
  const services = await db.select({ name: appointmentServicesSchema.nameSnapshot })
    .from(appointmentServicesSchema)
    .where(eq(appointmentServicesSchema.appointmentId, appointment.id));
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-14">
      <div className="mx-auto max-w-xl">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Appointment management</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm">
          <p className="text-sm font-medium text-rose-700">{capability.salonName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">{appointment.clientName ? `${appointment.clientName}'s appointment` : 'Your appointment'}</h1>
          <div className="mt-6 space-y-4 text-sm text-stone-700">
            <div className="flex gap-3">
              <CalendarDays className="size-5 text-rose-700" />
              <span>{formatDateInTimeZone(appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, timezone)}</span>
            </div>
            <div className="flex gap-3">
              <Clock className="size-5 text-rose-700" />
              <span>
                {formatTimeInTimeZone(appointment.startTime.toISOString(), {}, timezone)}
                {' – '}
                {formatTimeInTimeZone(appointment.endTime.toISOString(), {}, timezone)}
                {' · '}
                {appointment.totalDurationMinutes}
                {' minutes'}
              </span>
            </div>
            <div className="flex gap-3">
              <Scissors className="size-5 text-rose-700" />
              <span>
                {services.map(service => service.name).filter(Boolean).join(', ') || 'Appointment'}
                {' · '}
                $
                {(appointment.totalPrice / 100).toFixed(2)}
                {' '}
                CAD
              </span>
            </div>
          </div>
          <div className="mt-8"><ManageAppointmentActions token={params.token} rescheduleUrl={rescheduleUrl} isActive={isActive} canChange={changePolicy.canChange} cutoffHours={bookingConfig.clientChangeCutoffHours} salonEmail={capability.salonEmail} salonPhone={capability.salonPhone} /></div>
        </div>
      </div>
    </main>
  );
}
