import type { SetupDocument } from './contracts';
import { teamReviewValue } from './team-summary';

export function TeamBookingSummary({ document, published = false }: { published?: boolean; document: Pick<SetupDocument, 'staff' | 'services'> }) {
  if (!document.staff?.length) {
    return null;
  }
  return (
    <details className="setup-team-summary">
      <summary>{published ? 'Team and service choices' : 'Proposed team and service choices'}</summary>
      {document.staff.map(person => <p key={person.id}>{teamReviewValue([person], document.services)}</p>)}
      <p>{published ? 'These are your saved team settings. Availability examples exclude existing appointments, time off and connected calendars. Real availability is checked in your public booking flow.' : 'This is your saved draft. Availability examples exclude existing appointments, time off and connected calendars. Real availability is checked during booking after publication.'}</p>
    </details>
  );
}
