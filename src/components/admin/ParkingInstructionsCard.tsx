'use client';

import { AlertCircle, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Canonical editor for arrival instructions. The text continues to use the
 * established retention-settings API because customer directions already read
 * it there; only its owner-facing home moves beside the salon address.
 */
export function ParkingInstructionsCard({
  salonSlug,
  onDirtyChange,
}: {
  salonSlug: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [dirty, setDirty] = useState(false);
  const valueRef = useRef(value);
  const savingRef = useRef(saving);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const markDirty = useCallback((next: boolean) => {
    setDirty(next);
    onDirtyChange?.(next);
  }, [onDirtyChange]);

  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setError(null);
    // Never present the previous salon's value while a same-mounted salon
    // transition is resolving.
    setValue('');
    markDirty(false);
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
          { cache: 'no-store' },
        );
        const body = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          throw new Error(body?.error?.message || 'Failed to load parking instructions');
        }
        setValue(body?.data?.settings?.parkingInstructions ?? '');
        setLoadState('ready');
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load parking instructions');
          setLoadState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, markDirty, salonSlug]);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || loadState !== 'ready') {
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/retention/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parkingInstructions: valueRef.current.trim() || null }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message || 'Failed to save parking instructions');
      }
      setValue(body?.data?.settings?.parkingInstructions ?? valueRef.current.trim());
      setSaved(true);
      markDirty(false);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save parking instructions');
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadState, markDirty, salonSlug]);

  return (
    <section className="rounded-3xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 shadow-sm" data-testid="parking-instructions-card">
      <h2 className="text-lg font-semibold text-[var(--owner-ink)]">Parking &amp; arrival</h2>
      <p className="mt-1 text-sm text-[var(--owner-muted)]">Add parking, entrance, buzzer, or arrival instructions beside your salon address. They are used in customer directions and messages.</p>
      {loadState === 'loading'
        ? (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-[var(--owner-accent)] border-t-transparent" />
            </div>
          )
        : loadState === 'error'
          ? (
              <div className="mt-5 space-y-3" role="alert">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error ?? 'Failed to load parking instructions'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLoadAttempt(current => current + 1)}
                  className="min-h-11 rounded-[10px] border border-[var(--owner-line-strong)] px-4 text-sm font-semibold text-[var(--owner-ink)]"
                >
                  Retry
                </button>
              </div>
            )
          : (
              <div className="mt-5 space-y-3">
                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <label htmlFor="settings-parking-instructions" className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">Parking &amp; entry instructions</span>
                  <textarea
                    id="settings-parking-instructions"
                    value={value}
                    onChange={(event) => {
                      setValue(event.target.value);
                      setSaved(false);
                      markDirty(true);
                    }}
                    rows={3}
                    maxLength={2000}
                    className="mt-2 w-full resize-y rounded-[10px] border border-[var(--owner-line)] p-3 text-[15px] leading-relaxed text-[var(--owner-ink)] outline-none transition-colors focus:border-[var(--owner-focus,#b85075)]"
                    placeholder="Free parking behind the salon. Enter from Queen Street."
                  />
                </label>
                <div className="flex items-center justify-end gap-3">
                  {saved && !error && <span className="text-xs font-medium text-green-600">Parking instructions saved.</span>}
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || !dirty}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--owner-accent)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="size-4" />
                    <span>{saving ? 'Saving...' : 'Save parking info'}</span>
                  </button>
                </div>
              </div>
            )}
    </section>
  );
}
