'use client';

/**
 * ServiceBars Component
 *
 * Animated horizontal progress bars for service mix visualization.
 * Features:
 * - Staggered entrance animation
 * - Customizable colors per bar
 * - Percentage labels
 */

import { motion, useReducedMotion } from 'framer-motion';

type ServiceItem = {
  label: string;
  percent: number;
  color: string;
};

type ServiceBarsProps = {
  items: ServiceItem[];
  /** Animation base delay */
  baseDelay?: number;
  /** Stagger delay between items */
  staggerDelay?: number;
};

export function ServiceBars({
  items,
  baseDelay = 0.5,
  staggerDelay = 0.1,
}: ServiceBarsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index}>
          {/* Label Row */}
          <div className="mb-2 flex items-baseline justify-between gap-3 text-sm font-medium">
            <span className="min-w-0 break-words text-[var(--owner-ink)]">{item.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--owner-muted)]">
              {item.percent}
              %
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--owner-blush)]">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: item.color }}
              initial={reduceMotion ? false : { width: 0 }}
              animate={{ width: `${item.percent}%` }}
              transition={{
                duration: reduceMotion ? 0 : 0.5,
                delay: reduceMotion ? 0 : baseDelay + index * staggerDelay,
                ease: 'easeOut',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Default service items for nail salon
 */
export const defaultServiceItems: ServiceItem[] = [
  { label: 'BIAB Gel', percent: 45, color: '#F97316' },
  { label: 'Pedicure', percent: 30, color: '#3B82F6' },
  { label: 'Removal', percent: 15, color: '#9CA3AF' },
  { label: 'Other', percent: 10, color: '#E5E7EB' },
];
