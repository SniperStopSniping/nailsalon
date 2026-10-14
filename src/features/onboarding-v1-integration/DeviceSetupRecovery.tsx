'use client';

import { useId, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';

import { loadDeviceSetups, switchDeviceSetup } from './device-setups';

export function DeviceSetupRecovery({ beforeSwitch, email, onMenuAction, onSwitch, previous = false }: {
  beforeSwitch?: () => boolean;
  email?: string;
  onMenuAction?: (action: () => void) => void;
  onSwitch: () => void;
  previous?: boolean;
}) {
  const [choice, setChoice] = useState<{ restoreId?: string } | null>(null);
  const [previousOpen, setPreviousOpen] = useState(false);
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [kept] = useState(() => {
    try {
      return loadDeviceSetups();
    } catch {
      return [];
    }
  });
  if (previous && kept.length === 0) {
    return null;
  }
  const confirm = () => {
    if (!choice) {
      return;
    }
    if (beforeSwitch && !beforeSwitch()) {
      setChoice(null);
      setError('Finish any image upload and save your current setup before switching. Your setup is still open.');
      return;
    }
    const result = switchDeviceSetup(choice);
    if (result.success) {
      onSwitch();
    } else {
      setChoice(null);
      setError(result.message);
    }
  };
  return (
    <div className={previous && !onMenuAction ? 'onboarding-kept-setups owner-theme-scope' : undefined} role={onMenuAction ? 'none' : undefined}>
      {previous
        ? (
            <button
              className={onMenuAction ? undefined : 'onboarding-integration-secondary'}
              role={onMenuAction ? 'menuitem' : undefined}
              tabIndex={onMenuAction ? -1 : undefined}
              type="button"
              onClick={() => {
                const open = () => setPreviousOpen(true);
                if (onMenuAction) {
                  onMenuAction(open);
                } else {
                  open();
                }
              }}
            >
              {`Previous setups on this device (${kept.length})`}
            </button>
          )
        : (
            <button className="onboarding-integration-secondary" type="button" onClick={() => setChoice({})}>
              Build a separate website
            </button>
          )}
      {error && !previousOpen && <p role="alert">{error}</p>}
      <DialogShell isOpen={previousOpen && !choice} onClose={() => setPreviousOpen(false)}>
        <div aria-labelledby={titleId} aria-modal="true" className="onboarding-kept-setups-dialog" role="dialog">
          <h2 id={titleId}>Previous setups on this device</h2>
          <p>Opening a previous setup also keeps your current one. Saved websites still require their original account.</p>
          {kept.map((setup, index) => (
            <button className="onboarding-integration-secondary" key={setup.id} type="button" onClick={() => setChoice({ restoreId: setup.id })}>
              {`Open setup ${index + 1} · ${new Date(setup.keptAt).toLocaleDateString()}`}
            </button>
          ))}
          {error && <p role="alert">{error}</p>}
          <button className="onboarding-integration-secondary" type="button" onClick={() => setPreviousOpen(false)}>Close previous setups</button>
        </div>
      </DialogShell>
      <ConfirmDialog
        cancelLabel="Go back"
        confirmLabel={choice?.restoreId ? 'Open previous setup' : 'Start a new website'}
        description={choice?.restoreId
          ? 'Your current setup will be kept on this device before the previous one opens. This does not change any saved website or account access.'
          : (
              <>
                <p>{`Start a blank website${email ? ` for ${email}` : ''}. Your previous setup and uploaded photos will be kept under “Previous setups on this device.”`}</p>
                <p>No saved website will be deleted or moved to another account.</p>
              </>
            )}
        isOpen={choice !== null}
        onClose={() => setChoice(null)}
        onConfirm={confirm}
        title={choice?.restoreId ? 'Open a previous setup?' : 'Start a separate website?'}
      />
    </div>
  );
}
