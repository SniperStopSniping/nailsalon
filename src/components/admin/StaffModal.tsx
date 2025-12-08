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
import { useState, useCallback } from 'react';

import { ModalHeader, BackButton } from './AppModal';
import {
  StaffListView,
  AddStaffModal,
  StaffDetailPage,
  type StaffCardData,
} from './staff';

interface StaffModalProps {
  onClose: () => void;
}

export function StaffModal({ onClose }: StaffModalProps) {
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
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedStaffId(null);
  }, []);

  const handleUpdate = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col relative">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Staff"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Staff List */}
      <StaffListView
        key={refreshKey}
        onStaffSelect={handleStaffSelect}
        onAddStaff={handleAddStaff}
      />

      {/* Staff Detail Overlay */}
      <AnimatePresence>
        {selectedStaffId && (
          <StaffDetailPage
            staffId={selectedStaffId}
            onBack={handleBack}
            onUpdate={handleUpdate}
          />
        )}
      </AnimatePresence>

      {/* Add Staff Modal */}
      <AddStaffModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddSuccess}
      />
    </div>
  );
}

