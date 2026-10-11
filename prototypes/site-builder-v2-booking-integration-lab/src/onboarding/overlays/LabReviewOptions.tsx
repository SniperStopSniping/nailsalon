import { Download, FlaskConical } from 'lucide-react';

import { Dialog } from '../../ui/Dialog';
import { applyLabReviewFixture, LAB_REVIEW_FIXTURES } from '../fixtures';
import type { OnboardingLabState } from '../model/types';

export function LabReviewOptions({
  appliedFixtureId,
  eventCount,
  onApply,
  onClose,
  onExport,
  open,
}: {
  appliedFixtureId: string | null;
  eventCount: number;
  onApply: (createState: () => OnboardingLabState) => void;
  onClose: () => void;
  onExport: () => void;
  open: boolean;
}) {
  return (
    <Dialog
      description="These fixtures affect only this browser-local onboarding Lab."
      onClose={onClose}
      open={open}
      title="Lab review options"
      variant="sheet"
    >
      <div className="onboarding-lab-options">
        <div className="onboarding-lab-options__intro">
          <FlaskConical aria-hidden="true" size={22} />
          <p>Load a deterministic review state. A fixture with a starter rebuilds the exact existing universal starter document.</p>
        </div>
        <div className="onboarding-fixture-grid">
          {LAB_REVIEW_FIXTURES.map(fixture => (
            <button
              aria-pressed={appliedFixtureId === fixture.id}
              className="onboarding-fixture-card"
              key={fixture.id}
              type="button"
              onClick={() => onApply(() => applyLabReviewFixture(fixture.id))}
            >
              {fixture.label}
            </button>
          ))}
        </div>
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={onExport}>
            <Download aria-hidden="true" size={16} />
            {' '}
            Export event log (
            {eventCount}
            )
          </button>
          <button className="is-primary" type="button" onClick={onClose}>Done</button>
        </footer>
      </div>
    </Dialog>
  );
}
