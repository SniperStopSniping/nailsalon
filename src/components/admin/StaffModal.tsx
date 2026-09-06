'use client';

/**
 * StaffModal Component
 *
 * iOS-style staff management modal.
 * Features:
 * - Staff list with search and filters
 * - Add/edit/delete staff members
 * - Real-time status toggle
 * - Tabbed detail view (overview, schedule, services, clients, earnings, settings)
 * - Performance stats and earnings analytics
 */

import { AnimatePresence } from 'framer-motion';
import { useCallback, useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';
import {
  AddStaffModal,
  type StaffCardData,
  StaffDetailPage,
  StaffListView,
} from './staff';

type StaffModalProps = {
  onClose: () => void;
  salonSlug: string | null;
};

export function StaffModal({ onClose, salonSlug }: StaffModalProps) {
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleStaffSelect = useCallback((staff: StaffCardData) => {
    setSelectedStaffId(staff.id);
  }, []);

  const handleAddStaff = useCallback(() => {
    setShowAddModal(true);
  }, []);

  const handleAddSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedStaffId(null);
  }, []);

  const handleUpdate = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  return (
    <div className="relative flex size-full min-h-0 flex-col overflow-hidden bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Staff"
          leftAction={<BackButton onClick={onClose} label="Back" />}
          rightAction={(
            <button
              type="button"
              onClick={handleAddStaff}
              disabled={!salonSlug}
              className="min-h-11 px-2 text-[17px] font-medium text-[var(--owner-accent,#8f3155)] transition-opacity active:opacity-50 disabled:text-[var(--owner-muted,#706267)] disabled:opacity-60"
            >
              Add
            </button>
          )}
        />
      </div>

      {/* Staff List */}
      <StaffListView
        key={refreshKey}
        salonSlug={salonSlug}
        onStaffSelect={handleStaffSelect}
        onAddStaff={handleAddStaff}
      />

      {/* Staff Detail Overlay */}
      <AnimatePresence>
        {selectedStaffId && (
          <StaffDetailPage
            staffId={selectedStaffId}
            salonSlug={salonSlug}
            onBack={handleBack}
            onUpdate={handleUpdate}
          />
        )}
      </AnimatePresence>

      {/* Add Staff Modal */}
      <AddStaffModal
        isOpen={showAddModal}
        salonSlug={salonSlug}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddSuccess}
      />
    </div>
  );
}
