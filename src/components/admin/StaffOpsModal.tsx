'use client';

/**
 * StaffOpsModal Component
 *
 * Admin control room for staff operational workflows.
 * Contains:
 * - Time Off Requests Inbox (approve/deny + conflicts)
 *
 * Note: Override Review is NOT included because schedule overrides
 * in this codebase are instant (no approval workflow / no status field).
 */

import { BackButton, ModalHeader } from './AppModal';
import { TimeOffRequestsInbox } from './TimeOffRequestsInbox';

type StaffOpsModalProps = {
  onClose: () => void;
};

export function StaffOpsModal({ onClose }: StaffOpsModalProps) {
  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Staff Ops"
          subtitle="Time Off Requests"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <TimeOffRequestsInbox />
    </div>
  );
}
