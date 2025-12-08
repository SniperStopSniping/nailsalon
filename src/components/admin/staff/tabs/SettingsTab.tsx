'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Trash2, Check, UserCheck } from 'lucide-react';

import { useSalon } from '@/providers/SalonProvider';
import type { StaffRole, SkillLevel } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

interface TechnicianDetail {
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
}

interface SettingsTabProps {
  technician: TechnicianDetail;
  onUpdate: (updates: Partial<TechnicianDetail>) => void;
  onDelete: () => void;
}

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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReenableModal, setShowReenableModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [reenabling, setReenabling] = useState(false);

  const handleSave = async () => {
    if (!salonSlug) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/technicians/${technician.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          role,
          skillLevel,
          commissionRate: parseFloat(commissionRate) / 100,
          acceptingNewClients,
          notes: notes.trim() || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      onUpdate({
        role,
        skillLevel,
        commissionRate: parseFloat(commissionRate) / 100,
        acceptingNewClients,
        notes: notes.trim() || null,
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
    if (!salonSlug) return;

    try {
      const response = await fetch(
        `/api/admin/technicians/${technician.id}?salonSlug=${salonSlug}`,
        { method: 'DELETE' }
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
    if (!salonSlug || deleteConfirmText !== 'DELETE') return;

    try {
      const response = await fetch(
        `/api/admin/technicians/${technician.id}?salonSlug=${salonSlug}&hard=true`,
        { method: 'DELETE' }
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
    if (!salonSlug) return;

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

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Role */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Role
        </h3>
        <div className="bg-white rounded-[12px] p-4">
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRole(option.value)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
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
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Skill Level
        </h3>
        <div className="bg-white rounded-[12px] p-4">
          <div className="flex flex-wrap gap-2">
            {SKILL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSkillLevel(option.value)}
                className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
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
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Commission Rate
        </h3>
        <div className="bg-white rounded-[12px] p-4">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="100"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="flex-1 accent-[#007AFF]"
              aria-label="Commission rate percentage"
            />
            <span className="text-[17px] font-semibold text-[#1C1C1E] min-w-[50px] text-right">
              {commissionRate}%
            </span>
          </div>
        </div>
      </div>

      {/* Accept New Clients */}
      <div className="bg-white rounded-[12px] overflow-hidden">
        <div className="p-4 flex items-center justify-between">
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
            className={`w-[51px] h-[31px] rounded-full p-[2px] transition-colors ${
              acceptingNewClients ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'
            }`}
          >
            <motion.div
              className="w-[27px] h-[27px] bg-white rounded-full shadow-sm"
              animate={{ x: acceptingNewClients ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Internal Notes
        </h3>
        <div className="bg-white rounded-[12px] p-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Private notes about this staff member..."
            rows={4}
            className="w-full text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none resize-none"
          />
        </div>
      </div>

      {/* Employment Info */}
      <div>
        <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1">
          Employment
        </h3>
        <div className="bg-white rounded-[12px] overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <span className="text-[13px] text-[#8E8E93]">Hired</span>
            <div className="text-[17px] text-[#1C1C1E]">
              {formatDate(technician.hiredAt)}
            </div>
          </div>
          {technician.terminatedAt && (
            <div className="p-4 border-b border-gray-100">
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
          <h3 className="text-[13px] font-semibold text-[#34C759] uppercase mb-2 px-1">
            Restore Staff Member
          </h3>
          <button
            type="button"
            onClick={() => setShowReenableModal(true)}
            className="w-full py-3 bg-[#34C759] text-white rounded-xl text-[17px] font-medium flex items-center justify-center gap-2"
          >
            <UserCheck className="w-5 h-5" />
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
          w-full py-3 rounded-xl text-[17px] font-semibold
          flex items-center justify-center gap-2
          ${saved ? 'bg-[#34C759] text-white' : 'bg-[#007AFF] text-white'}
          disabled:opacity-50
        `}
      >
        {saved ? (
          <>
            <Check className="w-5 h-5" />
            Saved
          </>
        ) : saving ? (
          'Saving...'
        ) : (
          'Save Changes'
        )}
      </button>

      {/* Danger Zone */}
      <div className="pt-4">
        <h3 className="text-[13px] font-semibold text-[#FF3B30] uppercase mb-2 px-1">
          Danger Zone
        </h3>
        <div className="space-y-3">
          {technician.isActive && (
            <button
              type="button"
              onClick={() => setShowDisableModal(true)}
              className="w-full py-3 bg-white border border-[#FF9500] text-[#FF9500] rounded-xl text-[17px] font-medium flex items-center justify-center gap-2"
            >
              <Trash2 className="w-5 h-5" />
              Disable Staff Member
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 bg-white border border-[#FF3B30] text-[#FF3B30] rounded-xl text-[17px] font-medium flex items-center justify-center gap-2"
          >
            <Trash2 className="w-5 h-5" />
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
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowDisableModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[20px] p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-[#FF9500]/10 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-[#FF9500]" />
                </div>
              </div>
              <h3 className="text-[20px] font-bold text-[#1C1C1E] text-center mb-2">
                Disable Staff Member?
              </h3>
              <p className="text-[15px] text-[#8E8E93] text-center mb-6">
                {technician.name} will be hidden from booking. Their data and history will be preserved. You can re-enable them anytime.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDisableModal(false)}
                  className="flex-1 py-3 bg-[#E5E5EA] text-[#1C1C1E] rounded-xl text-[17px] font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisable}
                  className="flex-1 py-3 bg-[#FF9500] text-white rounded-xl text-[17px] font-medium"
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
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => {
              setShowDeleteModal(false);
              setDeleteConfirmText('');
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[20px] p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-[#FF3B30]/10 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-[#FF3B30]" />
                </div>
              </div>
              <h3 className="text-[20px] font-bold text-[#1C1C1E] text-center mb-2">
                Permanently Remove?
              </h3>
              <p className="text-[15px] text-[#8E8E93] text-center mb-4">
                This will permanently delete {technician.name} and all their data. This action cannot be undone.
              </p>
              <p className="text-[13px] text-[#FF3B30] text-center mb-3 font-medium">
                Type DELETE to confirm
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
                placeholder="DELETE"
                className="w-full py-3 px-4 bg-[#F2F2F7] rounded-xl text-[17px] text-center text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none focus:ring-2 focus:ring-[#FF3B30]/30 mb-4"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmText('');
                  }}
                  className="flex-1 py-3 bg-[#E5E5EA] text-[#1C1C1E] rounded-xl text-[17px] font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePermanentDelete}
                  disabled={deleteConfirmText !== 'DELETE'}
                  className="flex-1 py-3 bg-[#FF3B30] text-white rounded-xl text-[17px] font-medium disabled:opacity-50"
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
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowReenableModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[20px] p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-[#34C759]/10 flex items-center justify-center">
                  <UserCheck className="w-8 h-8 text-[#34C759]" />
                </div>
              </div>
              <h3 className="text-[20px] font-bold text-[#1C1C1E] text-center mb-2">
                Re-enable Staff Member?
              </h3>
              <p className="text-[15px] text-[#8E8E93] text-center mb-6">
                {technician.name} will be visible in booking again and can start accepting appointments immediately.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowReenableModal(false)}
                  className="flex-1 py-3 bg-[#E5E5EA] text-[#1C1C1E] rounded-xl text-[17px] font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReenable}
                  disabled={reenabling}
                  className="flex-1 py-3 bg-[#34C759] text-white rounded-xl text-[17px] font-medium disabled:opacity-50"
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
