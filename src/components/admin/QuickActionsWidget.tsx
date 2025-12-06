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
import { 
  CalendarPlus, 
  UserPlus, 
  MessageSquare, 
  Calendar,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Action definitions
interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  gradient: string;
  shadowColor: string;
}

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

interface QuickActionButtonProps {
  action: QuickAction;
  onTap: (actionId: string) => void;
}

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
          relative w-14 h-14 rounded-[14px] flex items-center justify-center
          bg-gradient-to-br ${action.gradient}
        `}
        style={{
          boxShadow: `0 8px 20px -4px ${action.shadowColor}50`,
        }}
      >
        {/* Gloss Effect */}
        <div className="absolute inset-0 rounded-[14px] bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
        
        {/* Icon */}
        <Icon className="w-6 h-6 text-white drop-shadow-sm relative z-10" strokeWidth={2.5} />
      </motion.button>
      
      {/* Label */}
      <span className="text-[11px] font-medium text-[#8E8E93] text-center leading-tight">
        {action.label}
      </span>
    </div>
  );
}

interface QuickActionsWidgetProps {
  onAction?: (actionId: string) => void;
}

export function QuickActionsWidget({ onAction }: QuickActionsWidgetProps) {
  const handleTap = (actionId: string) => {
    onAction?.(actionId);
  };

  return (
    <div className="bg-white rounded-[22px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-4">
        Quick Actions
      </div>
      <div className="flex justify-between">
        {QUICK_ACTIONS.map((action) => (
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

