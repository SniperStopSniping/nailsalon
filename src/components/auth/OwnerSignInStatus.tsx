import type { ReactNode } from 'react';

/** Shared appearance for the existing organization-resolution and recovery states. */
export function OwnerSignInStatus({ busy, children, errorMessage, onRetry, organizationUnavailable = false }: {
  busy: boolean;
  children?: ReactNode;
  errorMessage: string | null;
  onRetry: () => void;
  organizationUnavailable?: boolean;
}) {
  if (busy) {
    return (
      <div className="luster-entry-card luster-auth-session-status" role="status">
        <div className="luster-auth-opening">
          <span aria-hidden="true" className="luster-auth-spinner motion-safe:animate-spin" />
          <p>Opening your Luster account…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="luster-auth-recovery">
      <div className="luster-entry-card luster-auth-session-status">
        <p className="luster-auth-session-title">{organizationUnavailable ? 'We couldn’t finish opening your account' : 'We couldn’t finish signing you in automatically'}</p>
        <p role="alert">{errorMessage}</p>
        <button className="luster-entry-button luster-entry-button--primary" onClick={onRetry} type="button">Try again</button>
        <p className="luster-auth-recovery-note">
          {organizationUnavailable ? 'You can return with this same account once setup is available.' : 'You can also finish the sign-in step below.'}
        </p>
      </div>
      {!organizationUnavailable && children}
    </div>
  );
}
