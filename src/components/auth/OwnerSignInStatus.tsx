import type { ReactNode } from 'react';

/** Shared appearance for the existing organization-resolution and recovery states. */
export function OwnerSignInStatus({ busy, children, errorMessage, onRetry }: {
  busy: boolean;
  children?: ReactNode;
  errorMessage: string | null;
  onRetry: () => void;
}) {
  if (busy) {
    return (
      <div className="luster-entry-card luster-auth-session-status" role="status">
        <div className="luster-auth-opening">
          <span aria-hidden="true" className="luster-auth-spinner motion-safe:animate-spin" />
          <p>Opening your workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="luster-auth-recovery">
      <div className="luster-entry-card luster-auth-session-status">
        <p className="luster-auth-session-title">We couldn’t open your workspace automatically</p>
        <p role="alert">{errorMessage}</p>
        <button className="luster-entry-button luster-entry-button--primary" onClick={onRetry} type="button">Try again</button>
        <p className="luster-auth-recovery-note">
          If it keeps failing, finish the step below — your salon is already waiting in Luster.
        </p>
      </div>
      {children}
    </div>
  );
}
