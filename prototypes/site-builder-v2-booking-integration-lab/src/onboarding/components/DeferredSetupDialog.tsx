import { Component, type ReactNode, Suspense, useEffect, useLayoutEffect, useState } from 'react';

import { Dialog } from '../../ui/Dialog';

type Props = {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
};

class DialogLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <Dialog onClose={this.props.onClose} open={this.props.open} title={this.props.title} variant="bottom-sheet">
          <div className="onboarding-deferred-content" role="alert">
            <p>We couldn’t load this editor. Close it to continue setup, or reload to try again.</p>
            <button className="onboarding-primary-action" type="button" onClick={() => window.location.reload()}>
              Reload setup
            </button>
            <button className="onboarding-secondary-action" type="button" onClick={this.props.onClose}>
              Continue setup
            </button>
          </div>
        </Dialog>
      );
    }
    return this.props.children;
  }
}

/** Download optional editors on first use; keep their close/cleanup effects intact afterward. */
export function DeferredSetupDialog({ children, onClose, open, title }: Props) {
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) {
      setHasOpened(true);
    }
  }, [open]);

  // The loading dialog is replaced by the editor, so preserve the original
  // trigger across that replacement as well as the editor's normal focus trap.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = document.activeElement;
    return () => {
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (
          (!active || active === document.body || active === document.documentElement)
          && trigger instanceof HTMLElement
          && trigger.isConnected
          && !trigger.matches(':disabled')
          && !trigger.closest('[hidden], [inert], [aria-hidden="true"]')
        ) {
          trigger.focus({ preventScroll: true });
        }
      });
    };
  }, [open]);

  if (!open && !hasOpened) {
    return null;
  }

  return (
    <DialogLoadBoundary onClose={onClose} open={open} title={title}>
      <Suspense fallback={(
        <Dialog onClose={onClose} open={open} restoreFocusOnClose={false} title={title} variant="bottom-sheet">
          <div className="onboarding-deferred-content" role="status">Opening editor…</div>
        </Dialog>
      )}
      >
        {children}
      </Suspense>
    </DialogLoadBoundary>
  );
}
