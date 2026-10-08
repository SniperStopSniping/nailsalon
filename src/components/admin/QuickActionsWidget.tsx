'use client';

import { CalendarPlus, MessageSquare, UserPlus } from 'lucide-react';

const QUICK_ACTIONS = [
  { id: 'new-appointment', label: 'New Appointment', icon: CalendarPlus },
  { id: 'walk-in', label: 'Walk-in', icon: UserPlus },
  { id: 'send-sms', label: 'Message Client', icon: MessageSquare },
] as const;

export function QuickActionsWidget({ onAction }: { onAction?: (actionId: string) => void }) {
  return (
    <section className="owner-card p-5" aria-label="Quick actions">
      <h2 className="owner-section-title mb-4">Quick actions</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {QUICK_ACTIONS.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            type="button"
            data-testid={`quick-action-${id}`}
            onClick={() => onAction?.(id)}
            className={`owner-action ${index === 0 ? 'owner-action--primary col-span-2' : 'owner-action--shortcut'}`}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
