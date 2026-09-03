import type {
  PoliciesSectionSettings,
  PolicyToggleId,
} from '../../model/section-library/settings';
import { POLICY_TOGGLE_IDS } from '../../model/section-library/settings';
import { getPolicyDisplayWording } from '../../onboarding/model/policies';
import type { LibrarySectionEditorProps } from './types';

/** Matches the customer renderer's headings, so the owner ticks what they see. */
const POLICY_TOGGLE_LABELS: Record<PolicyToggleId, string> = {
  late_arrivals: 'Late arrivals',
  no_shows: 'No-shows',
  other: 'Good to know',
  repairs: 'Repairs',
};

/**
 * Before You Book chooses which policy topics appear; every word comes from the
 * shared policies authority. Deposits and cancellations are deliberately absent
 * — they belong to the Deposits & Cancellations section.
 */
export function PoliciesEditor({
  onChange,
  profile,
  settings,
}: LibrarySectionEditorProps<'policies'>) {
  const { policies } = profile;
  // The registry restores all four topics when `includedSections` is empty, so
  // an empty selection could never survive a save — the last topic stays on.
  const lastRemaining = settings.includedSections.length <= 1;

  const toggleTopic = (toggleId: PolicyToggleId, included: boolean) => {
    const includedSections = included
      ? [...settings.includedSections, toggleId]
      : settings.includedSections.filter(id => id !== toggleId);
    onChange({ ...settings, includedSections } satisfies PoliciesSectionSettings);
  };

  return (
    <div className="form-field">
      <span>Topics to show</span>
      <small className="form-hint">
        Each topic shows the wording you wrote in Policies. A topic with no
        wording stays off your site even while it is ticked here.
      </small>
      <div className="editor-record-list">
        {POLICY_TOGGLE_IDS.map((toggleId) => {
          const included = settings.includedSections.includes(toggleId);
          const wording = getPolicyDisplayWording(policies, toggleId).trim();
          return (
            <div className="editor-record" key={toggleId}>
              <label className="form-field form-field--toggle">
                <input
                  checked={included}
                  disabled={included && lastRemaining}
                  onChange={event => toggleTopic(toggleId, event.target.checked)}
                  type="checkbox"
                />
                <span>{POLICY_TOGGLE_LABELS[toggleId]}</span>
              </label>
              <p className="form-hint">
                {wording || (policies.copy[toggleId].visible
                  ? '(no wording yet — finish this policy in onboarding/policies)'
                  : '(hidden in onboarding/policies — turn it back on there to show it here)')}
              </p>
            </div>
          );
        })}
      </div>
      {lastRemaining
        ? (
            <small className="form-hint">
              One topic has to stay on. Hide or remove the whole section if you do
              not want any of them.
            </small>
          )
        : null}
    </div>
  );
}
