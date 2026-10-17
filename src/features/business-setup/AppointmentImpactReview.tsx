import type { SetupReview } from './contracts';

export function AppointmentImpactReview({ impact, acknowledged, onAcknowledge }: { impact: NonNullable<SetupReview['appointmentImpact']>; acknowledged: boolean; onAcknowledge: (value: boolean) => void }) {
  const requiresAcknowledgment = impact.outsideHoursCount > 0 || impact.staffAffectedCount > 0;
  return (
    <div role="group" aria-label="Existing appointment review">
      <h3>Your existing appointments</h3>
      <p>{`${impact.upcomingCount} upcoming appointment${impact.upcomingCount === 1 ? '' : 's'} checked. ${impact.outsideHoursCount} ${impact.outsideHoursCount === 1 ? 'falls' : 'fall'} outside the proposed opening or staff hours. ${impact.staffAffectedCount} ${impact.staffAffectedCount === 1 ? 'is' : 'are'} with someone whose booking availability or service choices will change.`}</p>
      <p>New bookings will use your approved settings. Existing appointments keep their staff, prices and times. Nothing will be moved, cancelled or sent to customers by publishing this change.</p>
      {requiresAcknowledgment && (
        <label>
          <input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)} />
          {' '}
          I understand these existing appointments will stay as booked. I’ll arrange any needed changes with my customers.
        </label>
      )}
    </div>
  );
}
