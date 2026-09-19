'use client';

/**
 * QuickActionsWidget Component
 *
 * iOS-style quick action buttons for common admin tasks.
 * Features:
 * - Three frequent actions; Calendar stays in persistent navigation.
 * - Gradient icons matching app grid style
 * - Tap animations with spring physics
 * - Callbacks for each action
 */

import { motion, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { CalendarPlus, MessageSquare, UserPlus } from 'lucide-react';

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
    label: 'New Appointment',
    icon: CalendarPlus,
    gradient: 'from-rose-800 to-rose-500',
    shadowColor: '#9f1239',
  },
  {
    id: 'walk-in',
    label: 'Walk-in',
    icon: UserPlus,
    gradient: 'from-amber-500 to-orange-400',
    shadowColor: '#d97706',
  },
  {
    id: 'send-sms',
    label: 'Message Client',
    icon: MessageSquare,
    gradient: 'from-stone-800 to-stone-600',
    shadowColor: '#292524',
  },
];

type QuickActionButtonProps = {
  action: QuickAction;
  onTap: (actionId: string) => void;
};

function QuickActionButton({ action, onTap }: QuickActionButtonProps) {
  const Icon = action.icon;
  const reducedMotion = useReducedMotion();

  return (
    // The caption lives INSIDE the button so the control carries its own
    // accessible name (AG-today-calendar-01). The visible text IS the name, so
    // it can never drift from what the owner reads on screen.
    <motion.button
      type="button"
      data-testid={`quick-action-${action.id}`}
      onClick={() => onTap(action.id)}
      whileTap={reducedMotion ? undefined : { scale: 0.9 }}
      whileHover={reducedMotion ? undefined : { scale: 1.05 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className="flex flex-col items-center gap-1.5 rounded-[18px] p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus,#b85075)] focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className={`
          relative flex size-14 items-center justify-center rounded-[14px] bg-gradient-to-br ${action.gradient}
        `}
        style={{
          boxShadow: `0 8px 20px -4px ${action.shadowColor}50`,
        }}
      >
        {/* Gloss Effect */}
        <span className="pointer-events-none absolute inset-0 rounded-[14px] bg-gradient-to-b from-white/30 to-transparent" />

        {/* Icon */}
        <Icon className="relative z-10 size-6 text-white drop-shadow-sm" strokeWidth={2.5} />
      </span>

      {/* Label — this text is the button's accessible name */}
      <span className="text-center text-[11px] font-medium leading-tight text-stone-500">
        {action.label}
      </span>
    </motion.button>
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
    <div className="rounded-[24px] border border-rose-100/80 bg-white p-4 shadow-[0_10px_30px_rgba(76,29,46,0.06)]">
      <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-rose-800">
        Quick Actions
      </div>
      <div className="grid grid-cols-3 gap-3">
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
