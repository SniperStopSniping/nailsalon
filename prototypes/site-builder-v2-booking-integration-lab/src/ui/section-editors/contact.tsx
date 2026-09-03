import { getPublicContactActions } from '../../onboarding/model/contact';
import type { LibrarySectionEditorProps } from './types';

/**
 * Contact has no settings of its own beyond the design the shell picks:
 * everything it shows is the Business Profile's public contact surface. So the
 * editor shows what will actually appear — a read-only list resolved by the
 * same helper the customer renderer uses — rather than controls that would
 * change nothing.
 */
export function ContactEditor({ profile }: LibrarySectionEditorProps<'contact'>) {
  const actions = getPublicContactActions(profile);
  return (
    <div className="form-field">
      <span>What this section shows</span>
      <p className="form-hint">
        Contact shows your public location, hours, and the ways to reach you,
        straight from your Business Profile. Edit them there and this section
        follows.
      </p>
      {actions.length > 0
        ? (
            <ul className="form-hint">
              {actions.map(action => (
                <li key={`${action.method}-${action.href}`}>
                  {action.actionLabel}
                  {': '}
                  {action.detail}
                  {action.preferred && action.method !== 'booking' ? ' · Preferred' : ''}
                </li>
              ))}
            </ul>
          )
        : (
            <p className="form-hint">
              No public way to reach you is set yet — add one in your Business
              Profile, or leave Booking as the way clients reach you.
            </p>
          )}
    </div>
  );
}
