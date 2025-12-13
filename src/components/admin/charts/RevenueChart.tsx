'use client';

/**
 * RevenueChart Component
 *
 * Custom SVG sparkline area chart (Apple Stocks style).
 * Features:
 * - Gradient fill with transparency fade
 * - Animated line draw using pathLength
 * - Customizable colors via props
 */

import { motion } from 'framer-motion';

type RevenueChartProps = {
  /** Primary stroke color */
  strokeColor?: string;
  /** Gradient start color (top) */
  gradientStart?: string;
  /** Gradient end color (bottom) */
  gradientEnd?: string;
  /** Animation duration in seconds */
  duration?: number;
  /** Unique ID for gradient (needed if multiple charts on page) */
  gradientId?: string;
  /** Chart height */
  height?: number;
};

export function RevenueChart({
  strokeColor = '#fa709a',
  gradientStart = '#fa709a',
  gradientEnd = '#fee140',
  duration = 1.5,
  gradientId = 'revenueGradient',
  height = 128,
}: RevenueChartProps) {
  // SVG path for the chart line (represents weekly revenue trend)
  const chartPath = 'M0,80 C30,75 50,40 80,45 C110,50 130,20 160,25 C190,30 220,10 250,15 C280,20 300,5 300,5';
  const fillPath = `${chartPath} V100 H0 Z`;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox="0 0 300 100" className="size-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={gradientStart} stopOpacity="0.25" />
            <stop offset="100%" stopColor={gradientEnd} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gradient Fill */}
        <path d={fillPath} fill={`url(#${gradientId})`} />

        {/* Animated Line */}
        <motion.path
          d={chartPath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration, ease: 'easeOut' }}
        />
      </svg>

      {/* Active Dot at end of line */}
      <motion.div
        className="absolute size-3 rounded-full border-2 border-white shadow-sm"
        style={{
          backgroundColor: strokeColor,
          top: '5%',
          right: 0,
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: duration - 0.2, duration: 0.3 }}
      />
    </div>
  );
}

/**
 * Chart X-Axis Labels
 */
type ChartLabelsProps = {
  labels: string[];
};

export function ChartLabels({ labels }: ChartLabelsProps) {
  return (
    <div className="mt-2 flex justify-between px-1 text-[11px] font-medium text-[#8E8E93]">
      {labels.map((label, index) => (
        <span key={index}>{label}</span>
      ))}
    </div>
  );
}
