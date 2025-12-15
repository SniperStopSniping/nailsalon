'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Send, Trash2, UserCheck } from 'lucide-react';
import { useState } from 'react';

import type { SkillLevel, StaffRole } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

type TechnicianDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  skillLevel: string | null;
  languages: string[] | null;
  commissionRate: number;
  acceptingNewClients: boolean;
  notes: string | null;
  isActive: boolean;
  hiredAt: string | null;
  terminatedAt: string | null;
  onboardingStatus: string | null;
  userId: string | null;
};

// Format phone number for display
function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

type SettingsTabProps = {
  technician: TechnicianDetail;
  onUpdate: (updates: Partial<TechnicianDetail>) => void;
  onDelete: () => void;
};

// =============================================================================
// Constants
// =============================================================================

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'tech', label: 'Technician' },
  { value: 'junior', label: 'Junior Tech' },
  { value: 'senior', label: 'Senior Tech' },
  { value: 'admin', label: 'Admin' },
  { value: 'front_desk', label: 'Front Desk' },
];

const SKILL_OPTIONS: { value: SkillLevel; label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'standard', label: 'Standard' },
  { value: 'senior', label: 'Senior' },
  { value: 'master', label: 'Master' },
];

// =============================================================================
// Component
// =============================================================================

export function SettingsTab({ technician, onUpdate, onDelete }: SettingsTabProps) {
  const { salonSlug } = useSalon();
  const [role, setRole] = useState<StaffRole>((technician.role as StaffRole) ?? 'tech');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>((technician.skillLevel as SkillLevel) ?? 'standard');
  const [commissionRate, setCommissionRate] = useState(String(Math.round(technician.commissionRate * 100)));
  const [acceptingNewClients, setAcceptingNewClients] = useState(technician.acceptingNewClients);
  const [notes, setNotes] = useState(technician.notes ?? '');
  const [userId, setUserId] = useState(technician.userId ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReenableModal, setShowReenableModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [reenabling, setReenabling] = useState(false);

  // Resend invite state
  const [resendingInvite, setResendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteCooldown, setInviteCooldown] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!salonSlug) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/technicians/${technician.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          role,
          skillLevel,
          commissionRate: Number.parseFloat(commissionRate) / 100,
          acceptingNewClients,
          notes: notes.trim() || null,
          userId: userId.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      onUpdate({
        role,
        skillLevel,
        commissionRate: Number.parseFloat(commissionRate) / 100,
        acceptingNewClients,
        notes: notes.trim() || null,
        userId: userId.trim() || null,
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Error saving settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    if (!salonSlug) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/technicians/${technician.id}?salonSlug=${salonSlug}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        throw new Error('Failed to disable staff member');
      }

      setShowDisableModal(false);
      onDelete();
    } catch (err) {
      console.error('Error disabling staff:', err);
    }
  };

  const handlePermanentDelete = async () => {
    if (!salonSlug || deleteConfirmText !== 'DELETE') {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/technicians/${technician.id}?salonSlug=${salonSlug}&hard=true`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        throw new Error('Failed to permanently delete staff member');
      }

      setShowDeleteModal(false);
      setDeleteConfirmText('');
      onDelete();
    } catch (err) {
      console.error('Error deleting staff:', err);
    }
  };

  const handleReenable = async () => {
    if (!salonSlug) {
      return;
    }

    setReenabling(true);
    try {
      const response = await fetch(`/api/admin/technicians/${technician.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          isActive: true,
          currentStatus: 'available',
          onboardingStatus: 'active',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to re-enable staff member');
      }

      onUpdate({
        isActive: true,
        terminatedAt: null,
        onboardingStatus: 'active',
      });
      setShowReenableModal(false);
    } catch (err) {
      console.error('Error re-enabling staff:', err);
    } finally {
      setReenabling(false);
    }
  };

  const handleResendInvite = async () => {
    if (!salonSlug || !technician.phone || inviteCooldown) {
      return;
    }

    setResendingInvite(true);
    setInviteError(null);
    try {
      const response = await fetch(`/api/admin/technicians/${technician.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? 'Failed to send invite');
      }

      // Show success state
      setInviteSent(true);
      setInviteCooldown(true);

      // Reset success message after 3 seconds
      setTimeout(() => setInviteSent(false), 3000);

      // Cooldown for 10 seconds to prevent spam
      setTimeout(() => setInviteCooldown(false), 10000);
    } catch (err) {
      console.error('Error resending invite:', err);
      setInviteError(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setResendingInvite(false);
    }
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) {
      return 'Unknown';
    }
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-4 p-4 pb-24">
      {/* Role */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Role
        </h3>
        <div className="rounded-[12px] bg-white p-4">
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRole(option.value)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  role === option.value
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-[#E5E5EA] text-[#1C1C1E]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Skill Level */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Skill Level
        </h3>
        <div className="rounded-[12px] bg-white p-4">
          <div className="flex flex-wrap gap-2">
            {SKILL_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSkillLevel(option.value)}
                className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  skillLevel === option.value
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-[#E5E5EA] text-[#1C1C1E]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Commission */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Commission Rate
        </h3>
        <div className="rounded-[12px] bg-white p-4">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="100"
              value={commissionRate}
              onChange={e => setCommissionRate(e.target.value)}
              className="flex-1 accent-[#007AFF]"
              aria-label="Commission rate percentage"
            />
            <span className="min-w-[50px] text-right text-[17px] font-semibold text-[#1C1C1E]">
              {commissionRate}
              %
            </span>
          </div>
        </div>
      </div>

      {/* Accept New Clients */}
      <div className="overflow-hidden rounded-[12px] bg-white">
        <div className="flex items-center justify-between p-4">
          <div>
            <span className="text-[17px] text-[#1C1C1E]">Accept New Clients</span>
            <p className="text-[13px] text-[#8E8E93]">
              When off, only returning clients can book
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAcceptingNewClients(!acceptingNewClients)}
            aria-label={acceptingNewClients ? 'Disable accepting new clients' : 'Enable accepting new clients'}
            className={`h-[31px] w-[51px] rounded-full p-[2px] transition-colors ${
              acceptingNewClients ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'
            }`}
          >
            <motion.div
              className="size-[27px] rounded-full bg-white shadow-sm"
              animate={{ x: acceptingNewClients ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>
      </div>

      {/* Clerk Account Link */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Tech Dashboard Login
        </h3>
        <div className="rounded-[12px] bg-white p-4">
          <label htmlFor="settings-clerk-userid" className="mb-1 block text-[13px] text-[#8E8E93]">Clerk User ID</label>
          <input
            id="settings-clerk-userid"
            type="text"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="user_2abc123..."
            className="w-full rounded-lg bg-[#F2F2F7] px-3 py-2 text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
          />
          <p className="mt-2 text-[12px] text-[#8E8E93]">
            Paste the tech&apos;s Clerk User ID here to let them access the Tech Dashboard.
            Find it in your Clerk dashboard under Users → click user → copy User ID.
          </p>
          {userId && (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="size-2 rounded-full bg-[#34C759]" />
              <span className="text-[12px] font-medium text-[#34C759]">Account linked</span>
            </div>
          )}
        </div>
      </div>

      {/* Account & Invitations */}
      {technician.phone && (
        <div>
          <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
            Account & Invitations
          </h3>
          <div className="overflow-hidden rounded-[12px] bg-white">
            <div className="border-b border-gray-100 p-4">
              <span className="text-[13px] text-[#8E8E93]">Phone Number</span>
              <div className="text-[17px] text-[#1C1C1E]">
                {formatPhoneDisplay(technician.phone)}
              </div>
            </div>
            <div className="p-4">
              <p className="mb-3 text-[13px] text-[#8E8E93]">
                Send an SMS invite so this staff member can access their dashboard.
              </p>
              {inviteError && (
                <p className="mb-3 text-[13px] text-[#FF3B30]">{inviteError}</p>
              )}
              <button
                type="button"
                onClick={handleResendInvite}
                disabled={resendingInvite || inviteCooldown}
                className={`
                  flex w-full items-center justify-center gap-2
                  rounded-xl py-3 text-[15px] font-medium
                  transition-colors
                  ${inviteSent
          ? 'bg-[#34C759] text-white'
          : inviteCooldown
            ? 'bg-[#E5E5EA] text-[#8E8E93]'
            : 'bg-[#007AFF]/10 text-[#007AFF]'
        }
                  disabled:opacity-50
                `}
              >
                {inviteSent
                  ? (
                      <>
                        <Check className="size-4" />
                        Invite Sent
                      </>
                    )
                  : resendingInvite
                    ? (
                        'Sending...'
                      )
                    : inviteCooldown
                      ? (
                          'Please wait...'
                        )
                      : (
                          <>
                            <Send className="size-4" />
                            Send Invite SMS
                          </>
                        )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Internal Notes
        </h3>
        <div className="rounded-[12px] bg-white p-4">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Private notes about this staff member..."
            rows={4}
            className="w-full resize-none bg-white text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
          />
        </div>
      </div>

      {/* Employment Info */}
      <div>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#8E8E93]">
          Employment
        </h3>
        <div className="overflow-hidden rounded-[12px] bg-white">
          <div className="border-b border-gray-100 p-4">
            <span className="text-[13px] text-[#8E8E93]">Hired</span>
            <div className="text-[17px] text-[#1C1C1E]">
              {formatDate(technician.hiredAt)}
            </div>
          </div>
          {technician.terminatedAt && (
            <div className="border-b border-gray-100 p-4">
              <span className="text-[13px] text-[#8E8E93]">Disabled</span>
              <div className="text-[17px] text-[#FF3B30]">
                {formatDate(technician.terminatedAt)}
              </div>
            </div>
          )}
          <div className="p-4">
            <span className="text-[13px] text-[#8E8E93]">Status</span>
            <div className={`text-[17px] capitalize ${technician.isActive ? 'text-[#1C1C1E]' : 'text-[#FF3B30]'}`}>
              {technician.isActive ? (technician.onboardingStatus ?? 'Active') : 'Inactive'}
            </div>
          </div>
        </div>
      </div>

      {/* Re-enable Section (only for inactive staff) */}
      {!technician.isActive && (
        <div>
          <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#34C759]">
            Restore Staff Member
          </h3>
          <button
            type="button"
            onClick={() => setShowReenableModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#34C759] py-3 text-[17px] font-medium text-white"
          >
            <UserCheck className="size-5" />
            Re-enable Staff Member
          </button>
        </div>
      )}

      {/* Save Button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className={`
          flex w-full items-center justify-center gap-2
          rounded-xl py-3 text-[17px] font-semibold
          ${saved ? 'bg-[#34C759] text-white' : 'bg-[#007AFF] text-white'}
          disabled:opacity-50
        `}
      >
        {saved
          ? (
              <>
                <Check className="size-5" />
                Saved
              </>
            )
          : saving
            ? (
                'Saving...'
              )
            : (
                'Save Changes'
              )}
      </button>

      {/* Danger Zone */}
      <div className="pt-4">
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase text-[#FF3B30]">
          Danger Zone
        </h3>
        <div className="space-y-3">
          {technician.isActive && (
            <button
              type="button"
              onClick={() => setShowDisableModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#FF9500] bg-white py-3 text-[17px] font-medium text-[#FF9500]"
            >
              <Trash2 className="size-5" />
              Disable Staff Member
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#FF3B30] bg-white py-3 text-[17px] font-medium text-[#FF3B30]"
          >
            <Trash2 className="size-5" />
            Permanently Remove
          </button>
        </div>
      </div>

      {/* Disable Confirmation Modal */}
      <AnimatePresence>
        {showDisableModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowDisableModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-[20px] bg-white p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-4 flex justify-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-[#FF9500]/10">
                  <AlertTriangle className="size-8 text-[#FF9500]" />
                </div>
              </div>
              <h3 className="mb-2 text-center text-[20px] font-bold text-[#1C1C1E]">
                Disable Staff Member?
              </h3>
              <p className="mb-6 text-center text-[15px] text-[#8E8E93]">
                {technician.name}
                {' '}
                will be hidden from booking. Their data and history will be preserved. You can re-enable them anytime.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDisableModal(false)}
                  className="flex-1 rounded-xl bg-[#E5E5EA] py-3 text-[17px] font-medium text-[#1C1C1E]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisable}
                  className="flex-1 rounded-xl bg-[#FF9500] py-3 text-[17px] font-medium text-white"
                >
                  Disable
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Permanent Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => {
              setShowDeleteModal(false);
              setDeleteConfirmText('');
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-[20px] bg-white p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-4 flex justify-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-[#FF3B30]/10">
                  <AlertTriangle className="size-8 text-[#FF3B30]" />
                </div>
              </div>
              <h3 className="mb-2 text-center text-[20px] font-bold text-[#1C1C1E]">
                Permanently Remove?
              </h3>
              <p className="mb-4 text-center text-[15px] text-[#8E8E93]">
                This will permanently delete
                {' '}
                {technician.name}
                {' '}
                and all their data. This action cannot be undone.
              </p>
              <p className="mb-3 text-center text-[13px] font-medium text-[#FF3B30]">
                Type DELETE to confirm
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value.toUpperCase())}
                placeholder="DELETE"
                className="mb-4 w-full rounded-xl bg-[#F2F2F7] px-4 py-3 text-center text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none focus:ring-2 focus:ring-[#FF3B30]/30"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmText('');
                  }}
                  className="flex-1 rounded-xl bg-[#E5E5EA] py-3 text-[17px] font-medium text-[#1C1C1E]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePermanentDelete}
                  disabled={deleteConfirmText !== 'DELETE'}
                  className="flex-1 rounded-xl bg-[#FF3B30] py-3 text-[17px] font-medium text-white disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Re-enable Confirmation Modal */}
      <AnimatePresence>
        {showReenableModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowReenableModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-[20px] bg-white p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-4 flex justify-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-[#34C759]/10">
                  <UserCheck className="size-8 text-[#34C759]" />
                </div>
              </div>
              <h3 className="mb-2 text-center text-[20px] font-bold text-[#1C1C1E]">
                Re-enable Staff Member?
              </h3>
              <p className="mb-6 text-center text-[15px] text-[#8E8E93]">
                {technician.name}
                {' '}
                will be visible in booking again and can start accepting appointments immediately.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowReenableModal(false)}
                  className="flex-1 rounded-xl bg-[#E5E5EA] py-3 text-[17px] font-medium text-[#1C1C1E]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReenable}
                  disabled={reenabling}
                  className="flex-1 rounded-xl bg-[#34C759] py-3 text-[17px] font-medium text-white disabled:opacity-50"
                >
                  {reenabling ? 'Enabling...' : 'Re-enable'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
