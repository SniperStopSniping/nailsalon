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

import { motion } from 'framer-motion';

interface ServiceItem {
  label: string;
  percent: number;
  color: string;
}

interface ServiceBarsProps {
  items: ServiceItem[];
  /** Animation base delay */
  baseDelay?: number;
  /** Stagger delay between items */
  staggerDelay?: number;
}

export function ServiceBars({
  items,
  baseDelay = 0.5,
  staggerDelay = 0.1,
}: ServiceBarsProps) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index}>
          {/* Label Row */}
          <div className="flex justify-between text-[12px] font-medium mb-1">
            <span className="text-[#1C1C1E]">{item.label}</span>
            <span className="text-[#8E8E93]">{item.percent}%</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: item.color }}
              initial={{ width: 0 }}
              animate={{ width: `${item.percent}%` }}
              transition={{
                duration: 0.8,
                delay: baseDelay + index * staggerDelay,
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

