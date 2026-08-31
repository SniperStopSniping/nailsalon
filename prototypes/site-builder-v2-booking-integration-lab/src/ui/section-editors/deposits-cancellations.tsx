import type { DepositsCancellationsSettings } from '../../model/section-library/settings';
import {
  deriveDepositsAndCancellationsSummary,
  getDepositsAndCancellationsDisplayWording,
  isDepositsAndCancellationsComplete,
} from '../../onboarding/model/policies';
import { ChoiceField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/**
 * Deposits & Cancellations owns no wording of its own: both modes read the one
 * shared policies authority. The previews below are the exact customer text
 * each mode produces right now, so the choice is never made blind — and the
 * summary is only ever shown once its rules are complete, because before that
 * its helper returns owner-facing prompt copy the customer must never see.
 */
export function DepositsCancellationsEditor({
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'deposits_cancellations'>) {
  const { policies } = profile;
  const summary = isDepositsAndCancellationsComplete(policies)
    ? deriveDepositsAndCancellationsSummary(policies).trim()
    : '';
  const full = getDepositsAndCancellationsDisplayWording(policies).trim();

  return (
    <>
      <ChoiceField
        label="Wording"
        onChange={wordingMode => onChange({
          ...settings,
          wordingMode,
        } satisfies DepositsCancellationsSettings)}
        options={[
          { label: 'Short summary', value: 'summary' },
          { label: 'Full wording', value: 'full' },
        ]}
        value={settings.wordingMode}
      />
      <div className="form-field">
        <span>
          Short summary{settings.wordingMode === 'summary' ? ' — on your site now' : ''}
        </span>
        {summary ? (
          <p className="form-hint">“{summary}”</p>
        ) : (
          <small className="form-hint">
            The short summary unlocks once your deposit and cancellation rules
            are complete in Policies. Until then this section falls back to your
            full wording.
          </small>
        )}
      </div>
      <div className="form-field">
        <span>
          Full wording{settings.wordingMode === 'full' ? ' — on your site now' : ''}
        </span>
        {full ? (
          <p className="form-hint">“{full}”</p>
        ) : (
          <small className="form-hint">
            Your deposit and cancellation wording is empty or hidden in
            Policies, so this section stays off your site.
          </small>
        )}
      </div>
    </>
  );
}
