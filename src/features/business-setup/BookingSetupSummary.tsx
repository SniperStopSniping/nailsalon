import type { SetupDocument } from './contracts';
import { WEEKDAYS } from './contracts';

type Examples = { serviceName: string | null; technicianNames: string[]; days: { date: string; times: string[] }[] };

/** Same draft data in the standard, custom and inline owner previews. */
export function BookingSetupSummary({ document, examples }: { document: Pick<SetupDocument, 'business' | 'hours' | 'booking' | 'services' | 'bookingPolicy'>; examples?: Examples }) {
  return (
    <details className="bg-white p-4 text-sm">
      <summary>Proposed booking setup</summary>
      <p>{`${document.booking.currency} · ${document.booking.timezone} · ${document.booking.minimumNoticeMinutes} minutes notice · ${document.booking.bufferMinutes} minutes extra buffer · ${document.booking.confirmationMode === 'instant' ? 'Instant confirmation' : 'Owner approval required'}`}</p>
      <p>{document.business.locationDisplayMode === 'full_address' ? 'Full service address shown publicly.' : document.business.locationDisplayMode === 'after_booking' ? 'Exact service address shared after booking; hidden from public pages.' : 'Only the city or area is shown publicly; exact service address stays private.'}</p>
      <dl>
        {WEEKDAYS.map(day => (
          <div key={day}>
            <dt className="inline capitalize">{day}</dt>
            {': '}
            <dd className="inline">{document.hours[day] ? `${document.hours[day]!.open}–${document.hours[day]!.close}` : 'Closed'}</dd>
          </div>
        ))}
      </dl>
      {document.services.filter(service => service.preparationBufferMinutes || service.cleanupBufferMinutes).map(service => <p key={service.id}>{`${service.name}: ${service.preparationBufferMinutes} minutes preparation and ${service.cleanupBufferMinutes} minutes cleanup, separate from the appointment length.`}</p>)}
      {document.bookingPolicy?.enabled && (
        <section aria-label="Proposed booking agreement">
          <h3>{document.bookingPolicy.title}</h3>
          <p className="whitespace-pre-wrap">{document.bookingPolicy.text}</p>
          <p>{document.bookingPolicy.acknowledgment?.required ? 'Customers must accept this agreement during booking after you publish.' : 'Customer acceptance is not required.'}</p>
        </section>
      )}
      {examples
        ? (
            <>
              <p>{`Active team: ${examples.technicianNames.join(', ') || 'Team setup still needed'}`}</p>
              <p>{`Simulated times for ${examples.serviceName ?? 'your first service'}. These use your proposed hours, staff assignments, service time, buffers and notice. Existing appointments, time off and external calendars are excluded from this illustration. Real availability is checked during booking after publication.`}</p>
              {examples.days.map(day => <p key={day.date}>{`${day.date}: ${day.times.join(', ')}`}</p>)}
              {!examples.days.length && <p>No example times are available with this setup.</p>}
            </>
          )
        : <p>Open the full preview for simulated availability. Real availability is checked during booking after publication.</p>}
    </details>
  );
}
