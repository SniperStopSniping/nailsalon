'use client';

/**
 * ActivityRing Component
 *
 * Apple Fitness-style animated ring.
 * Features:
 * - SVG circle with strokeDasharray animation
 * - Configurable size, stroke width, and color
 * - Smooth entrance animation
 */

import { motion } from 'framer-motion';

interface ActivityRingProps {
  /** Percentage filled (0-100) */
  percent: number;
  /** Ring color */
  color: string;
  /** Outer size in pixels */
  size?: number;
  /** Stroke width in pixels */
  stroke?: number;
  /** Animation duration in seconds */
  duration?: number;
  /** Animation delay in seconds */
  delay?: number;
  /** Background track color */
  trackColor?: string;
}

export function ActivityRing({
  percent,
  color,
  size = 80,
  stroke = 8,
  duration = 1.5,
  delay = 0.5,
  trackColor = 'rgba(200, 200, 200, 0.3)',
}: ActivityRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg className="w-full h-full -rotate-90">
        {/* Background Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={stroke}
          fill="transparent"
        />

        {/* Animated Progress Ring */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration, ease: 'easeOut', delay }}
        />
      </svg>
    </div>
  );
}

/**
 * Nested Activity Rings (like Apple Fitness)
 */
interface NestedRingsProps {
  rings: Array<{
    percent: number;
    color: string;
    label?: string;
  }>;
  /** Base size for outer ring */
  baseSize?: number;
  /** Stroke width */
  stroke?: number;
  /** Gap between rings */
  gap?: number;
}

export function NestedRings({
  rings,
  baseSize = 100,
  stroke = 8,
  gap = 4,
}: NestedRingsProps) {
  return (
    <div className="relative" style={{ width: baseSize, height: baseSize }}>
      {rings.map((ring, index) => {
        const ringSize = baseSize - index * (stroke * 2 + gap);
        const offset = index * (stroke + gap / 2);

        return (
          <div
            key={index}
            className="absolute"
            style={{
              top: offset,
              left: offset,
            }}
          >
            <ActivityRing
              percent={ring.percent}
              color={ring.color}
              size={ringSize}
              stroke={stroke}
              delay={0.5 + index * 0.15}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Ring Legend
 */
interface RingLegendProps {
  items: Array<{
    color: string;
    label: string;
  }>;
}

export function RingLegend({ items }: RingLegendProps) {
  return (
    <div className="flex gap-3 text-[10px] font-medium text-[#8E8E93]">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

