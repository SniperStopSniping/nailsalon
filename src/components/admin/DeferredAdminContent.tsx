'use client';

import { ArrowLeft } from 'lucide-react';
import { Component, type ComponentProps, type ReactNode, Suspense, useEffect, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

import { AppModal } from './AppModal';

type ContentProps = {
  children: ReactNode;
  label: string;
  onClose: () => void;
};

function LoadingContent({ label, onClose, failed = false }: Omit<ContentProps, 'children'> & { failed?: boolean }) {
  return (
    <section className="min-h-40 bg-[var(--owner-surface)] p-5 text-[var(--owner-ink)]" aria-label={label}>
      <button className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 font-medium text-[var(--owner-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]" onClick={onClose} type="button">
        <ArrowLeft aria-hidden="true" size={18} />
        Back
      </button>
      <h2 className="owner-title mt-4 text-2xl">{label}</h2>
      {failed
        ? (
            <div role="alert" className="mt-3 space-y-4">
              <p className="text-[var(--owner-muted)]">This screen couldn’t load. Reload the app to try again.</p>
              <button className="min-h-11 rounded-full bg-[var(--owner-accent)] px-5 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2" onClick={() => window.location.reload()} type="button">Reload app</button>
            </div>
          )
        : <p className="mt-3 text-[var(--owner-muted)]" role="status">Opening…</p>}
    </section>
  );
}

class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Keep the existing sheet and its focus/Back lifecycle mounted during download. */
export function DeferredAppModal({ children, label, ...props }: ComponentProps<typeof AppModal> & { label: string }) {
  return (
    <AppModal ariaLabel={label} {...props}>
      <LoadBoundary fallback={<LoadingContent label={label} onClose={props.onClose} failed />}>
        <Suspense fallback={<LoadingContent label={label} onClose={props.onClose} />}>{children}</Suspense>
      </LoadBoundary>
    </AppModal>
  );
}

/**
 * Dialogs owning their own shell need a temporary shell while downloading.
 * Once first opened, keep the child mounted even while closed: its existing
 * reset/draft rules must keep running, including an in-flight assistant reply.
 */
export function DeferredAdminDialog({ children, label, onClose, isOpen }: ContentProps & { isOpen: boolean }) {
  const [hasOpened, setHasOpened] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setHasOpened(true);
    }
  }, [isOpen]);

  if (!isOpen && !hasOpened) {
    return null;
  }
  const fallback = (failed: boolean) => (
    <DialogShell isOpen={isOpen} onClose={onClose} contentClassName="overflow-hidden rounded-3xl bg-[var(--owner-surface)] shadow-xl">
      <div role="dialog" aria-modal="true" aria-label={label}>
        <LoadingContent label={label} onClose={onClose} failed={failed} />
      </div>
    </DialogShell>
  );
  return (
    <LoadBoundary fallback={fallback(true)}>
      <Suspense fallback={fallback(false)}>{children}</Suspense>
    </LoadBoundary>
  );
}
