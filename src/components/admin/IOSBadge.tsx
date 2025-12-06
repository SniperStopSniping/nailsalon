'use client';

/**
 * IOSBadge Component
 *
 * iOS-style notification badge (red bubble with count).
 * Matches the exact styling of iOS notification badges.
 */

import { useEffect, useState } from 'react';

export interface IOSBadgeProps {
  /** Count to display */
  count: number;
  /** Max count before showing "99+" */
  max?: number;
  /** Size variant */
  size?: 'small' | 'medium';
  /** Additional className */
  className?: string;
}

export function IOSBadge({
  count,
  max = 99,
  size = 'medium',
  className = '',
}: IOSBadgeProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [prevCount, setPrevCount] = useState(count);

  // Animate on count change
  useEffect(() => {
    if (count !== prevCount && count > 0) {
      setIsAnimating(true);
      setPrevCount(count);
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [count, prevCount]);

  if (count <= 0) return null;

  const displayValue = count > max ? `${max}+` : count.toString();
  const isWide = displayValue.length > 1;

  const sizeStyles = {
    small: {
      minWidth: '16px',
      height: '16px',
      fontSize: '10px',
      padding: isWide ? '0 4px' : '0',
    },
    medium: {
      minWidth: '20px',
      height: '20px',
      fontSize: '13px',
      padding: isWide ? '0 6px' : '0',
    },
  };

  const styles = sizeStyles[size];

  return (
    <div
      className={className}
      style={{
        minWidth: styles.minWidth,
        height: styles.height,
        padding: styles.padding,
        borderRadius: '100px',
        backgroundColor: '#FF3B30',
        color: '#ffffff',
        fontSize: styles.fontSize,
        fontWeight: 600,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
        border: '2px solid #ffffff',
        transform: isAnimating ? 'scale(1.2)' : 'scale(1)',
        transition: isAnimating
          ? 'transform 100ms ease-out'
          : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {displayValue}
    </div>
  );
}

/**
 * Inline badge for text (e.g., in lists)
 */
export function IOSInlineBadge({
  count,
  color = 'red',
}: {
  count: number;
  color?: 'red' | 'blue' | 'gray';
}) {
  if (count <= 0) return null;

  const colors = {
    red: '#FF3B30',
    blue: '#007AFF',
    gray: '#8E8E93',
  };

  return (
    <span
      style={{
        minWidth: '18px',
        height: '18px',
        padding: count > 9 ? '0 5px' : '0',
        borderRadius: '9px',
        backgroundColor: colors[color],
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: 600,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

