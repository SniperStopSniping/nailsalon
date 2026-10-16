'use client';

import { useState } from 'react';

export function NoShowReviewRequest({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'requested' | 'closed' | 'error'>('idle');
  async function submit() {
    setState('working');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/public/appointments/manage/${encodeURIComponent(token)}/no-show-review`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      setState(response.ok ? 'requested' : response.status === 409 ? 'closed' : 'error');
    } catch {
      setState('error');
    } finally {
      clearTimeout(timeout);
    }
  }
  if (state === 'closed') {
    return <p role="status">This review is already complete. Contact Luster support to request another review. Existing payment decisions require a separate review.</p>;
  }
  if (state === 'requested') {
    return <p role="status">Review requested. Any eligible shared contribution from this appointment is suspended during review. Existing deposits and payments require a separate review.</p>;
  }
  return (
    <div className="space-y-3 rounded-xl border border-stone-200 p-4 text-sm text-stone-800">
      <p>This appointment was marked as a no-show.</p>
      {!open
        ? <button type="button" className="min-h-11 underline" onClick={() => setOpen(true)}>Request review of this no-show</button>
        : (
            <div className="space-y-2">
              <label className="block">
                Explain what should be reviewed (10–500 characters)
                <textarea value={reason} maxLength={500} rows={3} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-lg border border-stone-300 p-3" />
              </label>
              <p>Your explanation is available only to this salon and authorized Luster reviewers. Other salons cannot see it or identify the reporting salon.</p>
              <button type="button" onClick={() => void submit()} disabled={state === 'working' || reason.trim().length < 10} className="min-h-11 rounded-lg bg-stone-900 px-4 py-2 text-white disabled:opacity-50">{state === 'working' ? 'Requesting…' : 'Request review'}</button>
              {state === 'error' && <p role="alert">We could not confirm your request. Try again; a retry will not create a duplicate.</p>}
            </div>
          )}
    </div>
  );
}
