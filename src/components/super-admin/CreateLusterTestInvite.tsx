'use client';

import { Copy, ExternalLink, RefreshCw, UserPlus } from 'lucide-react';
import { useState } from 'react';

type CreatedInvite = {
  id: string;
  email: string;
  expiresAt: string;
  joinUrl: string;
  emailDeliveryStatus: 'sent' | 'failed';
  emailDeliveryErrorCode: string | null;
};

export function CreateLusterTestInvite({ testTool = false }: { testTool?: boolean }) {
  const [email, setEmail] = useState('');
  const [campaignSource, setCampaignSource] = useState(testTool ? 'pilot-test' : 'pilot');
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/super-admin/signup-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, campaignSource, ...(testTool ? { testTool: true } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? body?.error ?? 'Unable to create invitation');
      }
      setInvite(body.data);
      setMessage(body.data.emailDeliveryStatus === 'sent'
        ? 'Invitation emailed successfully.'
        : 'Invitation created, but email delivery failed. Copy the link or retry after email is configured.');
    } catch (inviteError) {
      setInvite(null);
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to create invitation');
    } finally {
      setLoading(false);
    }
  };

  const resendInvite = async () => {
    if (!invite) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/super-admin/signup-invites/${invite.id}/resend`, { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? 'Unable to resend invitation');
      }
      setInvite(body.data);
      setMessage(body.data.emailDeliveryStatus === 'sent'
        ? 'Invitation emailed successfully. The previous link is no longer valid.'
        : 'Email delivery failed again. The new invitation link can still be copied.');
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to resend invitation');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!invite) {
      return;
    }
    try {
      await navigator.clipboard.writeText(invite.joinUrl);
      setMessage('Invitation link copied.');
    } catch {
      setError('Could not copy the invitation link.');
    }
  };

  return (
    <section id="luster-invite" className="mx-auto mt-5 max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="luster-invite-title">
      <div className="rounded-xl border border-purple-200 bg-purple-50 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <UserPlus className="size-5 text-purple-700" />
          <h2 id="luster-invite-title" className="font-semibold text-purple-950">
            {testTool ? 'Create Luster Test Invite' : 'Invite a Nail Tech to Luster'}
          </h2>
        </div>
        <form onSubmit={createInvite} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-medium text-purple-950">
            Nail tech email
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-gray-900"
              placeholder="test@example.com"
              required
            />
          </label>
          <label className="text-sm font-medium text-purple-950">
            Campaign source
            <input
              type="text"
              value={campaignSource}
              onChange={event => setCampaignSource(event.target.value)}
              className="mt-1 w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-gray-900"
              maxLength={100}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="self-end rounded-lg bg-purple-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create invitation'}
          </button>
        </form>

        {invite && (
          <div className="mt-4 rounded-lg border border-purple-200 bg-white p-4 text-sm">
            <div className="grid gap-1 text-gray-700 sm:grid-cols-2">
              <p>
                <span className="font-medium">Status:</span>
                {' '}
                Active
              </p>
              <p>
                <span className="font-medium">Email:</span>
                {' '}
                {invite.emailDeliveryStatus === 'sent' ? 'Sent' : 'Delivery failed'}
              </p>
              <p>
                <span className="font-medium">Expires:</span>
                {' '}
                {new Date(invite.expiresAt).toLocaleString()}
              </p>
            </div>
            <p className="mt-2 break-all text-xs text-gray-500" data-testid="test-invite-url">{invite.joinUrl}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={copyLink} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 px-3 py-2 text-purple-800">
                <Copy className="size-4" />
                Copy invitation link
              </button>
              <button type="button" onClick={() => window.open(invite.joinUrl, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 px-3 py-2 text-purple-800">
                <ExternalLink className="size-4" />
                Open invitation link
              </button>
              <button type="button" disabled={loading} onClick={resendInvite} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 px-3 py-2 text-purple-800 disabled:opacity-50">
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                Retry email and rotate link
              </button>
            </div>
          </div>
        )}
        {message && <p className="mt-3 text-sm text-green-700" role="status">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      </div>
    </section>
  );
}
