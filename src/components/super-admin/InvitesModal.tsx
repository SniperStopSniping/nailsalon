'use client';

/**
 * Invites Modal for Super Admin
 *
 * Allows creating and viewing admin invites.
 */

import { Check, Clock, RefreshCw, Send, UserPlus, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type Invite = {
  id: string;
  phoneE164: string;
  salonId: string | null;
  salonName: string | null;
  salonSlug: string | null;
  role: 'ADMIN' | 'SUPER_ADMIN';
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  status: 'pending' | 'expired' | 'used';
};

type Salon = {
  id: string;
  name: string;
  slug: string;
};

type Props = {
  onClose: () => void;
};

// =============================================================================
// Invite Row Component
// =============================================================================

type InviteRowProps = {
  invite: Invite;
  onResend: () => void;
  formatPhone: (phone: string) => string;
  getStatusBadge: (status: string) => React.ReactNode;
};

function InviteRow({ invite, onResend, formatPhone, getStatusBadge }: InviteRowProps) {
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);

  const handleResend = async () => {
    setResending(true);
    setResendError(null);
    setResendSuccess(false);

    try {
      const response = await fetch(`/api/super-admin/invites/${invite.id}/resend`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to resend invite');
      }

      setResendSuccess(true);
      onResend(); // Refresh the list

      // Hide success after 2 seconds
      setTimeout(() => setResendSuccess(false), 2000);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Failed to resend invite');
    } finally {
      setResending(false);
    }
  };

  const canResend = invite.status !== 'used';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="font-medium text-gray-900">
            {formatPhone(invite.phoneE164)}
          </div>
          <div className="mt-0.5 text-sm text-gray-500">
            {invite.role === 'SUPER_ADMIN'
              ? (
                  <span className="font-medium text-purple-600">Super Admin</span>
                )
              : (
                  <>
                    Admin for
                    {' '}
                    <span className="font-medium">{invite.salonName || invite.salonSlug}</span>
                  </>
                )}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            Created
            {' '}
            {new Date(invite.createdAt).toLocaleDateString()}
            {invite.status === 'pending' && (
              <>
                {' '}
                · Expires
                {new Date(invite.expiresAt).toLocaleDateString()}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canResend && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50"
              title="Resend invite SMS"
            >
              <RefreshCw className={`size-3 ${resending ? 'animate-spin' : ''}`} />
              {resending ? 'Sending...' : resendSuccess ? 'Sent!' : 'Resend'}
            </button>
          )}
          {getStatusBadge(invite.status)}
        </div>
      </div>
      {resendError && (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
          {resendError}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function InvitesModal({ onClose }: Props) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [salons, setSalons] = useState<Salon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'SUPER_ADMIN'>('ADMIN');
  const [membershipRole, setMembershipRole] = useState<'admin' | 'owner'>('admin');
  const [salonSlug, setSalonSlug] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);

  // Fetch invites
  const fetchInvites = useCallback(async () => {
    try {
      const response = await fetch('/api/super-admin/invites');
      if (!response.ok) {
        throw new Error('Failed to fetch invites');
      }
      const data = await response.json();
      setInvites(data.invites || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch invites');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch salons for dropdown
  const fetchSalons = useCallback(async () => {
    try {
      const response = await fetch('/api/super-admin/organizations?pageSize=100');
      if (!response.ok) {
        throw new Error('Failed to fetch salons');
      }
      const data = await response.json();
      setSalons(data.items || []);
    } catch {
      // Ignore - salons dropdown just won't work
    }
  }, []);

  useEffect(() => {
    fetchInvites();
    fetchSalons();
  }, [fetchInvites, fetchSalons]);

  // Format phone for display
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  // Handle create invite
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(false);

    try {
      const response = await fetch('/api/super-admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          role,
          salonSlug: role === 'ADMIN' ? salonSlug : undefined,
          membershipRole: role === 'ADMIN' ? membershipRole : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create invite');
      }

      setCreateSuccess(true);
      setPhone('');
      setSalonSlug('');
      setRole('ADMIN');
      setMembershipRole('admin');
      fetchInvites();

      // Hide success after 3 seconds
      setTimeout(() => {
        setCreateSuccess(false);
        setShowCreateForm(false);
      }, 2000);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
            <Clock className="size-3" />
            Pending
          </span>
        );
      case 'used':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            <Check className="size-3" />
            Used
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            <XCircle className="size-3" />
            Expired
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
                <UserPlus className="size-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Admin Invites</h2>
                <p className="text-sm text-gray-500">Invite admins to manage salons</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:bg-gray-100"
            >
              <X className="size-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[60vh] overflow-y-auto p-6">
            {/* Create Button / Form */}
            {!showCreateForm ? (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                <UserPlus className="size-5" />
                Create New Invite
              </button>
            ) : (
              <form onSubmit={handleCreate} className="mb-6 rounded-xl bg-gray-50 p-4">
                <h3 className="mb-4 font-medium text-gray-900">New Invite</h3>

                {/* Phone */}
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="(416) 555-1234"
                    required
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Role */}
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Role
                  </label>
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value as 'ADMIN' | 'SUPER_ADMIN')}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="ADMIN">Admin (Salon)</option>
                    <option value="SUPER_ADMIN">Super Admin</option>
                  </select>
                </div>

                {/* Salon (for ADMIN role) */}
                {role === 'ADMIN' && (
                  <>
                    <div className="mb-4">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Salon
                      </label>
                      <select
                        value={salonSlug}
                        onChange={e => setSalonSlug(e.target.value)}
                        required={role === 'ADMIN'}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Select a salon...</option>
                        {salons.map(salon => (
                          <option key={salon.id} value={salon.slug}>
                            {salon.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Access Level
                      </label>
                      <select
                        value={membershipRole}
                        onChange={e => setMembershipRole(e.target.value as 'admin' | 'owner')}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="admin">Admin (can manage salon)</option>
                        <option value="owner">Owner (full control)</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Owner has full control and is shown as the primary contact.
                      </p>
                    </div>
                  </>
                )}

                {/* Error */}
                {createError && (
                  <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {createError}
                  </div>
                )}

                {/* Success */}
                {createSuccess && (
                  <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                    <Check className="size-4" />
                    Invite sent successfully!
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setCreateError(null);
                    }}
                    className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {creating
                      ? (
                          'Sending...'
                        )
                      : (
                          <>
                            <Send className="size-4" />
                            Send Invite
                          </>
                        )}
                  </button>
                </div>
              </form>
            )}

            {/* Invites List */}
            {loading
              ? (
                  <div className="py-8 text-center text-gray-500">Loading...</div>
                )
              : error
                ? (
                    <div className="py-8 text-center text-red-600">{error}</div>
                  )
                : invites.length === 0
                  ? (
                      <div className="py-8 text-center text-gray-500">
                        No invites yet. Create one above!
                      </div>
                    )
                  : (
                      <div className="space-y-3">
                        {invites.map(invite => (
                          <InviteRow
                            key={invite.id}
                            invite={invite}
                            onResend={fetchInvites}
                            formatPhone={formatPhone}
                            getStatusBadge={getStatusBadge}
                          />
                        ))}
                      </div>
                    )}
          </div>
        </div>
      </div>
    </div>
  );
}
