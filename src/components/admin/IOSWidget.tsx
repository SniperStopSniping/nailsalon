'use client';

/**
 * IOSWidget Component
 *
 * A glassmorphic widget inspired by iOS 17+ widgets.
 * Features backdrop blur, subtle shadows, and proper iOS typography.
 */

import type { ReactNode } from 'react';

// iOS System Colors
const colors = {
  labelPrimary: '#000000',
  labelSecondary: 'rgba(60, 60, 67, 0.6)',
  labelTertiary: 'rgba(60, 60, 67, 0.3)',
  systemBlue: '#007AFF',
  systemGreen: '#34C759',
  systemRed: '#FF3B30',
};

export type IOSWidgetProps = {
  /** Widget title label */
  title: string;
  /** Optional colored indicator dot */
  indicator?: 'blue' | 'green' | 'orange' | 'red';
  /** Primary large value */
  value: string | ReactNode;
  /** Secondary description line */
  subtitle?: string | ReactNode;
  /** Optional visual element (chart, timeline, etc.) */
  visual?: ReactNode;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
  className?: string;
};

export function IOSWidget({
  title,
  indicator,
  value,
  subtitle,
  visual,
  size = 'medium',
  className = '',
}: IOSWidgetProps) {
  const indicatorColors = {
    blue: '#007AFF',
    green: '#34C759',
    orange: '#FF9500',
    red: '#FF3B30',
  };

  const sizeStyles = {
    small: { padding: '12px 14px', valueSize: '24px' },
    medium: { padding: '14px 16px', valueSize: '34px' },
    large: { padding: '16px 18px', valueSize: '42px' },
  };

  const styles = sizeStyles[size];

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: '16px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)',
        padding: styles.padding,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
      }}
    >
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between">
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: colors.labelSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
          }}
        >
          {title}
        </span>
        {indicator && (
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: indicatorColors[indicator],
            }}
          />
        )}
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: styles.valueSize,
          fontWeight: 700,
          color: colors.labelPrimary,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          className="mt-1"
          style={{
            fontSize: '13px',
            fontWeight: 400,
            color: colors.labelSecondary,
          }}
        >
          {subtitle}
        </div>
      )}

      {/* Visual element */}
      {visual && <div className="mt-3">{visual}</div>}
    </div>
  );
}

/**
 * Trend indicator for widget subtitles
 */
export function IOSTrend({
  value,
  label = 'vs last week',
}: {
  value: number;
  label?: string;
}) {
  const isPositive = value >= 0;

  return (
    <span>
      <span
        style={{
          color: isPositive ? colors.systemGreen : colors.systemRed,
          fontWeight: 500,
        }}
      >
        {isPositive ? '↑' : '↓'}
        {Math.abs(value)}
        %
      </span>
      <span style={{ color: colors.labelSecondary }}>
        {' '}
        {label}
      </span>
    </span>
  );
}

/**
 * Timeline dots for appointment widget
 */
export function IOSTimelineDots({
  completed,
  noShows,
  upcoming,
  total = 15,
}: {
  completed: number;
  noShows: number;
  upcoming: number;
  total?: number;
}) {
  const dots = [];
  let idx = 0;

  // Completed (filled blue)
  for (let i = 0; i < completed && idx < total; i++, idx++) {
    dots.push(
      <span
        key={`c-${i}`}
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: colors.systemBlue,
        }}
      />,
    );
  }

  // No-shows (red X)
  for (let i = 0; i < noShows && idx < total; i++, idx++) {
    dots.push(
      <span
        key={`n-${i}`}
        style={{
          width: '8px',
          height: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '8px',
          fontWeight: 700,
          color: colors.systemRed,
        }}
      >
        ×
      </span>,
    );
  }

  // Upcoming (outline)
  for (let i = 0; i < upcoming && idx < total; i++, idx++) {
    dots.push(
      <span
        key={`u-${i}`}
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          border: '1.5px solid rgba(60, 60, 67, 0.3)',
          backgroundColor: 'transparent',
        }}
      />,
    );
  }

  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>{dots}</div>
  );
}

/**
 * Availability bar for open spots widget
 */
export function IOSAvailabilityBar({
  slots,
  currentPosition,
}: {
  slots: ('booked' | 'open')[];
  currentPosition?: number;
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        gap: '2px',
        height: '8px',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {slots.map((slot, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            backgroundColor:
              slot === 'booked' ? colors.systemBlue : 'rgba(60, 60, 67, 0.12)',
            borderRadius: '2px',
          }}
        />
      ))}
      {currentPosition !== undefined && (
        <div
          style={{
            position: 'absolute',
            left: `${currentPosition * 100}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            backgroundColor: colors.systemRed,
            borderRadius: '1px',
          }}
        />
      )}
    </div>
  );
}

/**
 * Staff status row
 */
export function IOSStaffRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: 'busy' | 'free' | 'break';
  detail?: string;
}) {
  const statusConfig = {
    busy: { label: 'With Client', bg: 'rgba(0, 122, 255, 0.12)', color: '#007AFF' },
    free: { label: 'Free', bg: 'rgba(52, 199, 89, 0.12)', color: '#34C759' },
    break: { label: 'Break', bg: 'rgba(60, 60, 67, 0.08)', color: 'rgba(60, 60, 67, 0.6)' },
  };

  const config = statusConfig[status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
      }}
    >
      <span
        style={{
          fontSize: '15px',
          fontWeight: 500,
          color: colors.labelPrimary,
        }}
      >
        {name}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: config.bg,
            color: config.color,
          }}
        >
          {config.label}
        </span>
        {detail && (
          <span style={{ fontSize: '12px', color: colors.labelSecondary }}>
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}
