'use client';

/**
 * RevenueChart Component
 *
 * Custom SVG sparkline area chart (Apple Stocks style) driven by real data.
 * Features:
 * - Gradient fill with transparency fade
 * - Animated line draw using pathLength
 * - Customizable colors via props
 * - Renders a flat baseline when there is no revenue in the period
 */

import { motion } from 'framer-motion';

type RevenueChartProps = {
  /** Revenue values, one per bucket, plotted left to right */
  data?: number[];
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

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 100;
const TOP_PADDING = 8;
const BASELINE_Y = 92;

/**
 * Build a smooth path through the data points using quadratic midpoint
 * smoothing. Values are normalized against the series max.
 */
function buildChartPath(data: number[]): { path: string; endY: number } {
  if (data.length === 0) {
    return { path: `M0,${BASELINE_Y} L${VIEW_WIDTH},${BASELINE_Y}`, endY: BASELINE_Y };
  }

  const max = Math.max(...data);
  const points = data.map((value, index) => {
    const x = data.length === 1 ? VIEW_WIDTH : (index / (data.length - 1)) * VIEW_WIDTH;
    const y = max > 0
      ? BASELINE_Y - (value / max) * (BASELINE_Y - TOP_PADDING)
      : BASELINE_Y;
    return { x, y };
  });

  if (points.length === 1) {
    return { path: `M0,${BASELINE_Y} L${points[0]!.x},${points[0]!.y}`, endY: points[0]!.y };
  }

  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const midX = (prev.x + curr.x) / 2;
    path += ` Q${prev.x},${prev.y} ${midX},${(prev.y + curr.y) / 2}`;
    if (i === points.length - 1) {
      path += ` T${curr.x},${curr.y}`;
    }
  }

  return { path, endY: points[points.length - 1]!.y };
}

export function RevenueChart({
  data,
  strokeColor = '#fa709a',
  gradientStart = '#fa709a',
  gradientEnd = '#fee140',
  duration = 1.5,
  gradientId = 'revenueGradient',
  height = 128,
}: RevenueChartProps) {
  const series = data ?? [];
  const { path: chartPath, endY } = buildChartPath(series);
  const fillPath = `${chartPath} V${VIEW_HEIGHT} H0 Z`;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="size-full overflow-visible" preserveAspectRatio="none">
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
          top: `calc(${(endY / VIEW_HEIGHT) * 100}% - 6px)`,
          right: -2,
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
