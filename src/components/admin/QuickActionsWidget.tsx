'use client';

/**
 * QuickActionsWidget Component
 *
 * iOS-style quick action buttons for common admin tasks.
 * Features:
 * - 4 action buttons in a row
 * - Gradient icons matching app grid style
 * - Tap animations with spring physics
 * - Callbacks for each action
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  CalendarPlus,
  MessageSquare,
  UserPlus,
} from 'lucide-react';

// Action definitions
type QuickAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  gradient: string;
  shadowColor: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'new-appointment',
    label: 'New Appt',
    icon: CalendarPlus,
    gradient: 'from-[#4facfe] to-[#00f2fe]',
    shadowColor: '#4facfe',
  },
  {
    id: 'walk-in',
    label: 'Walk-in',
    icon: UserPlus,
    gradient: 'from-[#43e97b] to-[#38f9d7]',
    shadowColor: '#43e97b',
  },
  {
    id: 'send-sms',
    label: 'Send SMS',
    icon: MessageSquare,
    gradient: 'from-[#fa709a] to-[#fee140]',
    shadowColor: '#fa709a',
  },
  {
    id: 'today-schedule',
    label: 'Schedule',
    icon: Calendar,
    gradient: 'from-[#a18cd1] to-[#fbc2eb]',
    shadowColor: '#a18cd1',
  },
];

type QuickActionButtonProps = {
  action: QuickAction;
  onTap: (actionId: string) => void;
};

function QuickActionButton({ action, onTap }: QuickActionButtonProps) {
  const Icon = action.icon;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button
        type="button"
        onClick={() => onTap(action.id)}
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        className={`
          relative flex size-14 items-center justify-center rounded-[14px] bg-gradient-to-br ${action.gradient}
        `}
        style={{
          boxShadow: `0 8px 20px -4px ${action.shadowColor}50`,
        }}
      >
        {/* Gloss Effect */}
        <div className="pointer-events-none absolute inset-0 rounded-[14px] bg-gradient-to-b from-white/30 to-transparent" />

        {/* Icon */}
        <Icon className="relative z-10 size-6 text-white drop-shadow-sm" strokeWidth={2.5} />
      </motion.button>

      {/* Label */}
      <span className="text-center text-[11px] font-medium leading-tight text-[#8E8E93]">
        {action.label}
      </span>
    </div>
  );
}

type QuickActionsWidgetProps = {
  onAction?: (actionId: string) => void;
};

export function QuickActionsWidget({ onAction }: QuickActionsWidgetProps) {
  const handleTap = (actionId: string) => {
    onAction?.(actionId);
  };

  return (
    <div className="rounded-[22px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
        Quick Actions
      </div>
      <div className="flex justify-between">
        {QUICK_ACTIONS.map(action => (
          <QuickActionButton
            key={action.id}
            action={action}
            onTap={handleTap}
          />
        ))}
      </div>
    </div>
  );
}
