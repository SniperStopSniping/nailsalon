'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import { loadDeviceSetups, switchDeviceSetup } from './device-setups';

export function DeviceSetupRecovery({ beforeSwitch, email, onSwitch, previous = false }: {
  beforeSwitch?: () => boolean;
  email?: string;
  onSwitch: () => void;
  previous?: boolean;
}) {
  const [choice, setChoice] = useState<{ restoreId?: string } | null>(null);
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
    <div className={previous ? 'onboarding-kept-setups owner-theme-scope' : undefined}>
      {previous
        ? (
            <details>
              <summary>{`Previous setups on this device (${kept.length})`}</summary>
              <p>Opening a previous setup also keeps your current one. Saved websites still require their original account.</p>
              {kept.map((setup, index) => (
                <button className="onboarding-integration-secondary" key={setup.id} type="button" onClick={() => setChoice({ restoreId: setup.id })}>
                  {`Open setup ${index + 1} · ${new Date(setup.keptAt).toLocaleDateString()}`}
                </button>
              ))}
            </details>
          )
        : (
            <button className="onboarding-integration-secondary" type="button" onClick={() => setChoice({})}>
              Build a separate website
            </button>
          )}
      {error && <p role="alert">{error}</p>}
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
