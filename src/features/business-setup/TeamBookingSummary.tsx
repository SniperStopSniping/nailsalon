import type { SetupDocument } from './contracts';
import { teamReviewValue } from './team-summary';

export function TeamBookingSummary({ document }: { document: SetupDocument }) {
  if (!document.staff?.length) {
    return null;
  }
  return (
    <details className="setup-team-summary">
      <summary>Proposed team and service choices</summary>
      {document.staff.map(person => <p key={person.id}>{teamReviewValue([person], document.services)}</p>)}
      <p>This is your saved draft. Availability examples exclude existing appointments, time off and connected calendars. Real availability is checked during booking after publication.</p>
    </details>
  );
}
