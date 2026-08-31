import { useMemo } from 'react';

import type {
  QuickInfoFactId,
  QuickInfoSettings,
} from '../../model/section-library/settings';
import { QUICK_INFO_FACT_IDS } from '../../model/section-library/settings';
import { getWeeklyHoursPreviewStatus } from '../../onboarding/model/hours';
import { getPublicLocationPreview } from '../../onboarding/model/location';
import {
  labelForMinimumNotice,
  labelForNewClients,
  labelForVisitMode,
} from '../../onboarding/preview/customer-facts';
import type { LibrarySectionEditorProps } from './types';

const FACT_LABELS: Record<QuickInfoFactId, string> = {
  location: 'Area or address',
  minimum_notice: 'How far ahead to book',
  new_clients: 'New client status',
  open_status: 'Open right now',
  visit_mode: 'Appointments or walk-ins',
};

/** The registry keeps at most four facts (`facts.slice(0, 4)`). */
const MAX_SHOWN_FACTS = 4;

/**
 * Quick Info is settings-only: every value it shows already belongs to a
 * shared authority (location, booking preferences, hours), so this editor
 * picks which of those facts appear and in what order — it never restates
 * them as section content.
 */
export function QuickInfoEditor({
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'quick_info'>) {
  // The customer strip reads the preview clock; the owner reads it now.
  const now = useMemo(() => new Date().toISOString(), []);
  const hoursStatus = getWeeklyHoursPreviewStatus(profile.hours, now);
  const factValues: Record<QuickInfoFactId, string | null> = {
    location: getPublicLocationPreview(profile.location).primary.trim() || null,
    minimum_notice: labelForMinimumNotice(profile),
    new_clients: labelForNewClients(profile),
    open_status: hoursStatus?.label ?? null,
    visit_mode: labelForVisitMode(profile),
  };
  const orderedFactIds: QuickInfoFactId[] = [
    ...settings.facts,
    ...QUICK_INFO_FACT_IDS.filter(factId => !settings.facts.includes(factId)),
  ];
  const atLimit = settings.facts.length >= MAX_SHOWN_FACTS;

  const toggleFact = (factId: QuickInfoFactId, included: boolean) => {
    const nextFacts = included
      ? [...settings.facts, factId].slice(0, MAX_SHOWN_FACTS)
      : settings.facts.filter(id => id !== factId);
    onChange({ ...settings, facts: nextFacts } satisfies QuickInfoSettings);
  };

  return (
    <div className="form-field">
      <span>Facts to show</span>
      <small className="form-hint">
        Up to four, in the order you tick them. Keep at least one — an empty
        strip falls back to the standard four facts.
      </small>
      <div className="editor-record-list">
        {orderedFactIds.map((factId) => {
          const included = settings.facts.includes(factId);
          const value = factValues[factId];
          return (
            <label className="form-field form-field--toggle" key={factId}>
              <input
                checked={included}
                disabled={included ? settings.facts.length === 1 : atLimit}
                onChange={event => toggleFact(factId, event.target.checked)}
                type="checkbox"
              />
              <span>{FACT_LABELS[factId]}</span>
              <small className="form-hint">{value ?? '(nothing to show yet)'}</small>
            </label>
          );
        })}
      </div>
    </div>
  );
}
