import { Check } from 'lucide-react';

import type { SelectionSummary } from './types';

export type SelectedSummaryProps = {
  summary: SelectionSummary;
  onChange: () => void;
  onContinue: () => void;
};

export function SelectedSummary({
  summary,
  onChange,
  onContinue,
}: SelectedSummaryProps) {
  return (
    <div
      className="selected-summary"
      aria-label="Selected service summary"
      data-testid="selected-service-summary"
      role="group"
    >
      <div className="selected-summary-copy">
        <p className="selected-summary-label">
          <Check size={11} strokeWidth={3} aria-hidden="true" />
          Selected
        </p>
        <p className="selected-summary-name">{summary.service.name}</p>
        <p className="selected-summary-meta">
          {summary.durationLabel}
          {' · '}
          {summary.price.label}
          {summary.addOns.length > 0 ? ` · ${summary.addOns.length} add-on${summary.addOns.length === 1 ? '' : 's'}` : ''}
        </p>
      </div>
      <div className="selected-summary-actions">
        <button className="summary-change" type="button" onClick={onChange}>
          Change
        </button>
        <button className="summary-continue" type="button" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
