'use client';

/**
 * IOSAppTile Component
 *
 * iOS home screen-style app tile with:
 * - Gradient icon background
 * - Tap animation with spring physics
 * - Optional notification badge
 */

import Link from 'next/link';
import { type ReactNode, useState } from 'react';

import { type AppIconType, IOSAppIcon } from './IOSAppIcon';
import { IOSBadge } from './IOSBadge';

export type IOSAppTileProps = {
  /** App label */
  label: string;
  /** Pre-defined app icon type */
  iconType?: AppIconType;
  /** Custom icon element (overrides iconType) */
  customIcon?: ReactNode;
  /** Navigation href */
  href: string;
  /** Badge count */
  badge?: number;
  /** Additional className */
  className?: string;
};

export function IOSAppTile({
  label,
  iconType,
  customIcon,
  href,
  badge,
  className = '',
}: IOSAppTileProps) {
  const [isPressed, setIsPressed] = useState(false);

  return (
    <Link
      href={href}
      className={`relative flex flex-col items-center ${className}`}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      onTouchStart={() => setIsPressed(true)}
      onTouchEnd={() => setIsPressed(false)}
      onTouchCancel={() => setIsPressed(false)}
      style={{
        padding: '8px',
        textDecoration: 'none',
        transform: isPressed ? 'scale(0.92)' : 'scale(1)',
        transition: isPressed
          ? 'transform 80ms ease-out'
          : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Icon with badge */}
      <div className="relative">
        {customIcon || <IOSAppIcon type={iconType} size={60} />}
        {badge !== undefined && badge > 0 && (
          <div className="absolute -right-1 -top-1">
            <IOSBadge count={badge} />
          </div>
        )}
      </div>

      {/* Label */}
      <span
        style={{
          marginTop: '6px',
          fontSize: '11px',
          fontWeight: 500,
          color: '#000000',
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          maxWidth: '70px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </Link>
  );
}

/**
 * Grid container for app tiles (4 columns like iOS)
 */
export function IOSAppGrid({
  children,
  columns = 4,
  className = '',
}: {
  children: ReactNode;
  columns?: 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '16px',
        justifyItems: 'center',
      }}
    >
      {children}
    </div>
  );
}
