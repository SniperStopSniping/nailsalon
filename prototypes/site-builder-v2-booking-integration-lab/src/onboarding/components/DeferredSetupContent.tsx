import { Component, type ReactNode, Suspense } from 'react';

type Props = { children: ReactNode; label?: string };

/** Keep setup/navigation mounted while a later screen downloads. */
class SetupLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="onboarding-deferred-content" role="alert">
          <p>We couldn’t load this part of setup.</p>
          <button className="onboarding-primary-action" type="button" onClick={() => window.location.reload()}>
            Reload setup
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function DeferredSetupContent({ children, label = 'Opening setup…' }: Props) {
  return (
    <SetupLoadBoundary>
      <Suspense fallback={<div className="onboarding-deferred-content" role="status">{label}</div>}>
        {children}
      </Suspense>
    </SetupLoadBoundary>
  );
}
